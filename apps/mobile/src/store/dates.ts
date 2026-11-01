import { isValid, parse } from 'date-fns'

export const DATE_FORMAT_ERROR = 'Use uma data válida, no formato DD/MM/AAAA.'

/** YYYY-MM-DD (what is stored and synced) → DD/MM/AAAA (what the person reads and types). */
export function toBRDate(iso: string | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : ''
}

/**
 * DD/MM/AAAA typed by the person → YYYY-MM-DD, or null when it is not a real
 * calendar day (31/02, 45/13…), so an impossible date is never saved and synced.
 */
export function parseBRDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim())
  if (!match) return null
  const [, d, m, y] = match
  const date = parse(`${y}-${m}-${d}`, 'yyyy-MM-dd', new Date())
  return isValid(date) ? `${y}-${m}-${d}` : null
}
