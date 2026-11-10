// @vitest-environment node
// Spec docs/specs/2026-11-09-servidores-remote-control.md, plan Task 3.
import { describe, expect, it, vi } from 'vitest'
import type { AgentPty, AgentPtyOptions } from '../modules/agent/agent-pty'
import {
  RC_BACKOFF_MS,
  RC_CONFIRM_MS,
  RC_MAX_LOG,
  RC_SCAN_TTL_MS,
  RC_STABLE_MS,
  RC_TEXT,
  createRcManager,
  insideGitRepo,
  projectServerPath,
  validServerName,
  type RcManagerDeps,
  type RcProject
} from '../modules/remote/rc-manager'
import type { RcServerEntry } from '../modules/remote/remote-config'

const DIR = 'E:\\Projetos\\Sagyou'
const CLAUDE = 'C:\\Users\\l\\.local\\bin\\claude.exe'
const CONFIRMED_AT = '2026-11-01T10:00:00.000Z'
const ID = 'server:p1'

class FakePty implements AgentPty {
  written: string[] = []
  sizes: [number, number][] = []
  killed = false
  constructor(readonly options: AgentPtyOptions) {}
  write(data: string): void {
    this.written.push(data)
  }
  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows])
  }
  kill(): void {
    this.killed = true
  }
  onData(): { dispose(): void } {
    return { dispose: (): void => undefined }
  }
  onExit(): { dispose(): void } {
    return { dispose: (): void => undefined }
  }
  emit(chunk: string): void {
    this.options.onData(chunk)
  }
  exit(code: number): void {
    this.options.onExit(code)
  }
}

/** The bridge status line as `claude remote-control` draws it (icon, state, " · repo"). */
function statusLine(state: 'Ready' | 'Connected'): string {
  const colour = state === 'Ready' ? '\x1b[32m' : '\x1b[36m'
  return `${colour}\u00b7\u2714\ufe0e\u00b7\x1b[39m ${colour}${state}\x1b[39m\x1b[2m \u00b7 \x1b[22m\x1b[2mSagyou\x1b[22m\n`
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper; the inferred shape is the API
function makeClock() {
  let now = Date.UTC(2026, 10, 9, 12, 0, 0)
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: (): number => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      seq += 1
      timers.set(seq, { at: now + ms, fn })
      return seq
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number)
    },
    pending: (): number => timers.size,
    /** Time until the earliest timer, or null. */
    nextDelay: (): number | null => {
      const ats = [...timers.values()].map((t) => t.at)
      return ats.length ? Math.min(...ats) - now : null
    },
    async advance(ms: number): Promise<void> {
      const target = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const item of timers) {
          if (item[1].at <= target && (next === null || item[1].at < next[1].at)) next = item
        }
        if (next === null) break
        timers.delete(next[0])
        now = next[1].at
        next[1].fn()
        await flush()
      }
      now = target
      await flush()
    }
  }
}

function entry(patch: Partial<RcServerEntry> = {}): RcServerEntry {
  return {
    projectId: 'p1',
    enabled: true,
    autostart: false,
    confirmedAt: CONFIRMED_AT,
    path: DIR,
    ...patch
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper; the inferred shape is the API
function setup(
  opts: {
    projects?: RcProject[]
    entries?: RcServerEntry[]
    platform?: NodeJS.Platform
  } = {}
) {
  const clock = makeClock()
  let projects: RcProject[] = opts.projects ?? [{ id: 'p1', name: 'Sagyou', path: DIR }]
  let entries: RcServerEntry[] = opts.entries ?? [entry()]
  const ptys: FakePty[] = []
  const state = {
    cut: false,
    external: [] as string[],
    claude: CLAUDE as string | null,
    git: true
  }
  const deps = {
    platform: opts.platform ?? 'win32',
    projects: () => projects,
    entries: () => entries,
    saveEntries: vi.fn((next: RcServerEntry[]) => {
      entries = next
    }),
    resolveClaude: () => state.claude,
    hasGit: vi.fn(() => state.git),
    spawn: vi.fn((options: AgentPtyOptions) => {
      const pty = new FakePty(options)
      ptys.push(pty)
      return pty
    }),
    externalNames: vi.fn(async () => state.external),
    killExternal: vi.fn(async () => 1),
    accessCut: () => state.cut,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    log: { info: vi.fn(), warn: vi.fn() },
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onChange: vi.fn(),
    env: () => ({ PATH: 'C:\\bin' })
  } satisfies RcManagerDeps
  const manager = createRcManager(deps)
  return {
    manager,
    deps,
    clock,
    ptys,
    state,
    setProjects: (next: RcProject[]) => {
      projects = next
    },
    entries: () => entries,
    view: (projectId = 'p1') => manager.list().find((s) => s.projectId === projectId)
  }
}

describe('start', () => {
  it('sobe o claude resolvido com os argumentos exatos, na pasta do projeto', async () => {
    const { manager, deps, ptys, view } = setup()
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    const options = ptys[0].options
    expect(options.command).toBe(CLAUDE)
    expect(options.args).toEqual([
      'remote-control',
      '--name',
      'Sagyou',
      '--spawn',
      'worktree',
      '--permission-mode',
      'manual'
    ])
    expect(options.cwd).toBe(DIR)
    expect(deps.hasGit).toHaveBeenCalledWith(DIR)
    expect(view()?.state).toBe('starting')
    ptys[0].emit('Remote Control ativo')
    expect(view()?.state).toBe('running')
  })

  it('pasta sem Git usa --spawn same-dir', async () => {
    const { manager, ptys, state } = setup()
    state.git = false
    await manager.start('p1', 'pc')
    expect(ptys[0].options.args).toEqual([
      'remote-control',
      '--name',
      'Sagyou',
      '--spawn',
      'same-dir',
      '--permission-mode',
      'manual'
    ])
  })

  it('dois start seguidos sobem um servidor só', async () => {
    const { manager, deps } = setup()
    const results = await Promise.all([manager.start('p1', 'pc'), manager.start('p1', 'phone')])
    expect(results).toEqual(['ok', 'ok'])
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })

  it('projeto desconhecido = unknown-server', async () => {
    const { manager, deps } = setup()
    expect(await manager.start('zz', 'pc')).toBe('unknown-server')
    expect(await manager.start('zz', 'phone')).toBe('unknown-server')
    expect(await manager.stop('zz')).toBe('unknown-server')
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('pelo celular, um projeto com o servidor desligado = unknown-server', async () => {
    const { manager, deps } = setup({ entries: [entry({ enabled: false })] })
    expect(await manager.start('p1', 'phone')).toBe('unknown-server')
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('Ligar no PC liga o servidor de um projeto sem entrada', async () => {
    const { manager, entries } = setup({ entries: [] })
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(entries()).toEqual([
      { projectId: 'p1', enabled: true, autostart: false, confirmedAt: null, path: null }
    ])
  })

  it('sem claude: start-failed e "Claude Code não encontrado", estado Parado', async () => {
    const { manager, deps, state, view } = setup()
    state.claude = null
    expect(await manager.start('p1', 'pc')).toBe('start-failed')
    expect(await manager.start('p1', 'phone')).toBe('start-failed')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(view()).toMatchObject({ state: 'stopped', error: 'Claude Code não encontrado' })
    state.claude = CLAUDE
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(view()?.error).toBeNull()
  })

  it('fora do Windows o gerenciador fica vazio', async () => {
    const { manager, deps } = setup({ platform: 'linux' })
    expect(manager.list()).toEqual([])
    expect(await manager.start('p1', 'pc')).toBe('unknown-server')
    await manager.startAutostart()
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

describe('confirmação', () => {
  it('60 s rodando a partir do PC grava confirmedAt e path', async () => {
    const { manager, deps, clock, ptys, entries, view } = setup({
      entries: [entry({ confirmedAt: null, path: null })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit('Enable Remote Control? (y/n)')
    expect(view()).toMatchObject({ state: 'needs-confirm', confirmed: false })
    await clock.advance(RC_CONFIRM_MS - 1)
    expect(deps.saveEntries).not.toHaveBeenCalled()
    await clock.advance(1)
    expect(entries()[0]).toMatchObject({
      confirmedAt: new Date(clock.now()).toISOString(),
      path: DIR
    })
    expect(view()).toMatchObject({ state: 'running', confirmed: true })
  })

  it('caiu antes dos 60 s: não confirma', async () => {
    const { manager, deps, clock, ptys } = setup({
      entries: [entry({ confirmedAt: null, path: null })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit('x')
    await clock.advance(30_000)
    ptys[0].exit(1)
    await clock.advance(RC_CONFIRM_MS)
    expect(deps.saveEntries).not.toHaveBeenCalled()
  })

  it('a partir do celular nunca grava', async () => {
    const { manager, deps, clock, ptys } = setup()
    expect(await manager.start('p1', 'phone')).toBe('ok')
    ptys[0].emit('x')
    await clock.advance(RC_CONFIRM_MS * 3)
    expect(deps.saveEntries).not.toHaveBeenCalled()
  })

  it('celular sem confirmação: not-confirmed, sem spawn', async () => {
    const { manager, deps } = setup({ entries: [entry({ confirmedAt: null, path: null })] })
    expect(await manager.start('p1', 'phone')).toBe('not-confirmed')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_refused', {
      projectId: 'p1',
      reason: 'not-confirmed'
    })
  })

  it('celular com a confirmação de outra pasta: not-confirmed', async () => {
    const { manager, deps, view } = setup({ entries: [entry({ path: 'E:\\Antigo\\Sagyou' })] })
    expect(view()?.confirmed).toBe(false)
    expect(await manager.start('p1', 'phone')).toBe('not-confirmed')
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

describe('acesso cortado', () => {
  it('nada sobe: nem PC, nem celular, nem autostart', async () => {
    const { manager, deps, state } = setup({ entries: [entry({ autostart: true })] })
    state.cut = true
    expect(await manager.start('p1', 'pc')).toBe('cut')
    expect(await manager.start('p1', 'phone')).toBe('cut')
    await manager.startAutostart()
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('stopAll(cut) mata os PTYs e nada religa', async () => {
    const { manager, deps, clock, ptys, state, view } = setup({
      entries: [entry({ autostart: true })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit('x')
    state.cut = true
    manager.stopAll('cut')
    expect(ptys[0].killed).toBe(true)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
    // The PTY's own exit event arrives after the kill: ignored.
    ptys[0].exit(1)
    await clock.advance(60 * 60_000)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledTimes(1)
    expect(view()?.state).toBe('stopped')
  })

  it('uma queda com o acesso cortado não religa', async () => {
    const { manager, deps, clock, ptys, state } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    state.cut = true
    ptys[0].exit(1)
    expect(clock.pending()).toBe(0)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
  })

  it('restaurar: startAutostart sobe só os com autostart', async () => {
    const { manager, deps, state } = setup({
      projects: [
        { id: 'p1', name: 'Sagyou', path: DIR },
        { id: 'p2', name: 'Murasaki', path: 'E:\\Projetos\\Murasaki' }
      ],
      entries: [entry({ autostart: true }), entry({ projectId: 'p2', path: null })]
    })
    state.cut = true
    await manager.startAutostart()
    state.cut = false
    await manager.startAutostart()
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.spawn.mock.calls[0][0].cwd).toBe(DIR)
  })
})

describe('religar', () => {
  it('queda com autostart: 30 s, 1, 2, 4, 8 min, teto 15 min', async () => {
    const { manager, deps, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    const waits = [...RC_BACKOFF_MS, 900_000, 900_000]
    expect(waits.slice(0, 6)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000])
    for (const [i, wait] of waits.entries()) {
      ptys[ptys.length - 1].exit(1)
      expect(clock.nextDelay()).toBe(wait)
      await clock.advance(wait - 1)
      expect(deps.spawn).toHaveBeenCalledTimes(i + 1)
      await clock.advance(1)
      expect(deps.spawn).toHaveBeenCalledTimes(i + 2)
    }
    expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_restart', { projectId: 'p1' })
    expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_exit', {
      projectId: 'p1',
      code: 1
    })
    // The terminal kept going: no exit for the renderer.
    expect(deps.onExit).not.toHaveBeenCalled()
  })

  it('depois de 10 min rodando a espera volta a 30 s', async () => {
    const { manager, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    for (const wait of RC_BACKOFF_MS.slice(0, 3)) {
      ptys[ptys.length - 1].exit(1)
      await clock.advance(wait)
    }
    await clock.advance(RC_STABLE_MS)
    ptys[ptys.length - 1].exit(1)
    expect(clock.nextDelay()).toBe(30_000)
  })

  it('a queda escreve a linha no terminal e não emite onExit', async () => {
    const { manager, deps, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    ptys[0].emit('antes')
    ptys[0].exit(1)
    const line = '\r\n[Sagyou] O servidor saiu (código 1). Tentando de novo em 30 s.\r\n'
    expect(deps.onOutput).toHaveBeenLastCalledWith(ID, line)
    expect(deps.onExit).not.toHaveBeenCalled()
    // The buffer does not reset across the restart.
    expect(manager.snapshot(ID)?.log).toBe(`antes${line}`)
  })

  it('stop do usuário não religa', async () => {
    const { manager, deps, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    expect(await manager.stop('p1')).toBe('ok')
    expect(ptys[0].killed).toBe(true)
    ptys[0].exit(0)
    await clock.advance(60 * 60_000)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
    expect(manager.snapshot(ID)).toBeNull()
  })

  it('stop durante a espera cancela o religar', async () => {
    const { manager, deps, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    ptys[0].exit(1)
    expect(await manager.stop('p1')).toBe('ok')
    await clock.advance(60 * 60_000)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
  })

  it('sem autostart: não religa e o terminal acaba', async () => {
    const { manager, deps, clock, ptys } = setup()
    await manager.start('p1', 'pc')
    ptys[0].exit(1)
    expect(clock.pending()).toBe(0)
    await clock.advance(60 * 60_000)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
  })

  it('stopAll(quit): mata tudo e nada mais sobe', async () => {
    const { manager, deps, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    manager.stopAll('quit')
    expect(ptys[0].killed).toBe(true)
    await clock.advance(60 * 60_000)
    expect(await manager.start('p1', 'pc')).not.toBe('ok')
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('servidor de fora do Sagyou', () => {
  it('mesmo --name: estado external, start não sobe outro, stop encerra pelo nome', async () => {
    const { manager, deps, state, view } = setup()
    state.external = ['sagyou']
    await manager.refresh()
    expect(view()?.state).toBe('external')
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(await manager.start('p1', 'phone')).toBe('ok')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(await manager.stop('p1')).toBe('ok')
    expect(deps.killExternal).toHaveBeenCalledWith('Sagyou')
    expect(view()?.state).toBe('stopped')
  })

  it('start confere a lista na hora, sem esperar o refresh', async () => {
    const { manager, deps, state, view } = setup()
    state.external = ['Sagyou']
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(view()?.state).toBe('external')
  })

  it('o servidor do próprio Sagyou não aparece como de fora', async () => {
    const { manager, deps, clock, state, ptys, view } = setup()
    await manager.start('p1', 'pc')
    ptys[0].emit('x')
    state.external = ['Sagyou']
    await clock.advance(RC_SCAN_TTL_MS)
    await manager.refresh()
    expect(view()?.state).toBe('running')
    expect(view()?.error).toBeNull()
    await manager.stop('p1')
    expect(deps.killExternal).not.toHaveBeenCalled()
    expect(view()?.state).toBe('stopped')
  })
})

describe('refresh', () => {
  const cases: [string, (p: RcProject) => RcProject[]][] = [
    ['apagado', () => []],
    ['arquivado', (p) => [{ ...p, archived: true }]],
    ['sem pasta', (p) => [{ ...p, path: null }]]
  ]
  it.each(cases)('projeto %s: PTY morto, fora da lista, onExit', async (_label, change) => {
    const { manager, deps, ptys, setProjects } = setup()
    await manager.start('p1', 'pc')
    setProjects(change({ id: 'p1', name: 'Sagyou', path: DIR }))
    await manager.refresh()
    expect(ptys[0].killed).toBe(true)
    expect(manager.list().map((s) => s.projectId)).not.toContain('p1')
    expect(deps.onExit).toHaveBeenCalledWith(ID)
  })

  it('pasta trocada: encerra e a confirmação não vale para a pasta nova', async () => {
    const NEW = 'E:\\Novo\\Sagyou'
    const { manager, deps, ptys, setProjects, view } = setup({
      entries: [entry({ autostart: true })]
    })
    await manager.start('p1', 'pc')
    setProjects([{ id: 'p1', name: 'Sagyou', path: NEW }])
    await manager.refresh()
    expect(ptys[0].killed).toBe(true)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
    expect(view()?.confirmed).toBe(false)
    expect(await manager.start('p1', 'phone')).toBe('not-confirmed')
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(ptys[1].options.cwd).toBe(NEW)
    ptys[1].emit('Trust this folder?')
    expect(view()?.state).toBe('needs-confirm')
  })
})

describe('configure', () => {
  it('enabled false encerra e mantém confirmedAt', async () => {
    const { manager, deps, ptys, entries } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    manager.configure('p1', { enabled: false })
    expect(ptys[0].killed).toBe(true)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
    expect(entries()).toEqual([entry({ autostart: true, enabled: false })])
  })

  it('cria a entrada de um projeto novo e ignora projeto desconhecido', () => {
    const { manager, entries, view } = setup({ entries: [] })
    manager.configure('p1', { enabled: true, autostart: true })
    manager.configure('zz', { enabled: true })
    expect(entries()).toEqual([
      { projectId: 'p1', enabled: true, autostart: true, confirmedAt: null, path: null }
    ])
    expect(view()).toMatchObject({ enabled: true, autostart: true, state: 'stopped' })
  })

  it('tirar o autostart durante a espera cancela o religar', async () => {
    const { manager, deps, clock, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    ptys[0].exit(1)
    manager.configure('p1', { autostart: false })
    await clock.advance(60 * 60_000)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
  })
})

describe('terminal', () => {
  it('input, resize e snapshot pelo id server:<projectId>', async () => {
    const { manager, ptys } = setup()
    expect(manager.input(ID, 'y')).toBe(false)
    await manager.start('p1', 'pc')
    expect(manager.input(ID, 'y\r')).toBe(true)
    expect(ptys[0].written).toEqual(['y\r'])
    expect(manager.input('server:zz', 'y')).toBe(false)
    expect(manager.input('p1', 'y')).toBe(false)
    expect(manager.resize(ID, 120, 40)).toBe(true)
    expect(ptys[0].sizes).toEqual([[120, 40]])
    ptys[0].emit('ola')
    expect(manager.snapshot(ID)).toEqual({ log: 'ola', cols: 120, rows: 40 })
    expect(manager.snapshot('server:zz')).toBeNull()
  })

  it('o buffer guarda os últimos 8000 caracteres', async () => {
    const { manager, deps, ptys } = setup()
    await manager.start('p1', 'pc')
    ptys[0].emit('a'.repeat(RC_MAX_LOG))
    ptys[0].emit('fim')
    const log = manager.snapshot(ID)?.log ?? ''
    expect(log).toHaveLength(8000)
    expect(log.endsWith('fim')).toBe(true)
    expect(deps.onOutput).toHaveBeenLastCalledWith(ID, 'fim')
  })

  it('nenhum log carrega o comando, a pasta ou a saída', async () => {
    const { manager, deps, clock, ptys, state } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit('segredo-da-saida')
    ptys[0].exit(3)
    await clock.advance(RC_BACKOFF_MS[0])
    await manager.stop('p1')
    state.claude = null
    await manager.start('p1', 'pc')
    const logged = JSON.stringify([...deps.log.info.mock.calls, ...deps.log.warn.mock.calls])
    expect(logged).not.toContain('Projetos')
    expect(logged).not.toContain('claude.exe')
    expect(logged).not.toContain('remote-control')
    expect(logged).not.toContain('segredo-da-saida')
    for (const call of deps.log.info.mock.calls) {
      expect(call[0]).toBe('remote')
      expect(call[2]).toMatchObject({ projectId: 'p1' })
    }
  })
})

describe('projectServerPath', () => {
  const codePaths = [
    { id: 'a', path: 'E:\\A' },
    { id: 'b', path: 'E:\\B' },
    { id: 'c', path: 'E:\\C' }
  ]

  it('primeiro caminho ativo que existe neste PC', () => {
    expect(
      projectServerPath({ codePaths, activeCodePathIds: ['a', 'b'] }, (p) => p === 'E:\\B')
    ).toBe('E:\\B')
    expect(projectServerPath({ codePaths, activeCodePathIds: ['c', 'b'] }, () => true)).toBe(
      'E:\\C'
    )
  })

  it('cai no activeCodePathId legado', () => {
    expect(
      projectServerPath({ codePaths, activeCodePathIds: [], activeCodePathId: 'b' }, () => true)
    ).toBe('E:\\B')
    expect(projectServerPath({ codePaths, activeCodePathId: 'a' }, () => true)).toBe('E:\\A')
  })

  it('nenhum caminho ativo ou existente = null', () => {
    expect(projectServerPath({ codePaths }, () => true)).toBeNull()
    expect(projectServerPath({ codePaths, activeCodePathIds: ['a'] }, () => false)).toBeNull()
    expect(projectServerPath({ activeCodePathIds: ['a'] }, () => true)).toBeNull()
    expect(projectServerPath({ codePaths, activeCodePathIds: ['zz'] }, () => true)).toBeNull()
  })
})

describe('nome e executável (injeção pela linha de comando)', () => {
  it.each([`a b" & echo X & "`, 'P&calc', `"x" --permission-mode bypassPermissions`, 'P%PATH%'])(
    'nome %s: não sobe, start-failed com o aviso e log server_refused',
    async (name) => {
      const { manager, deps, entries, view } = setup({
        projects: [{ id: 'p1', name, path: DIR }],
        entries: []
      })
      expect(await manager.start('p1', 'pc')).toBe('start-failed')
      expect(deps.spawn).not.toHaveBeenCalled()
      expect(deps.externalNames).not.toHaveBeenCalled()
      expect(view()?.error).toBe(RC_TEXT.badName)
      expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_refused', {
        projectId: 'p1',
        reason: 'name'
      })
      // A refused "Ligar" does not turn the server on either.
      expect(entries()).toEqual([])
    }
  )

  it('nome inválido também não sobe pelo autostart', async () => {
    const { manager, deps } = setup({
      projects: [{ id: 'p1', name: 'P&calc', path: DIR }],
      entries: [entry({ autostart: true })]
    })
    await manager.startAutostart()
    expect(await manager.start('p1', 'phone')).toBe('start-failed')
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('nomes comuns passam; vazio, longo ou com aspas, &, % e quebra de linha não', () => {
    for (const ok of [
      'Sagyou',
      'Mudança Japão',
      'Sagyou (beta) 2.0_x-y',
      '日本語',
      'a'.repeat(64)
    ]) {
      expect(validServerName(ok)).toBe(true)
    }
    for (const bad of ['', 'a'.repeat(65), 'a"b', 'a&b', 'a%b', 'a\nb', 'a|b', 'a^b', 'a<b']) {
      expect(validServerName(bad)).toBe(false)
    }
  })

  it.each([
    String.raw`C:\npm\claude.cmd`,
    String.raw`C:\npm\claude.bat`,
    String.raw`C:\npm\claude`
  ])('claude resolvido em %s: start-failed com o aviso do nativo', async (claude) => {
    const { manager, deps, state, view } = setup()
    state.claude = claude
    expect(await manager.start('p1', 'pc')).toBe('start-failed')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(view()).toMatchObject({ state: 'stopped', error: RC_TEXT.notNative })
  })

  it('claude.EXE em maiúsculas é aceito', async () => {
    const { manager, deps, state } = setup()
    state.claude = String.raw`C:\Users\l\.local\bin\CLAUDE.EXE`
    expect(await manager.start('p1', 'pc')).toBe('ok')
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })

  it('dois projetos com o mesmo nome: o segundo não sobe', async () => {
    const { manager, deps, entries, view } = setup({
      projects: [
        { id: 'p1', name: 'Sagyou', path: DIR },
        { id: 'p2', name: 'sagyou ', path: String.raw`E:\Outro\Sagyou` }
      ]
    })
    expect(await manager.start('p2', 'pc')).toBe('start-failed')
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(view('p2')?.error).toBe(RC_TEXT.sameName)
    expect(entries().map((e) => e.projectId)).toEqual(['p1'])
    expect(await manager.start('p1', 'pc')).toBe('ok')
  })
})

describe('origem autostart', () => {
  it('entrada migrada nunca vira confirmada só pelo autostart', async () => {
    const { manager, deps, clock, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    ptys[0].emit('Enable Remote Control? (y/n)')
    await clock.advance(RC_CONFIRM_MS * 3)
    expect(deps.saveEntries).not.toHaveBeenCalled()
    expect(view()).toMatchObject({ state: 'needs-confirm', confirmed: false })
    expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_start', {
      projectId: 'p1',
      origin: 'autostart'
    })
  })

  it('autostart que desenha "Ready" confirma: as perguntas já foram respondidas', async () => {
    const { manager, ptys, entries, view, clock } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    ptys[0].emit('Spawn mode: worktree\r\n')
    expect(view()).toMatchObject({ state: 'needs-confirm', confirmed: false })
    ptys[0].emit(statusLine('Ready'))
    expect(entries()[0]).toMatchObject({
      confirmedAt: new Date(clock.now()).toISOString(),
      path: DIR
    })
    expect(view()).toMatchObject({ state: 'running', confirmed: true })
  })

  it('"Connected" (sessão aberta) também confirma, inclusive depois de um redesenho', async () => {
    const { manager, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    ptys[0].emit('\x1b[1A\x1b[2K' + statusLine('Connected'))
    expect(view()?.confirmed).toBe(true)
  })

  it('a linha partida entre dois pedaços também confirma', async () => {
    const { manager, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    const line = statusLine('Connected')
    ptys[0].emit(line.slice(0, 12))
    expect(view()?.confirmed).toBe(false)
    ptys[0].emit(line.slice(12))
    expect(view()?.confirmed).toBe(true)
  })

  it('o que não é a linha de status do Claude não confirma', async () => {
    const { manager, deps, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    ptys[0].emit(
      [
        'Disconnected',
        'Not Connected',
        '✓ Connected',
        '·✔︎· Connectedness',
        '·✔︎· Disconnected',
        'pasta ·✔︎· Connected · x',
        'pasta\x1b[1C·✔︎· Ready',
        'Enable Remote Control? (y/n) '
      ].join('\r\n')
    )
    expect(deps.saveEntries).not.toHaveBeenCalled()
    expect(view()?.confirmed).toBe(false)
  })

  it('a pergunta pendente não confirma nem depois de muito tempo', async () => {
    const { manager, deps, ptys, clock } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    ptys[0].emit('Take this session with you…\r\nEnable Remote Control? (y/n) ')
    await clock.advance(RC_CONFIRM_MS * 10)
    expect(deps.saveEntries).not.toHaveBeenCalled()
  })

  it('a saída de antes de religar não conta para a execução nova', async () => {
    const { manager, deps, clock, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.startAutostart()
    const line = statusLine('Ready')
    ptys[0].emit(line.slice(0, 12))
    ptys[0].exit(1)
    await clock.advance(RC_BACKOFF_MS[0])
    expect(deps.spawn).toHaveBeenCalledTimes(2)
    ptys[1].emit(line.slice(12))
    expect(deps.saveEntries).not.toHaveBeenCalled()
    expect(view()?.confirmed).toBe(false)
    ptys[1].emit(line)
    expect(view()?.confirmed).toBe(true)
  })

  it('Ligar no PC que chega a "Ready" confirma na hora e o timer não grava de novo', async () => {
    const { manager, deps, ptys, clock } = setup({
      entries: [entry({ confirmedAt: null, path: null })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit(statusLine('Ready'))
    expect(deps.saveEntries).toHaveBeenCalledTimes(1)
    await clock.advance(RC_CONFIRM_MS * 2)
    expect(deps.saveEntries).toHaveBeenCalledTimes(1)
  })

  it('já confirmado: a linha não grava de novo', async () => {
    const { manager, deps, ptys } = setup({ entries: [entry({ autostart: true })] })
    await manager.startAutostart()
    ptys[0].emit(statusLine('Connected'))
    ptys[0].emit(statusLine('Ready'))
    expect(deps.saveEntries).not.toHaveBeenCalled()
  })

  it('autostart não liga um servidor desligado', async () => {
    const { manager, deps } = setup({ entries: [entry({ enabled: false, autostart: true })] })
    await manager.startAutostart()
    expect(await manager.start('p1', 'autostart')).toBe('unknown-server')
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('o religar depois de uma queda não confirma', async () => {
    const { manager, deps, clock, ptys, view } = setup({
      entries: [entry({ autostart: true, confirmedAt: null, path: null })]
    })
    await manager.start('p1', 'pc')
    ptys[0].emit('x')
    await clock.advance(10_000)
    ptys[0].exit(1)
    await clock.advance(RC_BACKOFF_MS[0])
    expect(deps.spawn).toHaveBeenCalledTimes(2)
    ptys[1].emit('x')
    await clock.advance(RC_CONFIRM_MS * 3)
    expect(deps.saveEntries).not.toHaveBeenCalled()
    expect(view()?.confirmed).toBe(false)
  })
})

describe('insideGitRepo', () => {
  const repo = String.raw`E:\Projetos\.git`

  it('acha o .git na pasta ou num pai, de baixo para cima', () => {
    const seen: string[] = []
    const exists = (p: string): boolean => {
      seen.push(p)
      return p === repo
    }
    expect(insideGitRepo(String.raw`E:\Projetos`, exists)).toBe(true)
    seen.length = 0
    expect(insideGitRepo(String.raw`E:\Projetos\Sagyou\apps`, exists)).toBe(true)
    expect(seen).toEqual([
      String.raw`E:\Projetos\Sagyou\apps\.git`,
      String.raw`E:\Projetos\Sagyou\.git`,
      repo
    ])
  })

  it('fora de um repositório = false, e para na raiz', () => {
    const exists = (p: string): boolean => p === repo
    expect(insideGitRepo(String.raw`E:\Outro\Sagyou`, exists)).toBe(false)
    expect(insideGitRepo('E:\\', exists)).toBe(false)
  })
})

describe('varredura de processos', () => {
  it('duas chamadas seguidas = uma varredura; depois de 5 s, outra', async () => {
    const { manager, deps, clock } = setup()
    await manager.refresh()
    await manager.refresh()
    expect(deps.externalNames).toHaveBeenCalledTimes(1)
    await clock.advance(RC_SCAN_TTL_MS)
    await manager.refresh()
    expect(deps.externalNames).toHaveBeenCalledTimes(2)
  })

  it('várias em voo ao mesmo tempo = uma varredura', async () => {
    const { manager, deps } = setup()
    await Promise.all([manager.refresh(), manager.refresh(), manager.start('p1', 'pc')])
    expect(deps.externalNames).toHaveBeenCalledTimes(1)
  })

  it('refreshProjects não varre os processos', async () => {
    const { manager, deps, ptys, setProjects } = setup()
    await manager.start('p1', 'pc')
    deps.externalNames.mockClear()
    setProjects([])
    manager.refreshProjects()
    expect(ptys[0].killed).toBe(true)
    expect(deps.externalNames).not.toHaveBeenCalled()
  })

  it('outro processo com o nome do nosso servidor: avisa da tarefa antiga', async () => {
    const { manager, clock, ptys, state, view } = setup()
    await manager.start('p1', 'pc')
    ptys[0].emit('x')
    state.external = ['Sagyou', 'sagyou']
    await clock.advance(RC_SCAN_TTL_MS)
    await manager.refresh()
    expect(view()).toMatchObject({ state: 'running', error: RC_TEXT.doubled })
    state.external = ['Sagyou']
    await clock.advance(RC_SCAN_TTL_MS)
    await manager.refresh()
    expect(view()?.error).toBeNull()
  })
})

describe('projeto renomeado', () => {
  it('com autostart: encerra e religa com o nome novo', async () => {
    const { manager, deps, ptys, setProjects } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    setProjects([{ id: 'p1', name: 'Sagyou Novo', path: DIR }])
    manager.refreshProjects()
    expect(ptys[0].killed).toBe(true)
    expect(deps.onExit).toHaveBeenCalledWith(ID)
    expect(deps.log.info).toHaveBeenCalledWith('remote', 'server_stop', {
      projectId: 'p1',
      reason: 'name'
    })
    await flush()
    await flush()
    expect(deps.spawn).toHaveBeenCalledTimes(2)
    expect(ptys[1].options.args.slice(0, 3)).toEqual(['remote-control', '--name', 'Sagyou Novo'])
  })

  it('sem autostart: só encerra', async () => {
    const { manager, deps, ptys, setProjects } = setup()
    await manager.start('p1', 'pc')
    setProjects([{ id: 'p1', name: 'Sagyou Novo', path: DIR }])
    manager.refreshProjects()
    await flush()
    expect(ptys[0].killed).toBe(true)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('reopen', () => {
  it('depois de stopAll(quit) e uma instalação abortada, volta a subir', async () => {
    const { manager, deps } = setup({ entries: [entry({ autostart: true })] })
    await manager.start('p1', 'pc')
    manager.stopAll('quit')
    expect(await manager.start('p1', 'pc')).not.toBe('ok')
    manager.reopen()
    await manager.startAutostart()
    expect(deps.spawn).toHaveBeenCalledTimes(2)
  })
})
