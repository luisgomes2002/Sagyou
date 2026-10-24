import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const xterm = vi.hoisted(() => {
  const instances: Array<{
    cols: number
    rows: number
    write: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    getSelection: ReturnType<typeof vi.fn>
    scrollToLine: ReturnType<typeof vi.fn>
    buffer: { active: { viewportY: number; baseY: number } }
  }> = []
  let input: ((data: string) => void) | undefined
  const Terminal = vi.fn(function (options: { cols?: number; rows?: number }) {
    const instance = {
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      write: vi.fn((_data: string, callback?: () => void) => callback?.()),
      resize: vi.fn(function (cols: number, rows: number) {
        instance.cols = cols
        instance.rows = rows
      }),
      reset: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        input = listener
        return { dispose: vi.fn() }
      }),
      scrollToLine: vi.fn(),
      buffer: { active: { viewportY: 0, baseY: 0 } },
      getSelection: vi.fn(() => '')
    }
    instances.push(instance)
    return instance
  })
  const FitAddon = vi.fn(function () {
    return { fit: vi.fn() }
  })
  return { instances, Terminal, FitAddon, input: (data: string) => input?.(data) }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.Terminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FitAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

import { AgentTerminal } from '../../components/ai/AgentTerminal'

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

describe('AgentTerminal', () => {
  beforeEach(() => {
    xterm.instances.length = 0
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    if (!window.electronAPI) window.electronAPI = {} as never
    window.electronAPI.ai ??= {} as never
    window.electronAPI.ai.codeAgent = {
      terminalReconnect: vi.fn(async () => ({
        success: true,
        log: 'restored\\r\\n',
        cols: 132,
        rows: 48
      }))
    } as never
  })

  it('reconnects the existing PTY buffer, forwards raw input and cleans up the xterm instance', async () => {
    const onInput = vi.fn(async () => {})
    const onResize = vi.fn(async () => {})
    const { unmount } = render(
      <AgentTerminal
        interactive
        runId="run-owned"
        log=""
        running
        initialCols={100}
        initialRows={30}
        onInput={onInput}
        onResize={onResize}
      />
    )

    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.resize).toHaveBeenCalledWith(132, 48))
    expect(terminal.write).toHaveBeenCalledWith('restored\\r\\n', expect.any(Function))
    expect(window.electronAPI.ai.codeAgent.terminalReconnect).toHaveBeenCalledWith('run-owned')

    await act(async () => xterm.input('\u0003\u001b[A'))
    expect(onInput).toHaveBeenCalledWith('\u0003\u001b[A')

    unmount()
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })

  it('appends only new output when the bounded log rolls without resetting the viewport', async () => {
    ;(
      window.electronAPI.ai.codeAgent.terminalReconnect as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      success: false
    })
    const { rerender } = render(
      <AgentTerminal
        interactive
        runId="run-owned"
        log="first"
        running
        onInput={async () => {}}
        onResize={async () => {}}
      />
    )
    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.write).toHaveBeenCalled())
    terminal.write.mockClear()

    rerender(
      <AgentTerminal
        interactive
        runId="run-owned"
        log="first second"
        running
        onInput={async () => {}}
        onResize={async () => {}}
      />
    )
    expect(terminal.write).toHaveBeenCalledWith(' second', expect.any(Function))

    terminal.buffer.active.viewportY = 2
    terminal.buffer.active.baseY = 12
    terminal.write.mockClear()

    rerender(
      <AgentTerminal
        interactive
        runId="run-owned"
        log="second third"
        running
        onInput={async () => {}}
        onResize={async () => {}}
      />
    )
    expect(terminal.reset).not.toHaveBeenCalled()
    expect(terminal.write).toHaveBeenCalledWith(' third', expect.any(Function))
    expect(terminal.scrollToLine).toHaveBeenCalledWith(2)
  })

  it('ignores an older status after reconnect, then appends only fresh bytes', async () => {
    const props = {
      interactive: true as const,
      runId: 'run-owned',
      running: true,
      onInput: async () => {},
      onResize: async () => {}
    }
    const { rerender } = render(<AgentTerminal {...props} log="" />)
    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.write).toHaveBeenCalledOnce())
    terminal.write.mockClear()

    rerender(<AgentTerminal {...props} log="restor" />)
    expect(terminal.write).not.toHaveBeenCalled()

    rerender(<AgentTerminal {...props} log="restored\r\nmore" />)
    expect(terminal.write).toHaveBeenCalledWith('more', expect.any(Function))
  })
})
