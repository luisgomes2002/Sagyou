// The Remote Control servers this Sagyou starts, ends and restarts, one per
// project (spec docs/specs/2026-11-09-servidores-remote-control.md).
//
// Each server is `claude remote-control --name "<projeto>"` in a PTY of its own,
// with the project's folder as the working directory and no shell in between.
// Its terminal (`server:<projectId>`) is shown in the Fleet, where the
// first-run questions are answered at the PC: a project counts as confirmed for
// a folder once a server started at the PC has run there for RC_CONFIRM_MS, and
// only then may the phone start it. A server that falls is started again (only
// with "Iniciar com o Sagyou") after a growing wait; one turned off by the user,
// by the cut or by the Sagyou closing never is. A server already running outside
// the Sagyou with the same --name is shown as such and never doubled.
//
// Effects go through injected functions; this module never touches the disk,
// the process list or node-pty itself. Logs carry the project id only: never
// the command, the folder or the terminal output.
import type { ServerState } from '@sagyou/core/control/messages'
import type { AgentPty, AgentPtyOptions } from '../agent/agent-pty'
import type { Logger } from '../logs/logger'
import { MAX_RC_SERVERS, type RcServerEntry } from './remote-config'

/** A server started at the PC confirms its project after running this long. */
export const RC_CONFIRM_MS = 60_000
/** Waits before each restart of a server that fell; the last one is the ceiling. */
export const RC_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000]
/** A run this long sends the next restart back to the first wait. */
export const RC_STABLE_MS = 600_000
/** Last characters of a server's terminal kept for a reconnect (as MAX_AGENT_LOG). */
export const RC_MAX_LOG = 8000

export const RC_TEXT = {
  noClaude: 'Claude Code não encontrado',
  startFailed: 'O servidor não subiu.'
} as const

export type RcOrigin = 'pc' | 'phone'
export type RcStartResult = 'ok' | 'not-confirmed' | 'cut' | 'unknown-server' | 'start-failed'
export type RcStopResult = 'ok' | 'unknown-server'

export interface RcProject {
  id: string
  name: string
  /** The project's folder on this PC (`projectServerPath`), or null. */
  path: string | null
  /** An archived project has no server; the caller may also just leave it out. */
  archived?: boolean
}

export interface RcServerView {
  projectId: string
  name: string
  enabled: boolean
  autostart: boolean
  state: ServerState
  /** The first-run questions were answered at the PC for the current folder. */
  confirmed: boolean
  error: string | null
}

export interface RcManagerDeps {
  platform: NodeJS.Platform
  projects: () => RcProject[]
  entries: () => RcServerEntry[]
  saveEntries: (entries: RcServerEntry[]) => void
  resolveClaude: () => string | null
  hasGit: (dir: string) => boolean
  spawn: (options: AgentPtyOptions) => AgentPty
  /** --name of every remote-control running on this PC (ours included). */
  externalNames: () => Promise<string[]>
  /** Ends the processes started with that --name; how many. */
  killExternal: (name: string) => Promise<number>
  accessCut: () => boolean
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  log: Pick<Logger, 'info' | 'warn'>
  onOutput: (id: string, chunk: string) => void
  /** The terminal is gone for good (not on a fall that will be restarted). */
  onExit: (id: string) => void
  /** Something list() shows changed. */
  onChange: () => void
  /** Environment of the server; process.env when absent. */
  env?: () => NodeJS.ProcessEnv
}

export interface RcManager {
  list(): RcServerView[]
  start(projectId: string, origin: RcOrigin): Promise<RcStartResult>
  stop(projectId: string): Promise<RcStopResult>
  configure(projectId: string, patch: { enabled?: boolean; autostart?: boolean }): void
  startAutostart(): Promise<void>
  stopAll(reason: 'cut' | 'quit'): void
  refresh(): Promise<void>
  input(id: string, data: string): boolean
  resize(id: string, cols: number, rows: number): boolean
  snapshot(id: string): { log: string; cols?: number; rows?: number } | null
}

const TERMINAL_PREFIX = 'server:'

export function serverTerminalId(projectId: string): string {
  return `${TERMINAL_PREFIX}${projectId}`
}

/** The exact arguments after the `claude` executable. */
export function serverArgs(name: string, hasGit: boolean): string[] {
  return [
    'remote-control',
    '--name',
    name,
    '--spawn',
    hasGit ? 'worktree' : 'same-dir',
    '--permission-mode',
    'manual'
  ]
}

/**
 * The folder a project's server runs in: the first active code path
 * (`activeCodePathIds`, else the legacy `activeCodePathId`) that exists on this
 * PC, or null.
 */
export function projectServerPath(
  project: {
    codePaths?: { id: string; path: string }[]
    activeCodePathIds?: string[]
    activeCodePathId?: string | null
  },
  exists: (p: string) => boolean
): string | null {
  const ids =
    project.activeCodePathIds && project.activeCodePathIds.length > 0
      ? project.activeCodePathIds
      : project.activeCodePathId
        ? [project.activeCodePathId]
        : []
  for (const id of ids) {
    const path = project.codePaths?.find((c) => c.id === id)?.path
    if (path && exists(path)) return path
  }
  return null
}

export function serverLine(code: number, delayMs: number): string {
  return `\r\n[Sagyou] O servidor saiu (código ${code}). Tentando de novo em ${delayMs / 1000} s.\r\n`
}

interface Terminal {
  projectId: string
  name: string
  path: string
  origin: RcOrigin
  /** Null between a fall and its restart. */
  pty: AgentPty | null
  /** Bumped on every launch and on the end: stale callbacks compare it. */
  gen: number
  gotData: boolean
  startedAt: number
  log: string
  confirmTimer: unknown
  restartTimer: unknown
  cols?: number
  rows?: number
}

type EligibleProject = RcProject & { path: string }

const key = (name: string): string => name.trim().toLowerCase()

export function createRcManager(deps: RcManagerDeps): RcManager {
  const supported = deps.platform === 'win32'
  const terminals = new Map<string, Terminal>()
  const attempts = new Map<string, number>()
  const errors = new Map<string, string>()
  const inflight = new Map<string, Promise<RcStartResult>>()
  let external = new Set<string>()
  let closed = false
  let lastView = ''

  const eligible = (): Map<string, EligibleProject> => {
    const out = new Map<string, EligibleProject>()
    for (const p of deps.projects()) {
      if (!p.archived && p.path) out.set(p.id, p as EligibleProject)
    }
    return out
  }
  const projectOf = (id: string): EligibleProject | null => eligible().get(id) ?? null
  const entryOf = (id: string): RcServerEntry | null =>
    deps.entries().find((e) => e.projectId === id) ?? null
  const isConfirmed = (entry: RcServerEntry | null, path: string): boolean =>
    !!entry && entry.confirmedAt !== null && entry.path === path
  const live = (t: Terminal, gen: number): boolean =>
    terminals.get(t.projectId) === t && t.gen === gen

  function updateEntry(id: string, patch: Partial<Omit<RcServerEntry, 'projectId'>>): boolean {
    const all = deps.entries()
    if (all.some((e) => e.projectId === id)) {
      deps.saveEntries(all.map((e) => (e.projectId === id ? { ...e, ...patch } : e)))
      return true
    }
    if (all.length >= MAX_RC_SERVERS) {
      deps.log.warn('remote', 'server_refused', { projectId: id, reason: 'limit' })
      return false
    }
    deps.saveEntries([
      ...all,
      { projectId: id, enabled: false, autostart: false, confirmedAt: null, path: null, ...patch }
    ])
    return true
  }

  function stateOf(p: EligibleProject, entry: RcServerEntry | null): ServerState {
    const t = terminals.get(p.id)
    if (t?.pty) {
      if (!t.gotData) return 'starting'
      return isConfirmed(entry, t.path) ? 'running' : 'needs-confirm'
    }
    if (inflight.has(p.id)) return 'starting'
    if (external.has(key(p.name))) return 'external'
    return 'stopped'
  }

  function list(): RcServerView[] {
    if (!supported) return []
    const entries = deps.entries()
    return [...eligible().values()].map((p) => {
      const entry = entries.find((e) => e.projectId === p.id) ?? null
      return {
        projectId: p.id,
        name: p.name,
        enabled: entry?.enabled ?? false,
        autostart: entry?.autostart ?? false,
        state: stateOf(p, entry),
        confirmed: isConfirmed(entry, p.path),
        error: errors.get(p.id) ?? null
      }
    })
  }

  /** onChange only when what list() shows really changed. */
  function notify(): void {
    const view = JSON.stringify(list())
    if (view === lastView) return
    lastView = view
    deps.onChange()
  }

  function refused<R extends RcStartResult>(projectId: string, reason: R): R {
    deps.log.info('remote', 'server_refused', { projectId, reason })
    return reason
  }

  async function runningNames(): Promise<Set<string>> {
    try {
      return new Set((await deps.externalNames()).map(key))
    } catch {
      return new Set()
    }
  }

  function append(t: Terminal, chunk: string): void {
    t.log = (t.log + chunk).slice(-RC_MAX_LOG)
    deps.onOutput(serverTerminalId(t.projectId), chunk)
  }

  /** Ends a terminal for good: no restart, the renderer drops its tab. */
  function end(t: Terminal): void {
    if (terminals.get(t.projectId) === t) terminals.delete(t.projectId)
    t.gen += 1
    if (t.confirmTimer !== null) deps.clearTimer(t.confirmTimer)
    if (t.restartTimer !== null) deps.clearTimer(t.restartTimer)
    t.confirmTimer = null
    t.restartTimer = null
    const pty = t.pty
    t.pty = null
    if (pty) {
      try {
        pty.kill()
      } catch {
        // Already gone.
      }
    }
    deps.onExit(serverTerminalId(t.projectId))
  }

  function launch(t: Terminal, claude: string): boolean {
    t.gen += 1
    const gen = t.gen
    t.gotData = false
    t.startedAt = deps.now()
    try {
      t.pty = deps.spawn({
        command: claude,
        args: serverArgs(t.name, deps.hasGit(t.path)),
        cwd: t.path,
        env: deps.env ? deps.env() : process.env,
        cols: t.cols,
        rows: t.rows,
        onData: (chunk) => {
          if (live(t, gen)) onData(t, chunk)
        },
        onExit: (code) => {
          if (live(t, gen)) onPtyExit(t, code)
        }
      })
    } catch {
      t.pty = null
      return false
    }
    if (t.origin === 'pc' && !isConfirmed(entryOf(t.projectId), t.path)) {
      t.confirmTimer = deps.setTimer(() => confirm(t, gen), RC_CONFIRM_MS)
    }
    return true
  }

  function confirm(t: Terminal, gen: number): void {
    if (!live(t, gen) || !t.pty) return
    t.confirmTimer = null
    updateEntry(t.projectId, { confirmedAt: new Date(deps.now()).toISOString(), path: t.path })
    notify()
  }

  function onData(t: Terminal, chunk: string): void {
    append(t, chunk)
    if (!t.gotData) {
      t.gotData = true
      notify()
    }
  }

  function mayRestart(t: Terminal): boolean {
    if (closed || deps.accessCut()) return false
    const p = projectOf(t.projectId)
    const entry = entryOf(t.projectId)
    return !!p && p.path === t.path && !!entry?.enabled && entry.autostart
  }

  function onPtyExit(t: Terminal, code: number): void {
    t.pty = null
    if (t.confirmTimer !== null) deps.clearTimer(t.confirmTimer)
    t.confirmTimer = null
    deps.log.info('remote', 'server_exit', { projectId: t.projectId, code })
    if (!mayRestart(t)) {
      end(t)
      notify()
      return
    }
    if (deps.now() - t.startedAt >= RC_STABLE_MS) attempts.set(t.projectId, 0)
    const n = attempts.get(t.projectId) ?? 0
    const delay = RC_BACKOFF_MS[Math.min(n, RC_BACKOFF_MS.length - 1)]
    attempts.set(t.projectId, n + 1)
    append(t, serverLine(code, delay))
    const gen = t.gen
    t.restartTimer = deps.setTimer(() => {
      if (!live(t, gen)) return
      t.restartTimer = null
      void relaunch(t)
    }, delay)
    notify()
  }

  async function relaunch(t: Terminal): Promise<void> {
    const gen = t.gen
    if (!mayRestart(t)) {
      end(t)
      notify()
      return
    }
    const names = await runningNames()
    if (!live(t, gen) || t.pty) return
    if (!mayRestart(t)) {
      end(t)
      notify()
      return
    }
    if (names.has(key(t.name))) {
      external.add(key(t.name))
      end(t)
      notify()
      return
    }
    const claude = deps.resolveClaude()
    if (!claude) {
      errors.set(t.projectId, RC_TEXT.noClaude)
      end(t)
      notify()
      return
    }
    if (!launch(t, claude)) {
      errors.set(t.projectId, RC_TEXT.startFailed)
      end(t)
      notify()
      return
    }
    errors.delete(t.projectId)
    deps.log.info('remote', 'server_restart', { projectId: t.projectId })
    notify()
  }

  async function doStart(p: EligibleProject, origin: RcOrigin): Promise<RcStartResult> {
    const names = await runningNames()
    if (closed) return 'start-failed'
    if (deps.accessCut()) return refused(p.id, 'cut')
    const existing = terminals.get(p.id) ?? null
    if (existing?.pty) return 'ok'
    if (names.has(key(p.name))) {
      // Already running outside the Sagyou: never a second one with that name.
      external.add(key(p.name))
      if (existing) end(existing)
      return 'ok'
    }
    external.delete(key(p.name))
    const claude = deps.resolveClaude()
    if (!claude) {
      errors.set(p.id, RC_TEXT.noClaude)
      if (existing) end(existing)
      return refused(p.id, 'start-failed')
    }
    const t: Terminal = existing ?? {
      projectId: p.id,
      name: p.name,
      path: p.path,
      origin,
      pty: null,
      gen: 0,
      gotData: false,
      startedAt: 0,
      log: '',
      confirmTimer: null,
      restartTimer: null
    }
    if (t.restartTimer !== null) deps.clearTimer(t.restartTimer)
    t.restartTimer = null
    t.name = p.name
    t.path = p.path
    t.origin = origin
    terminals.set(p.id, t)
    attempts.set(p.id, 0)
    if (!launch(t, claude)) {
      errors.set(p.id, RC_TEXT.startFailed)
      if (existing) end(t)
      else terminals.delete(p.id)
      return refused(p.id, 'start-failed')
    }
    errors.delete(p.id)
    deps.log.info('remote', 'server_start', { projectId: p.id, origin })
    return 'ok'
  }

  async function start(projectId: string, origin: RcOrigin): Promise<RcStartResult> {
    if (!supported || closed) return 'unknown-server'
    const p = projectOf(projectId)
    if (!p) return refused(projectId, 'unknown-server')
    const entry = entryOf(projectId)
    if (origin === 'phone' && !entry?.enabled) return refused(projectId, 'unknown-server')
    if (deps.accessCut()) return refused(projectId, 'cut')
    const pending = inflight.get(projectId)
    if (pending) return pending
    const t = terminals.get(projectId)
    if (t?.pty) return 'ok'
    if (origin === 'phone' && !isConfirmed(entry, p.path)) {
      return refused(projectId, 'not-confirmed')
    }
    // "Ligar" at the PC turns the project's server on.
    if (origin === 'pc' && !entry?.enabled) updateEntry(projectId, { enabled: true })
    // A start now replaces a pending restart.
    if (t && t.restartTimer !== null) {
      deps.clearTimer(t.restartTimer)
      t.restartTimer = null
    }
    const run = doStart(p, origin).finally(() => {
      inflight.delete(projectId)
      notify()
    })
    inflight.set(projectId, run)
    notify()
    return run
  }

  async function stop(projectId: string): Promise<RcStopResult> {
    if (!supported) return 'unknown-server'
    const pending = inflight.get(projectId)
    if (pending) await pending
    const t = terminals.get(projectId)
    if (t) {
      end(t)
      deps.log.info('remote', 'server_stop', { projectId })
      notify()
      return 'ok'
    }
    const p = projectOf(projectId)
    if (!p) return 'unknown-server'
    if (external.has(key(p.name))) {
      try {
        await deps.killExternal(p.name)
      } catch {
        // The next refresh shows whether it is still there.
      }
      external.delete(key(p.name))
      deps.log.info('remote', 'server_stop', { projectId, external: true })
      notify()
    }
    return 'ok'
  }

  function configure(projectId: string, patch: { enabled?: boolean; autostart?: boolean }): void {
    if (!supported || !projectOf(projectId)) return
    const clean: { enabled?: boolean; autostart?: boolean } = {}
    if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled
    if (typeof patch.autostart === 'boolean') clean.autostart = patch.autostart
    if (!updateEntry(projectId, clean)) return
    const entry = entryOf(projectId)
    const t = terminals.get(projectId)
    if (t && entry && !entry.enabled) {
      // Turning the server off ends it and keeps the confirmation.
      end(t)
      deps.log.info('remote', 'server_stop', { projectId })
    } else if (t && !t.pty && entry && !entry.autostart) {
      // A restart was waiting: without "Iniciar com o Sagyou" it does not happen.
      end(t)
    }
    notify()
  }

  async function startAutostart(): Promise<void> {
    if (!supported || closed || deps.accessCut()) return
    const projects = eligible()
    for (const entry of deps.entries()) {
      if (!entry.enabled || !entry.autostart || !projects.has(entry.projectId)) continue
      await start(entry.projectId, 'pc')
    }
  }

  function stopAll(reason: 'cut' | 'quit'): void {
    if (reason === 'quit') closed = true
    for (const t of [...terminals.values()]) {
      end(t)
      deps.log.info('remote', 'server_stop', { projectId: t.projectId, reason })
    }
    notify()
  }

  async function refresh(): Promise<void> {
    if (!supported || closed) return
    const projects = eligible()
    for (const t of [...terminals.values()]) {
      const p = projects.get(t.projectId)
      if (p && p.path === t.path) continue
      // Removed, archived, without a folder, or moved to another folder.
      end(t)
      deps.log.info('remote', 'server_stop', {
        projectId: t.projectId,
        reason: p ? 'path' : 'removed'
      })
    }
    const names = await runningNames()
    // A name of a terminal of ours is ours, not one from outside.
    const ours = new Set([...terminals.values()].filter((t) => t.pty).map((t) => key(t.name)))
    external = new Set([...names].filter((n) => !ours.has(n)))
    notify()
  }

  function terminalOf(id: string): Terminal | null {
    if (!id.startsWith(TERMINAL_PREFIX)) return null
    return terminals.get(id.slice(TERMINAL_PREFIX.length)) ?? null
  }

  function input(id: string, data: string): boolean {
    const t = terminalOf(id)
    if (!t?.pty) return false
    try {
      t.pty.write(data)
      return true
    } catch {
      return false
    }
  }

  function resize(id: string, cols: number, rows: number): boolean {
    const t = terminalOf(id)
    if (!t) return false
    t.cols = cols
    t.rows = rows
    if (!t.pty) return false
    try {
      t.pty.resize(cols, rows)
      return true
    } catch {
      return false
    }
  }

  function snapshot(id: string): { log: string; cols?: number; rows?: number } | null {
    const t = terminalOf(id)
    if (!t) return null
    return { log: t.log, cols: t.cols, rows: t.rows }
  }

  return {
    list,
    start,
    stop,
    configure,
    startAutostart,
    stopAll,
    refresh,
    input,
    resize,
    snapshot
  }
}
