// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { McpWriteQueue, RendererMcpActionBridge } from '../mcp-write-queue'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('McpWriteQueue', () => {
  it('shows and executes one MCP mutation at a time for the same run', async () => {
    const firstApproval = deferred<boolean>()
    const secondApproval = deferred<boolean>()
    const approve = vi
      .fn()
      .mockReturnValueOnce(firstApproval.promise)
      .mockReturnValueOnce(secondApproval.promise)
    const queue = new McpWriteQueue(approve)
    const firstWrite = vi.fn(async () => 'first')
    const secondWrite = vi.fn(async () => 'second')

    const first = queue.enqueue({ runId: 'run-1', name: 'save_memory', args: {} }, firstWrite)
    const second = queue.enqueue({ runId: 'run-1', name: 'criar_task', args: {} }, secondWrite)
    await Promise.resolve()
    expect(approve).toHaveBeenCalledTimes(1)
    expect(secondWrite).not.toHaveBeenCalled()

    firstApproval.resolve(true)
    await expect(first).resolves.toEqual({ approved: true, value: 'first' })
    await Promise.resolve()
    expect(approve).toHaveBeenCalledTimes(2)
    expect(secondWrite).not.toHaveBeenCalled()

    secondApproval.resolve(true)
    await expect(second).resolves.toEqual({ approved: true, value: 'second' })
    expect(firstWrite).toHaveBeenCalledOnce()
    expect(secondWrite).toHaveBeenCalledOnce()
  })

  it('does not execute a denied or expired approval', async () => {
    const queue = new McpWriteQueue(async () => false)
    const write = vi.fn(async () => 'persisted')

    await expect(
      queue.enqueue({ runId: 'run-1', name: 'save_memory', args: {} }, write)
    ).resolves.toEqual({
      approved: false
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects visible and queued writes during cleanup without persisting either', async () => {
    const approval = deferred<boolean>()
    const queue = new McpWriteQueue(() => approval.promise)
    const firstWrite = vi.fn(async () => 'first')
    const secondWrite = vi.fn(async () => 'second')
    const first = queue.enqueue({ runId: 'run-1', name: 'save_memory', args: {} }, firstWrite)
    const second = queue.enqueue({ runId: 'run-1', name: 'criar_task', args: {} }, secondWrite)
    await Promise.resolve()

    queue.rejectRun('run-1')
    await expect(first).rejects.toThrow('encerrada')
    await expect(second).rejects.toThrow('encerrada')
    approval.resolve(true)
    await Promise.resolve()
    expect(firstWrite).not.toHaveBeenCalled()
    expect(secondWrite).not.toHaveBeenCalled()
  })

  it('continues to the next request when persistence fails', async () => {
    const queue = new McpWriteQueue(async () => true)
    const failed = queue.enqueue({ runId: 'run-1', name: 'save_memory', args: {} }, async () => {
      throw new Error('flush falhou')
    })
    const succeeding = queue.enqueue(
      { runId: 'run-1', name: 'criar_task', args: {} },
      async () => 'ok'
    )

    await expect(failed).rejects.toThrow('flush falhou')
    await expect(succeeding).resolves.toEqual({ approved: true, value: 'ok' })
  })
})

describe('RendererMcpActionBridge', () => {
  it('rejects when the renderer is unmounted or fails to flush', async () => {
    const unavailable = new RendererMcpActionBridge<string, string>(() => {
      throw new Error('renderer desmontado')
    })
    await expect(unavailable.request('task')).rejects.toThrow('renderer desmontado')

    let requestId = ''
    const bridge = new RendererMcpActionBridge<string, string>(({ requestId: id }) => {
      requestId = id
    })
    const pending = bridge.request('task')
    bridge.reject(requestId, new Error('flush falhou'))
    await expect(pending).rejects.toThrow('flush falhou')
  })

  it('expires an unanswered renderer action', async () => {
    vi.useFakeTimers()
    const bridge = new RendererMcpActionBridge<string, string>(() => {}, 50)
    const pending = bridge.request('task')
    const expected = expect(pending).rejects.toThrow('não respondeu')
    await vi.advanceTimersByTimeAsync(50)
    await expected
    vi.useRealTimers()
  })
})
