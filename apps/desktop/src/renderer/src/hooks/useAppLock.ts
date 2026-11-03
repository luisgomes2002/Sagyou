import { useEffect, useRef } from 'react'
import { useKanbanStore } from '../store/kanban'
import { setDataLocked } from '../services/lockState'

/**
 * Answers main's `security:lock-request`: save what is pending while the data
 * IPC is still open, tell main it may lock, then show the password screen.
 * The store stays in memory: unlocking returns to the same place without
 * loadData (which would credit every saved timer again).
 */
export function useAppLock(onLocked: () => void, onRemoteUnlocked?: () => void): void {
  const onLockedRef = useRef(onLocked)
  const onRemoteUnlockedRef = useRef(onRemoteUnlocked)
  useEffect(() => {
    onLockedRef.current = onLocked
    onRemoteUnlockedRef.current = onRemoteUnlocked
  }, [onLocked, onRemoteUnlocked])

  // The authorized phone unlocked the app: leave the password screen like a
  // right password would. The store is not reloaded here either; App loads it
  // only while it was never loaded.
  useEffect(() => {
    const unsubscribe = window.electronAPI.security.onRemoteUnlocked?.(() => {
      setDataLocked(false)
      onRemoteUnlockedRef.current?.()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.security.onLockRequest?.(() => {
      void (async () => {
        setDataLocked(true)
        const state = useKanbanStore.getState()
        try {
          if (state.isLoaded) await state._flushPersist()
        } catch {
          // Main locks on its own deadline anyway; nothing here may keep it open.
        }
        try {
          await window.electronAPI.security.lockReady()
        } catch {
          // Same: main's 5 s deadline covers a lost answer.
        }
        onLockedRef.current()
      })()
    })
    return unsubscribe
  }, [])
}
