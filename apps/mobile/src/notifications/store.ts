import { create } from 'zustand'
import type { RecordRepo } from '../data/records'
import {
  HISTORY_PREF,
  addEntry,
  markAllRead,
  parseHistory,
  unreadCount,
  type HistoryEntry
} from './history'

type PrefsRepo = Pick<RecordRepo, 'readPref' | 'writePref'>

interface NotificationsStore {
  entries: HistoryEntry[]
  unread: number
  /** Reads the saved history; from here on every change is saved. */
  load(repo: PrefsRepo): void
  add(entry: HistoryEntry, now?: number): void
  markAllRead(): void
  /** Clears the history only (never an approval card). */
  clear(): void
  /** The wipe deleted every row already: only the memory is dropped. */
  reset(): void
}

let prefs: PrefsRepo | null = null
/**
 * When the history was last cleared: a notification still in the bar (or the last tap, which
 * comes back on every mount) that arrived before it does not come back as an entry.
 */
let clearedAt = 0

function save(entries: HistoryEntry[]): void {
  try {
    prefs?.writePref(HISTORY_PREF, entries.length === 0 ? null : JSON.stringify(entries))
  } catch {
    // The list still works from memory; the next change tries again.
  }
}

export const useNotifications = create<NotificationsStore>((set, get) => {
  const apply = (entries: HistoryEntry[], persist = true): void => {
    if (persist) save(entries)
    set({ entries, unread: unreadCount(entries) })
  }
  return {
    entries: [],
    unread: 0,

    load(repo) {
      prefs = repo
      let raw: string | null = null
      try {
        raw = repo.readPref(HISTORY_PREF)
      } catch {
        raw = null
      }
      apply(parseHistory(raw), false)
    },

    add(entry, now = Date.now()) {
      if (entry.at <= clearedAt) return
      const next = addEntry(get().entries, entry, now)
      if (next !== get().entries) apply(next)
    },

    markAllRead() {
      const next = markAllRead(get().entries)
      if (next !== get().entries) apply(next)
    },

    clear() {
      clearedAt = Date.now()
      apply([])
    },

    reset() {
      clearedAt = 0
      apply([], false)
    }
  }
})
