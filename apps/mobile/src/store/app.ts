import type { SyncStatus } from '@sagyou/core/sync/engine'
import { DEFAULT_FINANCIAL_PROFILE_ID as DEFAULT_PROFILE_ID } from '@sagyou/core/types'
import { create } from 'zustand'
import type { RecordRepo } from '../data/records'
import type { SearchHit } from '../data/search'
import { emptyState, type MobileState } from '../data/state'
import type { SyncRuntime } from '../sync/runtime'

export const DISCONNECTED_TEXT = 'Este aparelho foi desconectado da sincronização'
export const OFFLINE_TEXT = 'Sem conexão: as alterações ficam guardadas'

/** Device-only preferences (never synced). */
export const PREF_DISCONNECTED = 'sync.disconnected'
export const PREF_PROFILE = 'finance.profileId'

export interface AppServices {
  repo: RecordRepo
  runtime: SyncRuntime
  search: (text: string, profileId: string) => SearchHit[]
}

export type AppMode = 'loading' | 'pair' | 'app'

export interface AppStore {
  mode: AppMode
  state: MobileState
  status: SyncStatus | null
  /** Revoked without wipe: data stays readable, nothing can be changed. */
  readOnly: boolean
  /** This phone's active financial profile (device-only, like on the desktop). */
  profileId: string
  services: AppServices | null
  init(services: AppServices, paired: boolean): void
  /** A local edit: saved with a new version and queued to push. False when read-only. */
  commit(next: MobileState): boolean
  receive(next: MobileState): void
  setStatus(status: SyncStatus): void
  paired(): void
  wiped(): void
  setProfile(id: string): void
}

export const useApp = create<AppStore>((set, get) => ({
  mode: 'loading',
  state: emptyState(),
  status: null,
  readOnly: false,
  profileId: DEFAULT_PROFILE_ID,
  services: null,

  init(services, paired) {
    const readOnly = services.repo.readPref(PREF_DISCONNECTED) === '1'
    set({
      services,
      state: services.repo.loadState(),
      readOnly,
      profileId: services.repo.readPref(PREF_PROFILE) ?? DEFAULT_PROFILE_ID,
      mode: paired || readOnly ? 'app' : 'pair'
    })
  },

  commit(next) {
    const { services, readOnly } = get()
    if (!services || readOnly) return false
    services.repo.save(next, Date.now())
    set({ state: next })
    services.runtime.engine.notifySaved()
    return true
  },

  receive(next) {
    set({ state: next })
  },

  setStatus(status) {
    const { services, readOnly } = get()
    if (status.state === 'disconnected' && !readOnly) {
      services?.repo.writePref(PREF_DISCONNECTED, '1')
      set({ status, readOnly: true })
      return
    }
    set({ status })
  },

  paired() {
    const { services } = get()
    set({ mode: 'app', state: services ? services.repo.loadState() : emptyState() })
  },

  wiped() {
    set({
      mode: 'pair',
      state: emptyState(),
      status: null,
      readOnly: false,
      profileId: DEFAULT_PROFILE_ID
    })
  },

  setProfile(id) {
    get().services?.repo.writePref(PREF_PROFILE, id)
    set({ profileId: id })
  }
}))
