import { format } from 'date-fns'

/**
 * Today as a YYYY-MM-DD string in LOCAL time.
 *
 * Used by anything that displays or creates a calendar date. The local clock is
 * the source of truth: after 21:00 in Brazil, a UTC date would already be
 * tomorrow.
 */
export function todayLocalISO(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd')
}

/**
 * Today as a YYYY-MM-DD string in UTC time. Use only where the UTC calendar day
 * is explicitly required; user-facing dates must use `todayLocalISO()`.
 */
export function todayUTCISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Brazilian date format: dd/mm/yyyy from an ISO date string.
 * Returns empty string on falsy input.
 */
export function formatDateBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Short date: dd/mm (no year), from an ISO date string.
 * Used in UpcomingView for compact display.
 */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/**
 * Parse a Brazilian date string (dd/mm/yyyy) to ISO (yyyy-MM-dd).
 * Returns null on invalid input.
 */
export function parseDateBR(raw: string): string | null {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const d = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const y = parseInt(match[3], 10)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
