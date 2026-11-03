/**
 * "Funcionar com o Sagyou bloqueado" (spec docs/specs/2026-11-03-acesso-remoto.md):
 * with the option on, the external token keeps reading and writing while the
 * app is on its password screen. Fleet runs never do.
 */

/**
 * Whether the lock stops an external call right now. While locking, the
 * renderer is saving on its way to locked: nothing runs, option or not.
 */
export function externalBlockedByLock(state: {
  locked: boolean
  locking: boolean
  allowWhileLocked: boolean
}): boolean {
  if (state.locking) return true
  return state.locked && !state.allowWhileLocked
}

/**
 * The one hole in the locked data IPC: while main is waiting for an external
 * write's apply, the renderer's `store:save` (its flush) is let through.
 * Nothing else is: every other channel, and every save outside that window,
 * still needs the unlock. Each begin() returns its own idempotent end(), so a
 * reply, an error or a timeout can all close it without going negative.
 */
export interface LockedSaveGate {
  begin(): () => void
  allows(channel: string): boolean
}

export function createLockedSaveGate(): LockedSaveGate {
  let open = 0
  return {
    begin: () => {
      open += 1
      let ended = false
      return () => {
        if (ended) return
        ended = true
        open -= 1
      }
    },
    allows: (channel) => open > 0 && channel === 'store:save'
  }
}
