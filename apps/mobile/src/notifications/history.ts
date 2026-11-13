/**
 * The notification history of this phone (spec
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): a short list in the device-only
 * `prefs` table. It keeps only the code and the time of each notification, never the content of
 * an approval card, and is wiped with everything else on "Desconectar".
 */
import {
  NOTIFICATION_FALLBACK,
  NOTIFICATION_TEXT,
  isNotifyCode,
  type NotifyCode
} from '@sagyou/core/control/notify'

export const HISTORY_PREF = 'notifications.history'
export const HISTORY_MAX = 100
export const HISTORY_DAYS = 30
export const HISTORY_TEXT_MAX = 200
/** The same code this close in time is the same notification (the bar and the tap differ in id). */
export const DUPLICATE_WINDOW_MS = 60_000

const DAY_MS = 24 * 60 * 60 * 1000

export interface HistoryEntry {
  /** The Android notification identifier. */
  id: string
  /** 'unknown' = a push without a (known) `data.code`. */
  code: NotifyCode | 'unknown'
  at: number
  read: boolean
  /** Only for 'unknown': the body of the notification itself (generic text, never a card). */
  text?: string
}

function clean(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id === '') return null
  if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return null
  if (typeof e.read !== 'boolean') return null
  const code = e.code === 'unknown' ? 'unknown' : isNotifyCode(e.code) ? e.code : null
  if (code === null) return null
  const entry: HistoryEntry = { id: e.id, code, at: e.at, read: e.read }
  if (code === 'unknown' && typeof e.text === 'string' && e.text !== '') {
    entry.text = e.text.slice(0, HISTORY_TEXT_MAX)
  }
  return entry
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry): number => b.at - a.at

/** An unreadable value reads as an empty history; a broken item is dropped, the rest stays. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  try {
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .map(clean)
      .filter((e): e is HistoryEntry => e !== null)
      .sort(newestFirst)
  } catch {
    return []
  }
}

/** Newest first, at most HISTORY_MAX entries and HISTORY_DAYS days old. */
function prune(list: HistoryEntry[], now: number): HistoryEntry[] {
  return list
    .filter((e) => e.at >= now - HISTORY_DAYS * DAY_MS)
    .sort(newestFirst)
    .slice(0, HISTORY_MAX)
}

export function addEntry(list: HistoryEntry[], entry: HistoryEntry, now: number): HistoryEntry[] {
  const clipped: HistoryEntry =
    entry.text === undefined ? entry : { ...entry, text: entry.text.slice(0, HISTORY_TEXT_MAX) }
  const duplicate = list.some(
    (e) =>
      e.id === clipped.id ||
      (e.code === clipped.code && Math.abs(e.at - clipped.at) < DUPLICATE_WINDOW_MS)
  )
  return duplicate ? list : prune([clipped, ...list], now)
}

export const markAllRead = (list: HistoryEntry[]): HistoryEntry[] =>
  list.some((e) => !e.read) ? list.map((e) => ({ ...e, read: true })) : list

export const unreadCount = (list: HistoryEntry[]): number => list.filter((e) => !e.read).length

/** The line shown for an entry. */
export function entryText(entry: HistoryEntry): string {
  if (entry.code !== 'unknown') return NOTIFICATION_TEXT[entry.code]
  return entry.text && entry.text !== '' ? entry.text : NOTIFICATION_FALLBACK
}
