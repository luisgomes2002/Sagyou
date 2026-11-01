import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const xterm = vi.hoisted(() => {
  const instances: Array<{
    cols: number
    rows: number
    write: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
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
      refresh: vi.fn(),
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
import { disposeAllLiveTerminals } from '../../components/ai/liveTerminals'

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

type OutputListener = (payload: { runId: string; chunk: string }) => void
type ExitListener = (payload: { runId: string; code: number }) => void

describe('AgentTerminal', () => {
  let emitOutput: OutputListener
  let emitExit: ExitListener

  const props = (runId: string): Parameters<typeof AgentTerminal>[0] & { interactive: true } => ({
    interactive: true as const,
    runId,
    log: '',
    running: true,
    onInput: async () => {},
    onResize: async () => {}
  })

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
      })),
      onOutput: vi.fn((listener: OutputListener) => {
        emitOutput = listener
        return vi.fn()
      }),
      onExit: vi.fn((listener: ExitListener) => {
        emitExit = listener
        return vi.fn()
      })
    } as never
  })

  afterEach(() => {
    disposeAllLiveTerminals()
  })

  it('reconnects the existing PTY buffer and forwards raw input', async () => {
    const onInput = vi.fn(async () => {})
    render(
      <AgentTerminal {...props('run-owned')} initialCols={100} initialRows={30} onInput={onInput} />
    )

    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.resize).toHaveBeenCalledWith(132, 48))
    expect(terminal.write).toHaveBeenCalledWith('restored\\r\\n', expect.any(Function))
    expect(window.electronAPI.ai.codeAgent.terminalReconnect).toHaveBeenCalledWith('run-owned')

    await act(async () => xterm.input('\u0003\u001b[A'))
    expect(onInput).toHaveBeenCalledWith('\u0003\u001b[A')
  })

  it('writes PTY chunks straight from the output event, only for its own run', async () => {
    render(<AgentTerminal {...props('run-owned')} />)
    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.write).toHaveBeenCalled())
    terminal.write.mockClear()

    act(() => {
      emitOutput({ runId: 'run-owned', chunk: '\u001b[2J frame' })
      emitOutput({ runId: 'run-other', chunk: 'not mine' })
    })

    expect(terminal.write).toHaveBeenCalledOnce()
    expect(terminal.write).toHaveBeenCalledWith('\u001b[2J frame', expect.any(Function))
  })

  // Switching sessions used to dispose the xterm and rebuild it from main's last
  // 8000 raw characters, which start mid-redraw for a full-screen CLI: the
  // screen came back blank or scrambled until the CLI repainted.
  it('keeps the same terminal alive across a session switch and feeds it while hidden', async () => {
    const { rerender } = render(<AgentTerminal {...props('run-A')} />)
    const terminalA = xterm.instances[0]
    await waitFor(() => expect(terminalA.write).toHaveBeenCalled())

    rerender(<AgentTerminal {...props('run-B')} />)
    await waitFor(() => expect(xterm.instances).toHaveLength(2))
    terminalA.write.mockClear()

    act(() => emitOutput({ runId: 'run-A', chunk: 'while hidden' }))
    expect(terminalA.write).toHaveBeenCalledWith('while hidden', expect.any(Function))

    rerender(<AgentTerminal {...props('run-A')} />)

    expect(xterm.instances).toHaveLength(2)
    expect(terminalA.dispose).not.toHaveBeenCalled()
    expect(terminalA.open).toHaveBeenCalledOnce()
    expect(window.electronAPI.ai.codeAgent.terminalReconnect).toHaveBeenCalledTimes(2)
  })

  it('disposes the terminal when its PTY exits', async () => {
    const { unmount } = render(<AgentTerminal {...props('run-owned')} />)
    const terminal = xterm.instances[0]
    await waitFor(() => expect(terminal.write).toHaveBeenCalled())
    unmount()
    expect(terminal.dispose).not.toHaveBeenCalled()

    act(() => emitExit({ runId: 'run-owned', code: 0 }))
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })
})
