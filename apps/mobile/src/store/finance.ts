import {
  addTransaction as addTransactionCore,
  updateTransaction as updateTransactionCore,
  type ActionError,
  type ActionResult
} from '@sagyou/core/finance-actions'
import { parseDecimalInput, type NewTransactionInput } from '@sagyou/core/finance'
import { D, moneyStr } from '@sagyou/core/money'
import { MONTH_NAMES, YIELD_SUMMARY_CATEGORY } from '@sagyou/core/yieldSummary'
import { format, parseISO, subDays } from 'date-fns'
import {
  DEFAULT_FINANCIAL_PROFILE_ID,
  type Currency,
  type FinancialTable,
  type FinancialTransaction
} from '@sagyou/core/types'
import type { MobileState } from '../data/state'
import { useApp } from './app'
import { useUndo } from './undo'

export const LOCKED_TEXT = 'Este lançamento só pode ser editado no PC.'
export const DELETE_LOCKED_TEXT = 'Este lançamento só pode ser excluído no PC.'
export const YIELD_LOCKED_TEXT = 'Este lançamento vem dos rendimentos do mês.'
export const INVALID_AMOUNT_TEXT = 'Valor inválido.'
export const OVER_REMAINING_TEXT = 'O pagamento passa do valor restante.'
export const NOT_FOUND_TEXT = 'Este item não existe mais.'
export const INVALID_NAME_TEXT = 'Informe um nome.'
export const DETAILS_EXCEED_TEXT = 'O valor não pode ficar abaixo da soma dos itens da fatura.'

/** What the phone says for each refusal of the core. */
export function financeErrorText(error: ActionError): string {
  switch (error) {
    case 'invalid-amount':
      return INVALID_AMOUNT_TEXT
    case 'over-remaining':
      return OVER_REMAINING_TEXT
    case 'invalid-name':
      return INVALID_NAME_TEXT
    default:
      return NOT_FOUND_TEXT
  }
}

/**
 * Runs a core action on the tables as they are *now* (never a stale render) and writes the result
 * through `commit`, so a debt and its payment, for one, land in a single save. A refusal of the
 * core goes to `onError` (default: the bottom notice); a write the store refuses (read-only, behind
 * the lock) is silent, as every other write of the phone. An action that changed nothing (the core
 * hands back the same array) is not saved.
 */
export type FinanceOutcome = { ok: true; id?: string } | { ok: false }

export function applyFinance(
  action: (tables: FinancialTable[], now: Date) => ActionResult,
  onError: (text: string) => void = (text) => useUndo.getState().show(text)
): FinanceOutcome {
  const app = useApp.getState()
  const current = app.state
  const result = action(current.lists, new Date())
  if ('error' in result) {
    onError(financeErrorText(result.error))
    return { ok: false }
  }
  if (result.tables === current.lists) return { ok: true }
  if (!app.commit({ ...current, lists: result.tables })) return { ok: false }
  return { ok: true, id: result.id }
}

/** Device-only: the last table used, per financial profile. */
export const lastTablePref = (profileId: string): string => `finance.lastTable.${profileId}`

/** The tables of one profile only; a missing profileId is the personal profile (desktop rule). */
export function tablesOfProfile(state: MobileState, profileId: string): FinancialTable[] {
  return state.lists.filter((t) => (t.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID) === profileId)
}

/** An invoice item points at `tx`: it is the mirror of that invoice, in whichever table it lives. */
function isInvoiceMirror(tables: FinancialTable[], tx: FinancialTransaction): boolean {
  return tables.some((t) =>
    t.transactions.some((x) => x.details?.some((d) => d.linkedTransactionId === tx.id))
  )
}

/**
 * Debt payments, invoice mirrors, legacy links and currency transfers carry
 * rules the phone does not implement in v1, so they are read-only here. An invoice and its mirror
 * lock each other, so the mirror is looked up through **every** table (it lives in another one).
 */
export function isLockedTransaction(tables: FinancialTable[], tx: FinancialTransaction): boolean {
  if (tx.debtId || tx.linkedTransactionId || tx.currencyTransferId) return true
  if (tx.details?.some((d) => d.linkedTransactionId)) return true
  return isInvoiceMirror(tables, tx)
}

/** A monthly yield summary the Rendimentos tab generates; it is edited there, never by hand. */
export function isYieldSummary(tx: FinancialTransaction): boolean {
  return tx.category === YIELD_SUMMARY_CATEGORY && tx.description.startsWith('Rendimentos ')
}

/** Why a transaction cannot be edited on the phone (the text to show), or null when it can. */
export function editLock(tables: FinancialTable[], tx: FinancialTransaction): string | null {
  if (isYieldSummary(tx)) return YIELD_LOCKED_TEXT
  return isLockedTransaction(tables, tx) ? LOCKED_TEXT : null
}

/**
 * Why a transaction cannot be deleted on the phone, or null. A debt payment and a purchase from a
 * shopping list can go (the core gives the value back / the item stays); a currency transfer, an
 * invoice and its mirror, and a legacy link — in both directions — cannot.
 */
export function deleteLock(tables: FinancialTable[], tx: FinancialTransaction): string | null {
  if (isYieldSummary(tx)) return YIELD_LOCKED_TEXT
  if (tx.currencyTransferId || tx.linkedTransactionId) return DELETE_LOCKED_TEXT
  if (tx.details?.some((d) => d.linkedTransactionId)) return DELETE_LOCKED_TEXT
  // The mirror/child of someone else's link lives in another table, so look through all of them.
  const legacyChild = tables.some((t) =>
    t.transactions.some((x) => x.linkedTransactionId === tx.id)
  )
  return legacyChild || isInvoiceMirror(tables, tx) ? DELETE_LOCKED_TEXT : null
}

/** The month before (-1) or after (+1) a `yyyy-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + (number - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** "novembro de 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number)
  return `${MONTH_NAMES[number - 1].toLowerCase()} de ${year}`
}

/** Parses what the user typed with the table's currency; null unless a positive amount. */
export function parseAmount(raw: string, currency: Currency): string | null {
  const value = parseDecimalInput(raw, currency)
  if (!value || value.isNaN() || !value.isFinite() || value.lte(0)) return null
  return value.toString()
}

/** The new transaction goes through the core (id, `createdAt`, canonical amount), like the desktop. */
export function addTransaction(
  state: MobileState,
  tableId: string,
  input: NewTransactionInput,
  now: Date
): { state: MobileState; id: string } {
  const result = addTransactionCore(
    state.lists,
    tableId,
    {
      description: input.description.trim(),
      amount: moneyStr(input.amount),
      type: input.type,
      date: input.date,
      category: input.category
    },
    now
  )
  // The table is gone (removed from another device meanwhile): nothing is added and the id is empty.
  if ('error' in result) return { state, id: '' }
  return { state: { ...state, lists: result.tables }, id: result.id ?? '' }
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
  Pick<
    FinancialTransaction,
    'amount' | 'date' | 'category' | 'description' | 'source' | 'counterparty' | 'bankReference'
  >
>

/** Audited like the desktop (core `updateTransaction`); refused for locked kinds. */
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
  const locked = editLock(state.lists, tx)
  if (locked) return { error: locked }
  // The core drops an edit that leaves the invoice items above the total, and silently: say it.
  if (patch.amount !== undefined && tx.details?.length) {
    const items = tx.details.reduce((sum, d) => sum.plus(D(d.amount)), D(0))
    if (D(patch.amount).lt(items)) return { error: DETAILS_EXCEED_TEXT }
  }
  const result = updateTransactionCore(state.lists, tableId, txId, patch, now)
  if ('error' in result) return { error: financeErrorText(result.error) }
  return { state: result.tables === state.lists ? state : { ...state, lists: result.tables } }
}
