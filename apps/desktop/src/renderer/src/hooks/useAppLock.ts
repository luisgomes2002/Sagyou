import { useEffect, useRef } from 'react'
import { useKanbanStore } from '../store/kanban'
import { setDataLocked } from '../services/lockState'

/**
 * Answers main's `security:lock-request`: save what is pending while the data
 * IPC is still open, tell main it may lock, then show the password screen.
 * The store stays in memory: unlocking returns to the same place without
 * loadData (which would credit every saved timer again).
 */
export function useAppLock(onLocked: () => void): void {
  const onLockedRef = useRef(onLocked)
  useEffect(() => {
    onLockedRef.current = onLocked
  }, [onLocked])

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
