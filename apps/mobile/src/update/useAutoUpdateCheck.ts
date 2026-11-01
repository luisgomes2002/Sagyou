import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useApp } from '../store/app'
import { useUpdate } from '../store/update'
import { updateDeps } from './actions'

/** Checks on mount and whenever the app comes back to the foreground (at most every 24 h). */
export function useAutoUpdateCheck(): void {
  const repo = useApp((s) => s.services?.repo)
  useEffect(() => {
    if (!repo) return
    const check = (): void => {
      void useUpdate.getState().autoCheck(updateDeps(repo))
    }
    check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    return () => sub.remove()
  }, [repo])
}
