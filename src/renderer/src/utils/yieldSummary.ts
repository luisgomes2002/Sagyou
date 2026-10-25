import type { FinancialTable } from '../types'
import { applyFinancialTransactionEdit } from './financialRecord'

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro'
]

export const YIELD_SUMMARY_CATEGORY = 'Rendimento Mensal'

export function migrateYieldSummaryDates(table: FinancialTable): FinancialTable {
  let changed = false
  const at = new Date().toISOString()
  const transactions = (table.transactions ?? []).map((transaction) => {
    if (transaction.type !== 'income' || transaction.category !== YIELD_SUMMARY_CATEGORY)
      return transaction
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(transaction.date)
    if (!match) return transaction
    const year = Number(match[1])
    const month = Number(match[2])
    if (year < 1 || month < 1 || month > 12) return transaction
    const lastDay = new Date(year, month, 0).getDate()
    if (
      Number(match[3]) !== lastDay ||
      transaction.description !== `Rendimentos ${MONTH_NAMES[month - 1]} ${year}`
    )
      return transaction
    changed = true
    return applyFinancialTransactionEdit(transaction, { date: `${match[1]}-${match[2]}-01` }, at)
  })
  return changed ? { ...table, transactions } : table
}
