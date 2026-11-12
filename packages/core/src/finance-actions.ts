import Decimal from 'decimal.js'
import type {
  FinancialTable,
  FinancialTransaction,
  FinancialTransactionDetail,
  ShoppingItem
} from './types'
import { applyFinancialTransactionEdit } from './financialRecord'
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

const notFound: ActionResult = { error: 'not-found' }
const invalidAmount: ActionResult = { error: 'invalid-amount' }

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
