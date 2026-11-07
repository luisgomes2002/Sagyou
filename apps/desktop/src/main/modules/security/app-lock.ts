export type LockReason = 'idle' | 'system-lock' | 'suspend' | 'manual' | 'remote'

/** How long the renderer has to save before main locks anyway. */
export const LOCK_RENDERER_TIMEOUT_MS = 5_000

export interface AppLockDeps {
  isUnlocked: () => boolean
  setUnlocked: (value: boolean) => void
  /**
   * Runs first, while the data IPC is still open (deny pending approval cards,
   * stop the agent runs' timers through the renderer). Its result is ignored:
   * a failure or a hang never keeps the app open.
   */
  prepare?: (reason: LockReason) => Promise<void>
  /** Sends `security:lock-request`: the renderer saves, then answers `security:lock-ready`. */
  askRenderer: () => void
  onLocked: (reason: LockReason) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/**
 * Locking an unlocked app: prepare, then the renderer saves (its data IPC
 * closes the moment main locks), then main flips the same `passwordUnlocked`
 * flag the startup lock uses. The deadline covers prepare and the save, so a
 * renderer that never answers cannot keep the app open.
 */
export function createAppLock(deps: AppLockDeps): {
  lock: (reason: LockReason) => void
  rendererReady: () => void
  isLocking: () => boolean
} {
  let pending: { reason: LockReason; timer: unknown; asked: boolean } | null = null

  const finish = (): void => {
    if (!pending) return
    const { reason, timer } = pending
    pending = null
    deps.clearTimer(timer)
    deps.setUnlocked(false)
    deps.onLocked(reason)
  }

  return {
    lock: (reason) => {
      if (pending || !deps.isUnlocked()) return
      const current = { reason, timer: null as unknown, asked: false }
      current.timer = deps.setTimer(finish, LOCK_RENDERER_TIMEOUT_MS)
      pending = current
      const ask = (): void => {
        if (pending !== current || current.asked) return
        current.asked = true
        deps.askRenderer()
      }
      if (!deps.prepare) ask()
      else void deps.prepare(reason).then(ask, ask)
    },
    // Only an answer to a request actually sent counts: an early or stray
    // lock-ready cannot skip the renderer's save.
    rendererReady: () => {
      if (pending?.asked) finish()
    },
    isLocking: () => pending !== null
  }
}
