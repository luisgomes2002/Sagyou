// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { AgentPty } from '../modules/agent/agent-pty'
import {
  reconnectTerminal,
  resizeTerminal,
  writeTerminalInput,
  type InteractiveAgentRun
} from '../modules/agent/agent-terminal-session'

function fixture(overrides: Partial<InteractiveAgentRun> = {}): {
  runs: Map<string, InteractiveAgentRun>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
} {
  const write = vi.fn()
  const resize = vi.fn()
  const child = { write, resize } as unknown as AgentPty
  return {
    runs: new Map([
      [
        'run-owned',
        {
          interactive: true,
          externalChild: child,
          log: 'already rendered\\r\\n',
          terminalCols: 120,
          terminalRows: 40,
          ...overrides
        }
      ]
    ]),
    write,
    resize
  }
}

describe('interactive terminal IPC contract', () => {
  it('writes raw control input only to its owned live PTY', () => {
    const { runs, write } = fixture()

    expect(writeTerminalInput(runs, 'run-owned', '\u0003\u001b[A')).toEqual({ success: true })
    expect(write).toHaveBeenCalledWith('\u0003\u001b[A')
    expect(writeTerminalInput(runs, 'foreign-run', 'hello')).toMatchObject({ success: false })
    expect(writeTerminalInput(runs, 'run-owned', '')).toMatchObject({ success: false })
    expect(writeTerminalInput(runs, 'run-owned', 'x'.repeat(8_001))).toMatchObject({
      success: false
    })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed resize payloads without changing the terminal dimensions', () => {
    const { runs, resize } = fixture()
    const run = runs.get('run-owned')!

    expect(resizeTerminal(runs, 'run-owned', 132, 48)).toEqual({ success: true })
    expect(resize).toHaveBeenCalledWith(132, 48)
    expect(run).toMatchObject({ terminalCols: 132, terminalRows: 48 })
    expect(resizeTerminal(runs, 'foreign-run', 120, 40)).toMatchObject({ success: false })
    expect(resizeTerminal(runs, 'run-owned', 19, 40)).toMatchObject({ success: false })
    expect(resizeTerminal(runs, 'run-owned', 120.5, 40)).toMatchObject({ success: false })
    expect(run).toMatchObject({ terminalCols: 132, terminalRows: 48 })
  })

  it('returns only a live run buffer to reconnect and never a foreign session', () => {
    const { runs } = fixture()

    expect(reconnectTerminal(runs, 'run-owned')).toEqual({
      success: true,
      log: 'already rendered\\r\\n',
      cols: 120,
      rows: 40
    })
    expect(reconnectTerminal(runs, 'foreign-run')).toMatchObject({ success: false })
    expect(reconnectTerminal(runs, { id: 'run-owned' })).toMatchObject({ success: false })
  })

})
