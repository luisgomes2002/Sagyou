// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { startAgentPty, type AgentPtySpawner } from '../modules/agent/agent-pty'
import {
  reconnectTerminal,
  resizeTerminal,
  writeTerminalInput,
  type InteractiveAgentRun
} from '../modules/agent/agent-terminal-session'
import {
  buildHarnessLaunch,
  discoverHarnesses,
  type HarnessCapabilities,
  type HarnessId
} from '../modules/agent/harness-adapter'

/**
 * Every harness is driven through the same contract with a fake PTY. No real CLI
 * is ever spawned: the spawner and the command runner are both injected.
 */
const HARNESSES: { id: HarnessId; command: string; label: string }[] = [
  { id: 'codex', command: 'codex', label: 'Codex' },
  { id: 'claude-code', command: 'claude', label: 'Claude Code' },
  { id: 'opencode', command: 'opencode', label: 'OpenCode' }
]

function fakePty(): {
  spawner: AgentPtySpawner
  spawn: ReturnType<typeof vi.fn>
  pty: Pick<IPty, 'write' | 'resize' | 'kill'> & {
    emitData(d: string): void
    emitExit(c: number): void
  }
} {
  let dataListener: (d: string) => void = () => {}
  let exitListener: (e: { exitCode: number }) => void = () => {}
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (l: (d: string) => void) => {
      dataListener = l
      return { dispose: vi.fn() }
    },
    onExit: (l: (e: { exitCode: number }) => void) => {
      exitListener = l
      return { dispose: vi.fn() }
    },
    emitData: (d: string) => dataListener(d),
    emitExit: (exitCode: number) => exitListener({ exitCode })
  }
  const spawn = vi.fn(() => pty as unknown as IPty)
  return { spawner: spawn as unknown as AgentPtySpawner, spawn, pty: pty as never }
}

describe.each(HARNESSES)('harness parity: $label', ({ id, command, label }) => {
  it('detects a recognised binary and never invents a model list', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '9.9.9\n', stderr: '' }))
    const statuses = await discoverHarnesses(run, (name) =>
      name === command ? `/bin/${name}` : null
    )
    const status = statuses.find((s) => s.id === id)!

    expect(status).toMatchObject({
      installed: true,
      path: `/bin/${command}`,
      version: '9.9.9',
      models: []
    })
    expect(status.capabilities).toMatchObject({
      interactiveTerminal: 'available',
      createSession: 'available',
      mcp: 'available',
      cancellation: 'available'
    })
    // Model support is only claimed when a CLI really exposes it.
    expect(status.capabilities.modelSelection).toBe('unknown')
    expect(status.capabilities.modelStatus).toBe('unknown')
  })

  it('reports every capability unavailable when the binary is missing', async () => {
    const run = vi.fn()
    const statuses = await discoverHarnesses(run, () => null)
    const status = statuses.find((s) => s.id === id)!

    expect(status).toMatchObject({ installed: false, path: null, version: null, models: [] })
    expect(run).not.toHaveBeenCalled()
    for (const value of Object.values(status.capabilities as HarnessCapabilities))
      expect(value).toBe('unavailable')
  })

  it('starts one PTY in the worktree with its own launch args', () => {
    const { spawner, spawn } = fakePty()
    const launch = buildHarnessLaunch(id, 'do it', '/wt')
    startAgentPty(
      {
        command: `/bin/${command}`,
        args: launch.args,
        cwd: '/wt',
        env: {},
        onData: vi.fn(),
        onExit: vi.fn()
      },
      spawner
    )

    expect(launch.label).toBe(label)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      `/bin/${command}`,
      launch.args,
      expect.objectContaining({ cwd: '/wt', name: 'xterm-256color', cols: 100, rows: 30 })
    )
    expect(launch.args).toContain('do it')
  })

  it('runs input, resize, status, stop, reconnect and exit through the shared contract', () => {
    const { spawner, pty } = fakePty()
    const onData = vi.fn()
    const onExit = vi.fn()
    const child = startAgentPty(
      { command: `/bin/${command}`, args: [], cwd: '/wt', env: {}, onData, onExit },
      spawner
    )
    const run: InteractiveAgentRun = {
      interactive: true,
      externalChild: child,
      log: '',
      terminalCols: 100,
      terminalRows: 30
    }
    const runs = new Map([['run-1', run]])

    // Output is buffered by the owner; reconnect exposes it with the last grid.
    pty.emitData('hello\r\n')
    expect(onData).toHaveBeenCalledWith('hello\r\n')
    run.log += 'hello\r\n'

    // Input (raw control bytes pass through) and resize.
    expect(writeTerminalInput(runs, 'run-1', '\u0003')).toEqual({ success: true })
    expect(pty.write).toHaveBeenCalledWith('\u0003')
    expect(resizeTerminal(runs, 'run-1', 140, 50)).toEqual({ success: true })
    expect(pty.resize).toHaveBeenCalledWith(140, 50)

    // Status: the reconnect snapshot reflects buffer and latest grid, nothing else.
    expect(reconnectTerminal(runs, 'run-1')).toEqual({
      success: true,
      log: 'hello\r\n',
      cols: 140,
      rows: 50
    })

    // Stop is a SIGTERM to the PTY the run owns.
    child.kill('SIGTERM')
    expect(pty.kill).toHaveBeenCalledWith('SIGTERM')

    // Termination reports the exit code once; once the run is gone, no control remains.
    pty.emitExit(130)
    expect(onExit).toHaveBeenCalledWith(130)
    runs.delete('run-1')
    expect(writeTerminalInput(runs, 'run-1', 'x')).toMatchObject({ success: false })
    expect(resizeTerminal(runs, 'run-1', 100, 30)).toMatchObject({ success: false })
    expect(reconnectTerminal(runs, 'run-1')).toMatchObject({ success: false })
  })

  it('refuses control of a run without a live PTY with the same message', () => {
    const runs = new Map<string, InteractiveAgentRun>([
      ['dead', { interactive: true, externalChild: null, log: '' }]
    ])

    const results = [
      writeTerminalInput(runs, 'dead', 'x'),
      resizeTerminal(runs, 'dead', 100, 30),
      reconnectTerminal(runs, 'dead')
    ]
    for (const result of results)
      expect(result).toEqual({ success: false, error: 'Sessão interativa indisponível.' })
  })
})

describe('harness parity: shared behaviour', () => {
  it('gives all harnesses identical capability shapes', async () => {
    const statuses = await discoverHarnesses(
      async () => ({ code: 0, stdout: '1', stderr: '' }),
      (name) => `/bin/${name}`
    )
    const [first, ...rest] = statuses.map((s) => s.capabilities)
    for (const capabilities of rest) expect(capabilities).toEqual(first)
  })

  it('only asks Codex for an authentication status; the others stay unknown', async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }))
    const statuses = await discoverHarnesses(run, (name) => `/bin/${name}`)
    const auth = Object.fromEntries(statuses.map((s) => [s.id, s.authentication]))

    expect(auth).toEqual({
      codex: 'unauthenticated',
      'claude-code': 'unknown',
      opencode: 'unknown'
    })
    expect(run).not.toHaveBeenCalledWith('/bin/claude', expect.arrayContaining(['login']))
    expect(run).not.toHaveBeenCalledWith('/bin/opencode', expect.arrayContaining(['login']))
  })

  it('rejects an unknown harness id instead of falling back to another', () => {
    expect(() => buildHarnessLaunch('gemini' as HarnessId, 'x', '/wt')).toThrow(/desconhecido/)
  })
})
