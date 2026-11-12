import Decimal from 'decimal.js'
import type {
  Currency,
  FinancialDebt,
  FinancialGoal,
  FinancialTable,
  FinancialTransaction,
  FinancialTransactionDetail,
  ShoppingItem,
  YieldEntry,
  YieldSource
} from './types'
import { applyFinancialTransactionEdit } from './financialRecord'
import { MONTH_NAMES, YIELD_SUMMARY_CATEGORY } from './yieldSummary'
import { randomUUID } from './sync/bytes'

/**
 * Write rules of the financial area, shared by the desktop and the phone.
 *
 * Each function is pure: it takes the whole list of tables and returns the new list (or an error),
 * never mutating the input. ⚠️ These mirror, detail for detail, what the desktop's financial slice
 * did before the rules moved here — a rule changed on one side only would make the two apps
 * disagree about the same money. A change of rule goes here, not in a slice.
 *
 * `now` and `today` are injected: the core has no clock of its own, and "today" is the user's local
 * calendar day (the caller passes it), never the UTC day of `now`.
 */

export type Tables = FinancialTable[]

export type ActionError = 'not-found' | 'invalid-amount' | 'over-remaining' | 'invalid-name'

/**
 * `tables` keeps the very same array when the action changed nothing (e.g. editing a debt
 * payment, which is immutable), so a caller can skip saving by comparing references.
 */
export type ActionResult = { tables: Tables; id?: string } | { error: ActionError }

export function isActionError(result: ActionResult): result is { error: ActionError } {
  return 'error' in result
}

export type ItemData = { name: string; qty: number; price?: string; link?: string }
export type ItemUpdates = Partial<Pick<ShoppingItem, 'name' | 'qty' | 'price' | 'done' | 'link'>>

export type GoalData = Omit<FinancialGoal, 'id'>
export type GoalUpdates = Partial<Omit<FinancialGoal, 'id'>>
/** `createdAt` is optional: a caller importing an old entry keeps its own. */
export type YieldEntryData = Omit<YieldEntry, 'id' | 'createdAt'> & { createdAt?: string }
export type YieldEntryUpdates = Partial<Omit<YieldEntry, 'id'>>

const notFound: ActionResult = { error: 'not-found' }
const invalidAmount: ActionResult = { error: 'invalid-amount' }
const overRemaining: ActionResult = { error: 'over-remaining' }
const invalidName: ActionResult = { error: 'invalid-name' }

/** A finite Decimal, or null for anything the desktop would have thrown on. */
function dec(value: string | number): Decimal | null {
  try {
    const d = new Decimal(value)
    return d.isNaN() || !d.isFinite() ? null : d
  } catch {
    return null
  }
}

/**
 * Sum of an invoice's items, or null when one of them is not a number.
 * Details are allocations of the parent amount, never independent expenses.
 */
function detailsTotal(details: FinancialTransactionDetail[] | undefined): Decimal | null {
  let total = new Decimal(0)
  for (const detail of details ?? []) {
    const amount = dec(detail.amount)
    if (!amount) return null
    total = total.plus(amount)
  }
  return total
}

function replaceTable(tables: Tables, id: string, next: FinancialTable): Tables {
  return tables.map((t) => (t.id === id ? next : t))
}

export function addTransaction(
  tables: Tables,
  tableId: string,
  data: Omit<FinancialTransaction, 'id'>,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  const amount = dec(data.amount)
  const detailed = detailsTotal(data.details)
  if (!amount || !detailed) return invalidAmount
  const at = now.toISOString()
  const id = randomUUID()
  const tx: FinancialTransaction = {
    id,
    ...data,
    createdAt: at,
    ...(detailed.greaterThan(amount) ? { details: [] } : {})
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      transactions: [...table.transactions, tx],
      updatedAt: at
    }),
    id
  }
}

export function updateTransaction(
  tables: Tables,
  tableId: string,
  txId: string,
  updates: Partial<Omit<FinancialTransaction, 'id'>>,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  const tx = table?.transactions.find((t) => t.id === txId)
  if (!table || !tx) return notFound
  // A debt payment changes two records atomically. Editing it here could make the debt balance
  // disagree with the expense, so it is immutable.
  if (tx.debtId) return { tables }
  const at = now.toISOString()
  const next = applyFinancialTransactionEdit(tx, updates, at)
  if (next === tx) return { tables }
  const nextAmount = dec(next.amount)
  const detailed = detailsTotal(next.details)
  if (!nextAmount || !detailed) return invalidAmount
  // Details can never exceed their parent: the edit is dropped as a whole.
  if (detailed.greaterThan(nextAmount)) return { tables }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      transactions: table.transactions.map((t) => (t.id === txId ? next : t)),
      updatedAt: at
    })
  }
}

export function deleteTransaction(
  tables: Tables,
  tableId: string,
  txId: string,
  now: Date
): ActionResult {
  const removed = tables.find((t) => t.id === tableId)?.transactions.find((t) => t.id === txId)
  if (!removed) return notFound
  const groupId = removed.currencyTransferId
  const at = now.toISOString()
  const next = tables.map((table) => {
    // The other side of a currency transfer stops being a pair, in whichever table it is.
    const transactions = table.transactions
      .filter((t) => table.id !== tableId || t.id !== txId)
      .map((tx) =>
        groupId && tx.currencyTransferId === groupId
          ? applyFinancialTransactionEdit(
              tx,
              {
                currencyTransferId: undefined,
                currencyTransferFee: undefined,
                currencyTransferFeeCurrency: undefined
              },
              at
            )
          : tx
      )
    // Deleting a debt payment gives its value back to the debt (and reopens it).
    const debts =
      removed.debtId && table.id === tableId
        ? (table.debts ?? []).map((debt) =>
            debt.id !== removed.debtId
              ? debt
              : {
                  ...debt,
                  remainingAmount: new Decimal(debt.remainingAmount)
                    .plus(removed.amount)
                    .toString(),
                  completedAt: undefined,
                  updatedAt: at
                }
          )
        : table.debts
    const changed =
      transactions.length !== table.transactions.length ||
      transactions.some((tx, index) => tx !== table.transactions[index])
    return changed
      ? { ...table, transactions, ...(debts !== table.debts ? { debts } : {}), updatedAt: at }
      : table
  })
  return { tables: next }
}

export function addItem(tables: Tables, tableId: string, data: ItemData, now: Date): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  // A price that is not a number is stored as no price, as the desktop always did.
  let price: string | undefined
  if (typeof data.price === 'string' && data.price.trim() !== '') {
    const d = dec(data.price.trim())
    if (d) price = d.toDecimalPlaces(2).toString()
  }
  const id = randomUUID()
  const item: ShoppingItem = {
    id,
    name: data.name,
    qty: data.qty,
    price,
    done: false,
    link: data.link
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      items: [...table.items, item],
      updatedAt: now.toISOString()
    }),
    id
  }
}

export function updateItem(
  tables: Tables,
  tableId: string,
  itemId: string,
  updates: ItemUpdates,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  const item = table?.items.find((i) => i.id === itemId)
  if (!table || !item) return notFound
  const newItem = { ...item, ...updates }
  let transactions = table.transactions
  // A bought item keeps its expense in step: the amount follows qty × price, the name follows the item.
  if (item.done && item.linkedTransactionId) {
    const newQty = 'qty' in updates && updates.qty !== undefined ? updates.qty : item.qty
    const newPrice = 'price' in updates ? updates.price : item.price
    const newName = 'name' in updates && updates.name !== undefined ? updates.name : item.name
    if (updates.qty !== undefined || 'price' in updates || updates.name !== undefined) {
      let amount: string | undefined
      if (newPrice != null) {
        const price = dec(newPrice)
        if (!price) return invalidAmount
        amount = new Decimal(newQty).times(price).toString()
      }
      const txUpdates: Partial<FinancialTransaction> = {}
      if (amount !== undefined) txUpdates.amount = amount
      if (newName !== undefined) txUpdates.description = newName
      if (Object.keys(txUpdates).length > 0) {
        transactions = table.transactions.map((t) =>
          t.id === item.linkedTransactionId ? { ...t, ...txUpdates } : t
        )
      }
    }
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      items: table.items.map((i) => (i.id === itemId ? newItem : i)),
      transactions,
      updatedAt: now.toISOString()
    })
  }
}

export function deleteItem(
  tables: Tables,
  tableId: string,
  itemId: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  const item = table?.items.find((i) => i.id === itemId)
  if (!table || !item) return notFound
  const linkedTxId = item.done ? item.linkedTransactionId : undefined
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      items: table.items.filter((i) => i.id !== itemId),
      transactions: linkedTxId
        ? table.transactions.filter((t) => t.id !== linkedTxId)
        : table.transactions,
      updatedAt: now.toISOString()
    })
  }
}

/**
 * Marks a shopping item bought or not. Bought with a price records the expense of the day `today`
 * (the user's local day, passed by the caller); unmarking removes it. The table's `updatedAt`
 * takes `today` (a plain date) here, as the desktop always wrote it.
 */
export function toggleItem(
  tables: Tables,
  tableId: string,
  itemId: string,
  now: Date,
  today: string
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  const item = table?.items.find((i) => i.id === itemId)
  if (!table || !item) return notFound

  if (item.done) {
    const linkedTxId = item.linkedTransactionId
    return {
      tables: replaceTable(tables, tableId, {
        ...table,
        updatedAt: today,
        items: table.items.map((i) =>
          i.id === itemId ? { ...i, done: false, linkedTransactionId: undefined } : i
        ),
        transactions: linkedTxId
          ? table.transactions.filter((t) => t.id !== linkedTxId)
          : table.transactions
      })
    }
  }

  if (item.price == null) {
    return {
      tables: replaceTable(tables, tableId, {
        ...table,
        updatedAt: today,
        items: table.items.map((i) =>
          i.id === itemId ? { ...i, done: true, linkedTransactionId: undefined } : i
        )
      })
    }
  }

  const price = dec(item.price)
  if (!price) return invalidAmount
  const txId = randomUUID()
  const tx: FinancialTransaction = {
    id: txId,
    description: item.name,
    amount: new Decimal(item.qty).times(price).toString(),
    type: 'expense',
    date: today,
    fromShopping: true,
    createdAt: now.toISOString()
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      updatedAt: today,
      items: table.items.map((i) =>
        i.id === itemId ? { ...i, done: true, linkedTransactionId: txId } : i
      ),
      transactions: [...table.transactions, tx]
    })
  }
}

// ── Debts ───────────────────────────────────────────────────────────────────

/**
 * Creates a debt. `amount` is the canonical decimal text the caller already parsed. The name is
 * trimmed; an empty name or a value that is not above zero is refused, as the desktop always did.
 */
export function addDebt(
  tables: Tables,
  tableId: string,
  name: string,
  amount: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  const clean = name.trim()
  if (!clean) return invalidName
  const value = dec(amount)
  if (!value || !value.greaterThan(0)) return invalidAmount
  const at = now.toISOString()
  const id = randomUUID()
  const debt: FinancialDebt = {
    id,
    name: clean,
    originalAmount: value.toString(),
    remainingAmount: value.toString(),
    createdAt: at,
    updatedAt: at
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      debts: [...(table.debts ?? []), debt],
      updatedAt: at
    }),
    id
  }
}

/**
 * Pays part (or all) of a debt: the debt and the expense that records the payment change together,
 * in one result, so a caller saving it saves both or neither. A payment above the outstanding
 * amount is `over-remaining`; one that is not a number or not above zero is `invalid-amount`.
 * The returned `id` is the payment's transaction.
 */
export function payDebt(
  tables: Tables,
  tableId: string,
  debtId: string,
  amount: string,
  date: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  const debt = table?.debts?.find((d) => d.id === debtId)
  if (!table || !debt) return notFound
  const value = dec(amount)
  const outstanding = dec(debt.remainingAmount)
  if (!value || !outstanding || !value.greaterThan(0)) return invalidAmount
  if (value.greaterThan(outstanding)) return overRemaining
  const at = now.toISOString()
  const remaining = outstanding.minus(value)
  const id = randomUUID()
  const payment: FinancialTransaction = {
    id,
    description: `Pagamento de dívida: ${debt.name}`,
    amount: value.toString(),
    type: 'expense',
    date,
    category: 'Dívidas',
    debtId,
    createdAt: at
  }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      transactions: [...table.transactions, payment],
      debts: (table.debts ?? []).map((d) =>
        d.id !== debtId
          ? d
          : {
              ...d,
              remainingAmount: remaining.toString(),
              updatedAt: at,
              ...(remaining.isZero() ? { completedAt: at } : {})
            }
      ),
      updatedAt: at
    }),
    id
  }
}

/** Removes a debt; its past payments stay as ordinary expenses, only unlinked. */
export function deleteDebt(
  tables: Tables,
  tableId: string,
  debtId: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.debts?.some((d) => d.id === debtId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      debts: (table.debts ?? []).filter((d) => d.id !== debtId),
      transactions: table.transactions.map((tx) =>
        tx.debtId === debtId ? { ...tx, debtId: undefined } : tx
      ),
      updatedAt: now.toISOString()
    })
  }
}

// ── Financial goals ─────────────────────────────────────────────────────────

export function addGoal(tables: Tables, tableId: string, data: GoalData, now: Date): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  const id = randomUUID()
  const goal: FinancialGoal = { id, ...data }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      goals: [...table.goals, goal],
      updatedAt: now.toISOString()
    }),
    id
  }
}

export function updateGoal(
  tables: Tables,
  tableId: string,
  goalId: string,
  updates: GoalUpdates,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.goals.some((g) => g.id === goalId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      goals: table.goals.map((g) => (g.id === goalId ? { ...g, ...updates } : g)),
      updatedAt: now.toISOString()
    })
  }
}

export function deleteGoal(
  tables: Tables,
  tableId: string,
  goalId: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.goals.some((g) => g.id === goalId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      goals: table.goals.filter((g) => g.id !== goalId),
      updatedAt: now.toISOString()
    })
  }
}

/** Marks a goal as manually completed on `date` (a plain `yyyy-MM-dd`), with an optional note. */
export function completeGoal(
  tables: Tables,
  tableId: string,
  goalId: string,
  date: string,
  note: string | undefined,
  now: Date
): ActionResult {
  return updateGoal(tables, tableId, goalId, { completedAt: date, completionNote: note }, now)
}

/** Reopens a completed goal. */
export function revertGoal(
  tables: Tables,
  tableId: string,
  goalId: string,
  now: Date
): ActionResult {
  return updateGoal(
    tables,
    tableId,
    goalId,
    { completedAt: undefined, completionNote: undefined },
    now
  )
}

// ── Yields ──────────────────────────────────────────────────────────────────

export function addYieldSource(
  tables: Tables,
  tableId: string,
  name: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  const at = now.toISOString()
  const id = randomUUID()
  const source: YieldSource = { id, name: name.trim(), createdAt: at }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldSources: [...(table.yieldSources ?? []), source],
      updatedAt: at
    }),
    id
  }
}

export function updateYieldSource(
  tables: Tables,
  tableId: string,
  sourceId: string,
  name: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.yieldSources?.some((s) => s.id === sourceId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldSources: (table.yieldSources ?? []).map((s) =>
        s.id === sourceId ? { ...s, name: name.trim() } : s
      ),
      updatedAt: now.toISOString()
    })
  }
}

/** Deleting a source also deletes its entries. */
export function deleteYieldSource(
  tables: Tables,
  tableId: string,
  sourceId: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.yieldSources?.some((s) => s.id === sourceId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldSources: (table.yieldSources ?? []).filter((s) => s.id !== sourceId),
      yieldEntries: (table.yieldEntries ?? []).filter((e) => e.sourceId !== sourceId),
      updatedAt: now.toISOString()
    })
  }
}

export function addYieldEntry(
  tables: Tables,
  tableId: string,
  data: YieldEntryData,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  const at = now.toISOString()
  const id = randomUUID()
  const entry: YieldEntry = { id, ...data, createdAt: data.createdAt ?? at }
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldEntries: [...(table.yieldEntries ?? []), entry],
      updatedAt: at
    }),
    id
  }
}

export function updateYieldEntry(
  tables: Tables,
  tableId: string,
  entryId: string,
  updates: YieldEntryUpdates,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.yieldEntries?.some((e) => e.id === entryId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldEntries: (table.yieldEntries ?? []).map((e) =>
        e.id === entryId ? { ...e, ...updates } : e
      ),
      updatedAt: now.toISOString()
    })
  }
}

export function deleteYieldEntry(
  tables: Tables,
  tableId: string,
  entryId: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table || !table.yieldEntries?.some((e) => e.id === entryId)) return notFound
  return {
    tables: replaceTable(tables, tableId, {
      ...table,
      yieldEntries: (table.yieldEntries ?? []).filter((e) => e.id !== entryId),
      updatedAt: now.toISOString()
    })
  }
}

/**
 * Keeps the month's summary income in step with the yield entries: the entries of `month`
 * (`month.month` is 1-12) are summed and the transaction `Rendimentos <Mês> <ano>`, dated on day 1,
 * is created, updated (amount, or an old last-day date) or deleted when the month has no entries.
 * Returns the very same table when nothing needs to change, so a caller can skip saving.
 *
 * It goes through the transaction rules above, as the desktop's effect did through its store, so
 * the audit trail and `updatedAt` match. An entry whose amount is not a number is left out of the sum.
 */
export function syncYieldSummary(
  table: FinancialTable,
  month: { year: number; month: number },
  now: Date
): FinancialTable {
  const description = `Rendimentos ${MONTH_NAMES[month.month - 1]} ${month.year}`
  const date = `${month.year}-${String(month.month).padStart(2, '0')}-01`

  let total = new Decimal(0)
  for (const entry of table.yieldEntries ?? []) {
    const d = new Date(entry.date + 'T12:00:00')
    if (d.getFullYear() !== month.year || d.getMonth() + 1 !== month.month) continue
    const value = dec(entry.amount)
    if (value) total = total.plus(value)
  }
  const amount = total.toDecimalPlaces(2).toString()
  const existing = table.transactions.find(
    (t) => t.description === description && t.type === 'income'
  )
  const single = [table]

  let result: ActionResult
  if (total.isZero()) {
    if (!existing) return table
    result = deleteTransaction(single, table.id, existing.id, now)
  } else if (existing) {
    const staleDate = existing.category === YIELD_SUMMARY_CATEGORY && existing.date !== date
    if (existing.amount === amount && !staleDate) return table
    result = updateTransaction(single, table.id, existing.id, { amount, date }, now)
  } else {
    result = addTransaction(
      single,
      table.id,
      { description, amount, type: 'income', date, category: YIELD_SUMMARY_CATEGORY },
      now
    )
  }
  return isActionError(result) ? table : (result.tables[0] ?? table)
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** `profileId` arrives already resolved: the caller decides which profile a new table belongs to. */
export function createTable(
  tables: Tables,
  name: string,
  currency: Currency,
  profileId: string,
  now: Date
): ActionResult {
  const at = now.toISOString()
  const id = randomUUID()
  const table: FinancialTable = {
    id,
    name,
    currency,
    profileId,
    items: [],
    transactions: [],
    goals: [],
    yieldSources: [],
    yieldEntries: [],
    createdAt: at,
    updatedAt: at
  }
  return { tables: [...tables, table], id }
}

export function renameTable(
  tables: Tables,
  tableId: string,
  name: string,
  now: Date
): ActionResult {
  const table = tables.find((t) => t.id === tableId)
  if (!table) return notFound
  return {
    tables: replaceTable(tables, tableId, { ...table, name, updatedAt: now.toISOString() })
  }
}

/**
 * Deletes a table with everything in it. A currency-transfer pair that had one side here stops
 * being a pair in the other tables (the audit records it); tables the deletion did not reach are
 * returned untouched, `updatedAt` included.
 */
export function deleteTable(tables: Tables, tableId: string, now: Date): ActionResult {
  const removed = tables.find((t) => t.id === tableId)
  if (!removed) return notFound
  const groups = new Set(
    removed.transactions.map((tx) => tx.currencyTransferId).filter((g): g is string => !!g)
  )
  const at = now.toISOString()
  const next = tables
    .filter((t) => t.id !== tableId)
    .map((table) => {
      const transactions = table.transactions.map((tx) =>
        tx.currencyTransferId && groups.has(tx.currencyTransferId)
          ? applyFinancialTransactionEdit(
              tx,
              {
                currencyTransferId: undefined,
                currencyTransferFee: undefined,
                currencyTransferFeeCurrency: undefined
              },
              at
            )
          : tx
      )
      return transactions.some((tx, index) => tx !== table.transactions[index])
        ? { ...table, transactions }
        : table
    })
  return { tables: next }
}
