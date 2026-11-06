// Shutting the PC down from the phone (spec docs/specs/2026-11-03-controle-remoto-app.md).
//
// The renderer saves first (the same flush `update:install` uses); if that
// fails, nothing is shut down. Then the agent runs' timers stop (as in
// before-quit) and Windows gets a 60 s shutdown the phone can still cancel.
// Whatever goes wrong on the way, and every cancel, calls `restore`: the flush
// took the screen and the timers away, and the session goes on.
import { win32 } from 'path'

export const SHUTDOWN_DELAY_S = 60
export const SHUTDOWN_COMMENT = 'Sagyou: desligando pelo celular'

/**
 * Absolute path of a Windows tool (`%SystemRoot%\System32\<name>`), so a file of
 * the same name in the working folder or on PATH is never the one that runs.
 */
export function systemExe(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  return win32.join(root, 'System32', name)
}

export interface ShutdownDeps {
  flush: () => Promise<boolean>
  stopRunTimers: () => Promise<void>
  exec: (cmd: string, args: string[]) => Promise<void>
  /** Gives the screen and the X back and lets the run timers count again. */
  restore: () => void
  now: () => number
  env?: NodeJS.ProcessEnv
}

export interface Shutdown {
  /** `failed`: an error after the flush (timers or `shutdown.exe`); nothing was scheduled. */
  start(): Promise<'ok' | 'flush-failed' | 'failed'>
  /** Always restores, even when `shutdown /a` fails (and then rethrows). */
  abort(): Promise<void>
  /** When Windows will shut down, or null. */
  at(): number | null
}

export function createShutdown(deps: ShutdownDeps): Shutdown {
  let scheduledAt: number | null = null
  const exe = (): string => systemExe('shutdown.exe', deps.env)
  const at = (): number | null =>
    scheduledAt !== null && deps.now() < scheduledAt ? scheduledAt : null

  return {
    async start() {
      // A second request while one is scheduled: the phone already shows it.
      if (at() !== null) return 'ok'
      try {
        if (!(await deps.flush())) {
          deps.restore()
          return 'flush-failed'
        }
        await deps.stopRunTimers()
        await deps.exec(exe(), ['/s', '/t', String(SHUTDOWN_DELAY_S), '/c', SHUTDOWN_COMMENT])
      } catch {
        deps.restore()
        return 'failed'
      }
      scheduledAt = deps.now() + SHUTDOWN_DELAY_S * 1000
      return 'ok'
    },
    async abort() {
      try {
        await deps.exec(exe(), ['/a'])
        scheduledAt = null
      } finally {
        deps.restore()
      }
    },
    at
  }
}
