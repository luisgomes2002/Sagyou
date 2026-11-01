import type { DesktopPrefs } from './desktop-prefs'
import type { LockReason } from '../security/app-lock'

export const IDLE_CHECK_MS = 30_000

export interface AutoLockDeps {
  /** Seconds without keyboard or mouse on the whole system (powerMonitor). */
  idleSeconds: () => number
  prefs: () => DesktopPrefs
  /** A password exists and the app is unlocked right now. */
  canLock: () => boolean
  lock: (reason: LockReason) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/**
 * The automatic triggers: system idle time past the chosen minutes, and the
 * OS locking the screen or going to sleep. Idle is the whole PC, not only the
 * Sagyou window: someone coding in another app with Sagyou in the tray is
 * not away.
 */
export function createAutoLock(deps: AutoLockDeps): {
  start: () => void
  stop: () => void
  tick: () => void
  onSystemLock: () => void
  onSuspend: () => void
} {
  let handle: unknown = null

  const tick = (): void => {
    const minutes = deps.prefs().idleLockMinutes
    if (minutes > 0 && deps.canLock() && deps.idleSeconds() >= minutes * 60) deps.lock('idle')
  }
  const onSystem = (reason: LockReason) => (): void => {
    if (deps.prefs().lockOnSystemLock && deps.canLock()) deps.lock(reason)
  }

  return {
    start: () => {
      if (handle === null) handle = deps.setInterval(tick, IDLE_CHECK_MS)
    },
    stop: () => {
      if (handle !== null) deps.clearInterval(handle)
      handle = null
    },
    tick,
    onSystemLock: onSystem('system-lock'),
    onSuspend: onSystem('suspend')
  }
}
