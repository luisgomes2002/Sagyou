export interface FinancialTransactionDetail {
  id: string
  description: string
  amount: number | string
  category?: string
  date?: string
  linkedTransactionId?: string
}

// Coerce a monetary value (legacy number or current string) to a canonical
// decimal string for storage in the TEXT columns.
export function moneyText(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return String(v)
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '') return '0'
    const n = Number(trimmed)
    return isFinite(n) ? String(n) : '0'
  }
  return '0'
}

export function transactionDetails(value: unknown): FinancialTransactionDetail[] {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return []
          }
        })()
      : value
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((detail) => {
    if (!detail || typeof detail !== 'object') return []
    const item = detail as Partial<FinancialTransactionDetail>
    if (typeof item.id !== 'string' || typeof item.description !== 'string') return []
    return [
      {
        id: item.id,
        description: item.description,
        amount: moneyText(item.amount),
        ...(typeof item.category === 'string' && item.category.trim()
          ? { category: item.category.trim() }
          : {}),
        ...(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          ? { date: item.date }
          : {}),
        ...(typeof item.linkedTransactionId === 'string' && item.linkedTransactionId
          ? { linkedTransactionId: item.linkedTransactionId }
          : {})
      }
    ]
  })
}
