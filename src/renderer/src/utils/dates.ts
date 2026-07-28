import { format } from 'date-fns'

/**
 * Today as a YYYY-MM-DD string in LOCAL time.
 *
 * Used by: habit tracking, checkboxes, anything where the user's wall-clock day
 * is what matters. After 21:00 in Brazil, UTC-based `todayISO()` would land on
 * tomorrow. Use this everywhere except in financial defaults, where the
 * pre-existing behaviour is UTC (see `todayUTCISO()` below).
 */
export function todayLocalISO(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd')
}

/**
 * Today as a YYYY-MM-DD string in UTC time.
 *
 * Kept for the financial module, where the pre-existing `todayISO()` used UTC
 * and changing it would shift the default date for transactions after 21:00 in
 * Brazil. New code should prefer `todayLocalISO()`.
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
