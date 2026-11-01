import { create } from 'zustand'
import type { RecordRepo } from '../data/records'
import { compareVersions, fetchLatest, type AvailableUpdate } from '../update/check'

/** Device-only preferences (never synced; erased by the wipe with the rest of `prefs`). */
export const PREF_UPDATE_LAST_CHECK = 'update.lastCheck'
export const PREF_UPDATE_DISMISSED = 'update.dismissed'
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateDeps {
  repo: Pick<RecordRepo, 'readPref' | 'writePref'>
  fetch: typeof fetch
  now: () => number
  installed: string
}

export type ManualResult = 'idle' | 'checking' | 'available' | 'latest' | 'error'

export interface UpdateStore {
  available: AvailableUpdate | null
  dismissed: string | null
  manual: ManualResult
  autoCheck(deps: UpdateDeps): Promise<void>
  manualCheck(deps: UpdateDeps): Promise<void>
  dismiss(deps: UpdateDeps): void
  reset(): void
}

/** What the banner shows: a newer version the user has not dismissed. */
export function bannerUpdate(
  s: Pick<UpdateStore, 'available' | 'dismissed'>,
  installed: string
): AvailableUpdate | null {
  const { available, dismissed } = s
  if (!available) return null
  try {
    if (compareVersions(available.version, installed) <= 0) return null
  } catch {
    return null
  }
  return available.version === dismissed ? null : available
}

let autoInFlight: Promise<void> | null = null

export const useUpdate = create<UpdateStore>((set, get) => ({
  available: null,
  dismissed: null,
  manual: 'idle',

  autoCheck(deps) {
    // Read before the 24 h gate: "Agora não" holds even when no check runs.
    set({ dismissed: deps.repo.readPref(PREF_UPDATE_DISMISSED) })
    if (autoInFlight) return autoInFlight
    const last = Date.parse(deps.repo.readPref(PREF_UPDATE_LAST_CHECK) ?? '')
    if (Number.isFinite(last) && deps.now() - last < AUTO_CHECK_INTERVAL_MS) return Promise.resolve()
    autoInFlight = (async () => {
      try {
        const found = await fetchLatest(deps.fetch, deps.installed)
        set({ available: found })
        // A check that found something still pending is not counted, so the
        // banner comes back on every open until "Agora não"; once that version
        // is dismissed, the 24 h gate applies again.
        if (!found || found.version === get().dismissed)
          deps.repo.writePref(PREF_UPDATE_LAST_CHECK, new Date(deps.now()).toISOString())
      } catch {
        // A failed check is not a check: try again on the next open.
      } finally {
        autoInFlight = null
      }
    })()
    return autoInFlight
  },

  async manualCheck(deps) {
    if (get().manual === 'checking') return
    set({ manual: 'checking' })
    try {
      const found = await fetchLatest(deps.fetch, deps.installed)
      set(found ? { available: found, manual: 'available' } : { manual: 'latest' })
    } catch {
      set({ manual: 'error' })
    }
  },

  dismiss(deps) {
    const version = get().available?.version
    if (!version) return
    deps.repo.writePref(PREF_UPDATE_DISMISSED, version)
    // Dismissed: no reason to ask GitHub again before the next 24 h.
    deps.repo.writePref(PREF_UPDATE_LAST_CHECK, new Date(deps.now()).toISOString())
    set({ dismissed: version })
  },

  reset() {
    set({ available: null, dismissed: null, manual: 'idle' })
  }
}))
