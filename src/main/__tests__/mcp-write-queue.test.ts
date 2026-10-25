// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { McpWriteQueue, RendererMcpActionBridge } from '../modules/agent/mcp-write-queue'

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

describe('McpWriteQueue preparation and optional approval', () => {
  it('skips the approval callback when approval is false', async () => {
    const approve = vi.fn(async () => true)
    const queue = new McpWriteQueue(approve)
    await expect(
      queue.enqueue(
        { runId: 'run-1', name: 'update_task', args: {}, approval: false },
        async () => 'done'
      )
    ).resolves.toEqual({ approved: true, value: 'done' })
    expect(approve).not.toHaveBeenCalled()
  })

  it('still serializes a no-approval write behind a pending card', async () => {
    const approval = deferred<boolean>()
    const queue = new McpWriteQueue(() => approval.promise)
    const secondWrite = vi.fn(async () => 'second')
    const first = queue.enqueue({ runId: 'run-1', name: 'delete_task', args: {} }, async () => 'a')
    const second = queue.enqueue(
      { runId: 'run-1', name: 'update_task', args: {}, approval: false },
      secondWrite
    )
    await Promise.resolve()
    expect(secondWrite).not.toHaveBeenCalled()
    approval.resolve(true)
    await first
    await expect(second).resolves.toEqual({ approved: true, value: 'second' })
  })

  it('runs prepare inside the queue after the previous write finished', async () => {
    const queue = new McpWriteQueue(async () => true)
    let state = 0
    const first = queue.enqueue(
      { runId: 'run-1', name: 'create_column', args: {}, approval: false },
      async () => {
        state = 1
        return 'created'
      },
      async () => ({ resumo: 'criar' })
    )
    const seen: number[] = []
    const second = queue.enqueue(
      { runId: 'run-1', name: 'move_task', args: {}, approval: false },
      async () => 'moved',
      async () => {
        seen.push(state)
        return { resumo: 'mover' }
      }
    )
    await first
    await second
    expect(seen).toEqual([1])
  })

  it('a refusing prepare never reaches approval or execute', async () => {
    const approve = vi.fn(async () => true)
    const queue = new McpWriteQueue(approve)
    const write = vi.fn(async () => ({ ok: true }))
    await expect(
      queue.enqueue({ runId: 'run-1', name: 'delete_task', args: {} }, write, async () => ({
        refuse: { ok: false }
      }))
    ).resolves.toEqual({ approved: false, refused: true, value: { ok: false } })
    expect(approve).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('passes the prepare resumo to the approval callback', async () => {
    const approve = vi.fn(async () => true)
    const queue = new McpWriteQueue(approve)
    await queue.enqueue(
      { runId: 'run-1', name: 'delete_task', args: { id: 't' } },
      async () => 'ok',
      async () => ({ resumo: 'Excluir tarefa "X"' })
    )
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'delete_task', resumo: 'Excluir tarefa "X"' })
    )
  })

  it('a run that ended before execute does not execute, even without approval', async () => {
    let live = true
    const queue = new McpWriteQueue(
      async () => true,
      () => live
    )
    const write = vi.fn(async () => 'x')
    const outcome = queue.enqueue(
      { runId: 'run-1', name: 'update_task', args: {}, approval: false },
      write,
      async () => {
        live = false
        return { resumo: 'editar' }
      }
    )
    await expect(outcome).resolves.toEqual({ approved: false, ended: true })
    expect(write).not.toHaveBeenCalled()

    const before = queue.enqueue(
      { runId: 'run-1', name: 'update_task', args: {}, approval: false },
      write
    )
    await expect(before).resolves.toEqual({ approved: false, ended: true })
    expect(write).not.toHaveBeenCalled()
  })

  it('rejectRun cancels queued no-approval writes', async () => {
    const approval = deferred<boolean>()
    const queue = new McpWriteQueue(() => approval.promise)
    const write = vi.fn(async () => 'x')
    const first = queue.enqueue({ runId: 'run-1', name: 'delete_task', args: {} }, write)
    const second = queue.enqueue(
      { runId: 'run-1', name: 'update_task', args: {}, approval: false },
      write
    )
    await Promise.resolve()
    queue.rejectRun('run-1')
    await expect(first).rejects.toThrow('encerrada')
    await expect(second).rejects.toThrow('encerrada')
    approval.resolve(true)
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
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
