import { useEffect } from 'react'
import { useKanbanStore } from '../store/kanban'

/**
 * Loads the store on the first unlock only. Unlocking again after a lock keeps
 * the in-memory state: loadData credits every saved timer, so running it a
 * second time would count that time twice.
 */
export function useLoadOnFirstUnlock(unlocked: boolean, loadData: () => Promise<void>): void {
  useEffect(() => {
    if (!unlocked || useKanbanStore.getState().isLoaded) return
    void loadData()
  }, [unlocked, loadData])
}
