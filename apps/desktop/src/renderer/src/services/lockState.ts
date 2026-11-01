/**
 * Whether main has locked (or is locking) the app after it was unlocked.
 * Outside React and the store on purpose: the close handshake and the remote
 * change listener read it, and it must never be persisted.
 */
let dataLocked = false

export function isDataLocked(): boolean {
  return dataLocked
}

export function setDataLocked(value: boolean): void {
  dataLocked = value
}
