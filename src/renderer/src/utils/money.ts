import Decimal from 'decimal.js'

/**
 * Coerce a persisted monetary value to a canonical decimal string.
 * Migrates legacy `number` amounts (production data) to string on load.
 */
export function moneyStr(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return new Decimal(v).toString()
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      const d = new Decimal(v)
      return d.isNaN() || !d.isFinite() ? '0' : d.toString()
    } catch {
      return '0'
    }
  }
  return '0'
}

/**
 * Safe Decimal constructor — treats null/undefined/'' as 0.
 */
export function D(value: Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  try {
    const d = new Decimal(value)
    return d.isNaN() || !d.isFinite() ? new Decimal(0) : d
  } catch {
    return new Decimal(0)
  }
}
