// Shutting the PC down from the phone (spec docs/specs/2026-11-03-controle-remoto-app.md).
//
// The renderer saves first (the same flush `update:install` uses); if that
// fails, nothing is shut down. Then the agent runs' timers stop (as in
// before-quit) and Windows gets a 60 s shutdown the phone can still cancel.

export const SHUTDOWN_DELAY_S = 60
export const SHUTDOWN_COMMENT = 'Sagyou: desligando pelo celular'

export interface ShutdownDeps {
  flush: () => Promise<boolean>
  stopRunTimers: () => Promise<void>
  exec: (cmd: string, args: string[]) => Promise<void>
  now: () => number
}

export interface Shutdown {
  start(): Promise<'ok' | 'flush-failed'>
  abort(): Promise<void>
  /** When Windows will shut down, or null. */
  at(): number | null
}

export function createShutdown(deps: ShutdownDeps): Shutdown {
  let scheduledAt: number | null = null
  return {
    async start() {
      if (!(await deps.flush())) return 'flush-failed'
      await deps.stopRunTimers()
      await deps.exec('shutdown', [
        '/s',
        '/t',
        String(SHUTDOWN_DELAY_S),
        '/c',
        SHUTDOWN_COMMENT
      ])
      scheduledAt = deps.now() + SHUTDOWN_DELAY_S * 1000
      return 'ok'
    },
    async abort() {
      await deps.exec('shutdown', ['/a'])
      scheduledAt = null
    },
    at: () => scheduledAt
  }
}
