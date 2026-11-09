import { useCallback, useEffect, useState } from 'react'
import type { RcServerList, RcServerView } from '../utils/rcServers'

/** The servers main manages, kept current by `rc-server:changed`. */
export function useRcServers(): {
  supported: boolean
  servers: RcServerView[]
  loaded: boolean
  reload: () => Promise<void>
} {
  const [list, setList] = useState<RcServerList | null>(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const api = window.electronAPI.rcServers
    if (!api) {
      setLoaded(true)
      return
    }
    try {
      setList(await api.list())
    } catch {
      // Keep what is on screen; the next change event brings it back.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI.rcServers
    if (!api) return
    let alive = true
    api
      .list()
      .then((next) => {
        if (alive) setList(next)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true)
      })
    const off = api.onChanged((next) => {
      setList(next)
      setLoaded(true)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  return {
    supported: list?.supported ?? false,
    servers: list?.servers ?? [],
    // Without the API (an older preload in a test) there is nothing to wait for.
    loaded: loaded || !window.electronAPI.rcServers,
    reload
  }
}
