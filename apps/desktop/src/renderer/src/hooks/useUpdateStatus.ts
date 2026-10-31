import { useEffect, useState } from 'react'

export type UpdateStatus = Awaited<ReturnType<typeof window.electronAPI.update.status>>

/** The app updater's state from main, kept current by its push channel. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let mounted = true
    const unsubscribe = window.electronAPI.update.onStatusChanged((next) => {
      if (mounted) setStatus(next)
    })
    void window.electronAPI.update
      .status()
      .then((current) => {
        // A push that arrived first is newer than this answer.
        if (mounted) setStatus((previous) => previous ?? current)
      })
      .catch(() => {})
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  return status
}
