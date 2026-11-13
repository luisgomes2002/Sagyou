import Decimal from 'decimal.js'
import type { Currency, FinancialGoal, FinancialTable, FinancialTransaction } from './types'
import { D } from './money'
import { tableBalance } from './finance'

/**
 * Screen calculations of the financial area, shared by the desktop and the phone.
 *
 * ⚠️ They mirror, line for line, what the desktop's tabs computed inline before they moved here:
 * a rule changed on one side only would make the two apps show different money. `month` is
 * `yyyy-MM` and `today` is the user's local calendar day (`todayLocalISO()`), never the UTC one.
 * Amounts come back as canonical decimal strings; wrap them in `D()` to calculate.
 */

export interface MonthBounds {
  /** The balance stops here: today while the month has not ended, else the end of the month. */
  currentCutoff: string
  /** Last day any month can have; transactions of the month are `<=` this. */
  monthEnd: string
}

export function monthBounds(month: string, today: string): MonthBounds {
  const monthEnd = `${month}-31`
  return { currentCutoff: today < monthEnd ? today : monthEnd, monthEnd }
}

export interface CurrencySummary {
  currency: Currency
  /** Income and expense of the selected month (and category filter), mirrors left out. */
  income: string
  expense: string
  /** Balance up to the current cutoff / up to the end of the selected month. */
  current: string
  projected: string
}

function inMonth(date: string, month: string): boolean {
  const [y, m] = date.split('-').map(Number)
  const [wantedY, wantedM] = month.split('-').map(Number)
  return y === wantedY && m === wantedM
}

/**
 * One summary per table currency, never adding two currencies together. A transaction that is the
 * target of another's `linkedTransactionId` (the legacy link) or of an invoice detail's
 * `linkedTransactionId` is a mirror and stays out of every total.
 *
 * The month's income/expense follow `categoryFilter` (the desktop's screen filter); the balances do not.
 * Currencies come from every table, even an empty one, sorted by code.
 */
export function consolidatedByCurrency(
  tables: FinancialTable[],
  month: string,
  today: string,
  categoryFilter: string | null = null
): CurrencySummary[] {
  const { currentCutoff, monthEnd } = monthBounds(month, today)
  const all = tables.flatMap((table) =>
    table.transactions.map((tx) => ({ tx, currency: table.currency }))
  )

  const detailLinked = new Set<string>()
  for (const { tx } of all) {
    for (const detail of tx.details ?? []) {
      if (detail.linkedTransactionId) detailLinked.add(detail.linkedTransactionId)
    }
  }

  const sums = new Map<
    Currency,
    { income: Decimal; expense: Decimal; current: Decimal; projected: Decimal }
  >()
  for (const table of tables) {
    if (!sums.has(table.currency)) {
      sums.set(table.currency, {
        income: new Decimal(0),
        expense: new Decimal(0),
        current: new Decimal(0),
        projected: new Decimal(0)
      })
    }
  }

  const monthTxs = all.filter(
    ({ tx }) =>
      inMonth(tx.date, month) && (!categoryFilter || (tx.category ?? '') === categoryFilter)
  )
  const monthLinked = new Set(
    monthTxs.filter(({ tx }) => tx.linkedTransactionId).map(({ tx }) => tx.linkedTransactionId)
  )
  for (const { tx, currency } of monthTxs) {
    if (monthLinked.has(tx.id) || detailLinked.has(tx.id)) continue
    const values = sums.get(currency)!
    if (tx.type === 'income') values.income = values.income.plus(D(tx.amount))
    else values.expense = values.expense.plus(D(tx.amount))
  }

  const allLinked = new Set(
    all.filter(({ tx }) => tx.linkedTransactionId).map(({ tx }) => tx.linkedTransactionId)
  )
  for (const { tx, currency } of all) {
    if (allLinked.has(tx.id) || detailLinked.has(tx.id)) continue
    const values = sums.get(currency)!
    const amount = tx.type === 'income' ? D(tx.amount) : D(tx.amount).negated()
    if (tx.date <= monthEnd) values.projected = values.projected.plus(amount)
    if (tx.date <= currentCutoff) values.current = values.current.plus(amount)
  }

  return [...sums.entries()]
    .map(([currency, v]) => ({
      currency,
      income: v.income.toString(),
      expense: v.expense.toString(),
      current: v.current.toString(),
      projected: v.projected.toString()
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

export interface CategoryTotal {
  /** `''` for an expense with no category. */
  category: string
  amount: string
}

/** Expenses of the month per category, biggest first (equal amounts by name). */
export function categoryBreakdown(txs: FinancialTransaction[], month: string): CategoryTotal[] {
  const totals = new Map<string, Decimal>()
  for (const tx of txs) {
    if (tx.type !== 'expense' || !inMonth(tx.date, month)) continue
    const category = tx.category ?? ''
    totals.set(category, (totals.get(category) ?? new Decimal(0)).plus(D(tx.amount)))
  }
  return [...totals.entries()]
    .sort(([nameA, a], [nameB, b]) => b.comparedTo(a) || nameA.localeCompare(nameB))
    .map(([category, amount]) => ({ category, amount: amount.toString() }))
}

export interface GoalProgress {
  /** Balance up to the goal's cutoff (the view's end, capped at the deadline). */
  effectiveBalance: string
  /** The same, but only what already happened (up to today). */
  actualBalance: string
  /** 0..1 before rounding: what the ring draws. */
  progress: number
  /** Whole percent, 0..100. */
  percent: number
  /** Marked done by hand on or before the viewed date. */
  manuallyCompleted: boolean
  /** Done by hand, or the balance reached the target. */
  achieved: boolean
  /** The balance only reaches the target counting future transactions. */
  projected: boolean
  /** Not achieved and the deadline is before the viewed month. */
  overdue: boolean
}

/**
 * How a financial goal stands when the user looks at `month`. The balance is the table's whole
 * balance (not just the month) up to the viewed day, but never past the goal's deadline month.
 */
export function goalProgress(
  goal: FinancialGoal,
  txs: FinancialTransaction[],
  month: string,
  today: string
): GoalProgress {
  const { monthEnd } = monthBounds(month, today)
  const viewEnd = monthEnd.slice(0, 7) === today.slice(0, 7) ? today : monthEnd
  const deadlineEnd = `${goal.targetYear}-${String(goal.targetMonth).padStart(2, '0')}-31`
  const effectiveCutoff = viewEnd < deadlineEnd ? viewEnd : deadlineEnd
  const target = D(goal.targetAmount)
  const effectiveBalance = tableBalance(txs, effectiveCutoff)
  const actualBalance = tableBalance(txs, today < effectiveCutoff ? today : effectiveCutoff)

  const manuallyCompleted = !!goal.completedAt && goal.completedAt <= viewEnd
  const balanceAchieved = effectiveBalance.greaterThanOrEqualTo(target)
  const achieved = manuallyCompleted || balanceAchieved
  const progress = manuallyCompleted
    ? 1
    : target.greaterThan(0)
      ? Math.min(Math.max(effectiveBalance.div(target).toNumber(), 0), 1)
      : 0

  return {
    effectiveBalance: effectiveBalance.toString(),
    actualBalance: actualBalance.toString(),
    progress,
    percent: Math.round(progress * 100),
    manuallyCompleted,
    achieved,
    projected: balanceAchieved && actualBalance.lessThan(target),
    overdue: !achieved && monthEnd > deadlineEnd
  }
}
