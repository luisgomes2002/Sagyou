import { useEffect, useState } from 'react'

/** When the network comes back, sync right away instead of waiting for the next poll. */
export function useSyncOnReconnect(): void {
  useEffect(() => {
    const sync = window.electronAPI?.sync
    if (!sync) return
    const onOnline = (): void => {
      void sync.now().catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])
}

const EMPTY: ReadonlySet<string> = new Set()

/** Debts that sync left waiting for a choice ("conflito: escolha a versão"). */
export function useDebtConflictIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY)
  useEffect(() => {
    const sync = window.electronAPI?.sync
    if (!sync) return
    let mounted = true
    const refresh = async (conflictCount: number): Promise<void> => {
      if (conflictCount === 0) {
        if (mounted) setIds(EMPTY)
        return
      }
      const result = await sync.conflicts()
      if (!mounted || !result.ok) return
      setIds(
        new Set(
          result.conflicts
            .filter((c) => c.type === 'pending_choice' && c.kind === 'financial_debt')
            .map((c) => c.recordId)
        )
      )
    }
    const unsubscribe = sync.onStatusChanged?.((status) => {
      void refresh(status.conflictCount).catch(() => {})
    })
    void sync
      .status()
      .then((status) => refresh(status.conflictCount))
      .catch(() => {})
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])
  return ids
}
