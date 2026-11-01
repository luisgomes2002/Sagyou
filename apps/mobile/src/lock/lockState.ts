import { create } from 'zustand'

/**
 * True while the app is locked or in the background. A React Native Modal is
 * its own Android window, ABOVE LockGate's cover, so every sheet closes while
 * this is set, and commit() refuses to write: nothing can be read or saved
 * behind the lock.
 */
export const useLockState = create<{ hidden: boolean }>(() => ({ hidden: false }))
