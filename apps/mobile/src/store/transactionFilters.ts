import type { FinancialTransaction } from '@sagyou/core/types'

// The Lançamentos tab's search and chips (spec 2026-11-10-mobile-financeiro). Pure, so the
// screen only draws what comes out of here. Not remembered: it starts clean on every opening.

export interface TransactionFilter {
  /** What was typed in "Buscar lançamento". */
  query: string
  type: 'all' | 'income' | 'expense'
  /** A category name, or 'all'. */
  category: string
}

export const NO_TRANSACTION_FILTER: TransactionFilter = { query: '', type: 'all', category: 'all' }

export const TRANSACTION_FILTER_TEXTS = {
  search: 'Buscar lançamento',
  emptyMonth: 'Nenhum lançamento neste mês.',
  noMatch: 'Nenhum lançamento com estes filtros.',
  clear: 'Limpar filtros',
  all: 'Todos',
  allCategories: 'Todas'
} as const

export const TYPE_OPTIONS: readonly { value: TransactionFilter['type']; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'income', label: 'Receitas' },
  { value: 'expense', label: 'Gastos' }
]

/** Lower case with no accents, so "almoco" finds "Almoço". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** True when anything narrows the list (so "Limpar filtros" has something to clear). */
export function isFiltering(filter: TransactionFilter): boolean {
  return filter.query.trim() !== '' || filter.type !== 'all' || filter.category !== 'all'
}

/** The transactions that pass the search, the type and the category. The month is chosen before. */
export function filterTransactions(
  txs: FinancialTransaction[],
  filter: TransactionFilter
): FinancialTransaction[] {
  const query = fold(filter.query.trim())
  return txs.filter(
    (tx) =>
      (filter.type === 'all' || tx.type === filter.type) &&
      (filter.category === 'all' || tx.category === filter.category) &&
      (query === '' || fold(tx.description).includes(query))
  )
}

/** The categories used in the month's transactions, in alphabetical order. */
export function monthCategories(txs: FinancialTransaction[]): string[] {
  const used = new Set<string>()
  for (const tx of txs) if (tx.category) used.add(tx.category)
  return [...used].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
