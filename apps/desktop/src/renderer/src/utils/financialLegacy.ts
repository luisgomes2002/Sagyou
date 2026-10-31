import type { FinancialTable } from '../types'

// Old backups may contain these unused settings. Keep their bytes through saves
// without keeping the unfinished features in the active financial model.
export function preserveLegacyFinancialMetadata(table: FinancialTable): FinancialTable {
  const legacyTable = table as FinancialTable & {
    budgets?: unknown
    recurringTransactions?: unknown
  }
  const { budgets, recurringTransactions, ...current } = legacyTable
  const metadata = { ...current.legacyFinancialMetadata }
  if (budgets !== undefined) metadata.budgets = budgets
  if (recurringTransactions !== undefined) metadata.recurringTransactions = recurringTransactions
  return {
    ...current,
    ...(Object.keys(metadata).length > 0 ? { legacyFinancialMetadata: metadata } : {})
  }
}
