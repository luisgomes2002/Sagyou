export type LockReason = 'idle' | 'system-lock' | 'suspend' | 'manual'

/** How long the renderer has to save before main locks anyway. */
export const LOCK_RENDERER_TIMEOUT_MS = 5_000

export interface AppLockDeps {
  isUnlocked: () => boolean
  setUnlocked: (value: boolean) => void
  /** Sends `security:lock-request`: the renderer saves, then answers `security:lock-ready`. */
  askRenderer: () => void
  onLocked: (reason: LockReason) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/**
 * Locking an unlocked app: the renderer saves first (its data IPC closes the
 * moment main locks), then main flips the same `passwordUnlocked` flag the
 * startup lock uses. A renderer that never answers cannot keep the app open.
 */
export function createAppLock(deps: AppLockDeps): {
  lock: (reason: LockReason) => void
  rendererReady: () => void
  isLocking: () => boolean
} {
  let pending: { reason: LockReason; timer: unknown } | null = null

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
      pending = { reason, timer: deps.setTimer(finish, LOCK_RENDERER_TIMEOUT_MS) }
      deps.askRenderer()
    },
    rendererReady: finish,
    isLocking: () => pending !== null
  }
}
