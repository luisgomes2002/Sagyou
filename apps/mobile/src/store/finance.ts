import { newTransaction, parseDecimalInput, type NewTransactionInput } from '@sagyou/core/finance'
import { applyFinancialTransactionEdit } from '@sagyou/core/financialRecord'
import { D } from '@sagyou/core/money'
import { format, parseISO, subDays } from 'date-fns'
import {
  DEFAULT_FINANCIAL_PROFILE_ID,
  type Currency,
  type FinancialTable,
  type FinancialTransaction
} from '@sagyou/core/types'
import type { MobileState } from '../data/state'

export const LOCKED_TEXT = 'Este lançamento só pode ser editado no PC.'
export const INVALID_AMOUNT_TEXT = 'Valor inválido.'

/** Device-only: the last table used, per financial profile. */
export const lastTablePref = (profileId: string): string => `finance.lastTable.${profileId}`

/** The tables of one profile only; a missing profileId is the personal profile (desktop rule). */
export function tablesOfProfile(state: MobileState, profileId: string): FinancialTable[] {
  return state.lists.filter((t) => (t.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID) === profileId)
}

/**
 * Debt payments, invoice mirrors, legacy links and currency transfers carry
 * rules the phone does not implement in v1, so they are read-only here.
 */
export function isLockedTransaction(table: FinancialTable, tx: FinancialTransaction): boolean {
  if (tx.debtId || tx.linkedTransactionId || tx.currencyTransferId) return true
  if (tx.details?.some((d) => d.linkedTransactionId)) return true
  return table.transactions.some((t) => t.details?.some((d) => d.linkedTransactionId === tx.id))
}

/** Parses what the user typed with the table's currency; null unless a positive amount. */
export function parseAmount(raw: string, currency: Currency): string | null {
  const value = parseDecimalInput(raw, currency)
  if (!value || value.isNaN() || !value.isFinite() || value.lte(0)) return null
  return value.toString()
}

function withTable(
  state: MobileState,
  tableId: string,
  edit: (table: FinancialTable) => FinancialTable
): MobileState {
  return { ...state, lists: state.lists.map((t) => (t.id === tableId ? edit(t) : t)) }
}

export function addTransaction(
  state: MobileState,
  tableId: string,
  input: NewTransactionInput,
  now: Date
): { state: MobileState; id: string } {
  const tx = newTransaction(input, now)
  return {
    state: withTable(state, tableId, (t) => ({ ...t, transactions: [...t.transactions, tx] })),
    id: tx.id
  }
}

/**
 * Income and expense of the calendar month of `today`, registered future
 * days included (same rows as the month list). Decimal strings, one table:
 * currencies are never mixed.
 */
export function monthSummary(
  txs: FinancialTransaction[],
  today: string
): { income: string; expense: string } {
  const month = today.slice(0, 7)
  let income = D(0)
  let expense = D(0)
  for (const tx of txs) {
    if (!tx.date.startsWith(month)) continue
    if (tx.type === 'income') income = income.plus(D(tx.amount))
    else expense = expense.plus(D(tx.amount))
  }
  return { income: income.toString(), expense: expense.toString() }
}

// date-fns' ptBR abbreviates to "sexta", not "sex": the short names are fixed here.
const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** A day of the month list: "Hoje", "Ontem" or "sex., 30/10". */
function dayLabel(day: string, today: string): string {
  if (day === today) return 'Hoje'
  if (day === format(subDays(parseISO(today), 1), 'yyyy-MM-dd')) return 'Ontem'
  const date = parseISO(day)
  return `${WEEKDAY_ABBR[date.getDay()]}., ${format(date, 'dd/MM')}`
}

/** The month's transactions (already filtered) grouped by day, newest first. */
export function groupByDay(
  txs: FinancialTransaction[],
  today: string
): { day: string; label: string; txs: FinancialTransaction[] }[] {
  const days = new Map<string, FinancialTransaction[]>()
  for (const tx of txs) days.set(tx.date, [...(days.get(tx.date) ?? []), tx])
  return [...days.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({ day, label: dayLabel(day, today), txs: days.get(day)! }))
}

export type TransactionPatch = Partial<
  Pick<FinancialTransaction, 'amount' | 'date' | 'category' | 'description'>
>

/** Audited like the desktop (applyFinancialTransactionEdit); refused for locked kinds. */
export function updateTransaction(
  state: MobileState,
  tableId: string,
  txId: string,
  patch: TransactionPatch,
  now: Date
): { state: MobileState } | { error: string } {
  const table = state.lists.find((t) => t.id === tableId)
  const tx = table?.transactions.find((t) => t.id === txId)
  if (!table || !tx) return { error: 'Lançamento não encontrado.' }
  if (isLockedTransaction(table, tx)) return { error: LOCKED_TEXT }
  const at = now.toISOString()
  return {
    state: withTable(state, tableId, (t) => ({
      ...t,
      transactions: t.transactions.map((x) =>
        x.id === txId ? applyFinancialTransactionEdit(x, patch, at) : x
      )
    }))
  }
}
