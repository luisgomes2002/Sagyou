import { describe, expect, it } from 'vitest'
import {
  addItem,
  addTransaction,
  deleteItem,
  deleteTransaction,
  isActionError,
  toggleItem,
  updateItem,
  updateTransaction,
  type ActionResult,
  type Tables
} from '../finance-actions'
import type { Currency, FinancialTable, FinancialTransaction } from '../types'

// The rules below were ported one by one from the desktop slice's tests
// (apps/desktop/.../store/slices/financial.ts), with the same values: the two apps must agree.

const NOW = new Date('2026-10-16T12:00:00.000Z')
const TODAY = '2026-10-16'
const LIST = 'list'

function table(
  overrides: Partial<FinancialTable> = {},
  currency: Currency = 'BRL'
): FinancialTable {
  return {
    id: LIST,
    name: 'Tabela',
    currency,
    profileId: 'personal',
    items: [],
    transactions: [],
    goals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

/** Unwraps a result that must have succeeded. */
function ok(result: ActionResult): { tables: Tables; id?: string } {
  if (isActionError(result)) throw new Error(`unexpected error: ${result.error}`)
  return result
}

const find = (tables: Tables, id = LIST): FinancialTable => tables.find((t) => t.id === id)!

/** A tiny stateful wrapper so each test reads like the desktop store calls it came from. */
function world(initial: FinancialTable[] = [table()]): {
  tables: () => Tables
  list: (id?: string) => FinancialTable
  addItem: (data: Parameters<typeof addItem>[2]) => string
  updateItem: (itemId: string, updates: Parameters<typeof updateItem>[3]) => void
  deleteItem: (itemId: string) => void
  toggleItem: (itemId: string) => void
  addTransaction: (data: Omit<FinancialTransaction, 'id'>, tableId?: string) => string
  updateTransaction: (txId: string, updates: Partial<FinancialTransaction>) => void
  deleteTransaction: (txId: string, tableId?: string) => void
} {
  let tables: Tables = initial
  return {
    tables: () => tables,
    list: (id = LIST) => find(tables, id),
    addItem: (data) => {
      const r = ok(addItem(tables, LIST, data, NOW))
      tables = r.tables
      return r.id!
    },
    updateItem: (itemId, updates) => {
      tables = ok(updateItem(tables, LIST, itemId, updates, NOW)).tables
    },
    deleteItem: (itemId) => {
      tables = ok(deleteItem(tables, LIST, itemId, NOW)).tables
    },
    toggleItem: (itemId) => {
      tables = ok(toggleItem(tables, LIST, itemId, NOW, TODAY)).tables
    },
    addTransaction: (data, tableId = LIST) => {
      const r = ok(addTransaction(tables, tableId, data, NOW))
      tables = r.tables
      return r.id!
    },
    updateTransaction: (txId, updates) => {
      tables = ok(updateTransaction(tables, LIST, txId, updates, NOW)).tables
    },
    deleteTransaction: (txId, tableId = LIST) => {
      tables = ok(deleteTransaction(tables, tableId, txId, NOW)).tables
    }
  }
}

describe('toggleItem financial link', () => {
  const jpy = (): ReturnType<typeof world> => world([table({}, 'JPY')])

  it('marking done with price creates an expense transaction with correct amount', () => {
    const w = jpy()
    const itemId = w.addItem({ name: 'Rice', qty: 3, price: '1000' })
    w.toggleItem(itemId)
    const list = w.list()
    expect(list.items[0].done).toBe(true)
    expect(list.transactions).toHaveLength(1)
    const tx = list.transactions[0]
    expect(tx.type).toBe('expense')
    expect(tx.amount).toBe('3000')
    expect(tx.description).toBe('Rice')
    expect(tx.fromShopping).toBe(true)
    expect(list.items[0].linkedTransactionId).toBe(tx.id)
  })

  it('marking done without price marks the item as done without creating a transaction', () => {
    const w = jpy()
    const itemId = w.addItem({ name: 'Unknown item', qty: 1 })
    w.toggleItem(itemId)
    const list = w.list()
    expect(list.items[0].done).toBe(true)
    expect(list.items[0].linkedTransactionId).toBeUndefined()
    expect(list.transactions).toHaveLength(0)
  })

  it('unmarking done removes the linked transaction', () => {
    const w = jpy()
    const itemId = w.addItem({ name: 'Milk', qty: 1, price: '200' })
    w.toggleItem(itemId)
    w.toggleItem(itemId)
    const list = w.list()
    expect(list.items[0].done).toBe(false)
    expect(list.items[0].linkedTransactionId).toBeUndefined()
    expect(list.transactions).toHaveLength(0)
  })

  it('toggling multiple items creates independent transactions', () => {
    const w = jpy()
    const id1 = w.addItem({ name: 'A', qty: 1, price: '100' })
    const id2 = w.addItem({ name: 'B', qty: 2, price: '50' })
    w.toggleItem(id1)
    w.toggleItem(id2)
    const list = w.list()
    expect(list.transactions).toHaveLength(2)
    expect(list.transactions.find((t) => t.description === 'A')?.amount).toBe('100')
    expect(list.transactions.find((t) => t.description === 'B')?.amount).toBe('100')
  })

  it('dates the expense with the day the caller passes, not the UTC day of now', () => {
    // 2026-10-17T01:00Z is still 16 Oct on a clock in São Paulo: the caller's `today` wins.
    const late = new Date('2026-10-17T01:00:00.000Z')
    const w = jpy()
    const itemId = w.addItem({ name: 'Rice', qty: 1, price: '10' })
    const r = ok(toggleItem(w.tables(), LIST, itemId, late, '2026-10-16'))
    const list = find(r.tables)
    expect(list.transactions[0].date).toBe('2026-10-16')
    expect(list.transactions[0].createdAt).toBe('2026-10-17T01:00:00.000Z')
    expect(list.updatedAt).toBe('2026-10-16')
  })

  it('refuses an item that does not exist', () => {
    expect(toggleItem([table()], LIST, 'ghost', NOW, TODAY)).toEqual({ error: 'not-found' })
    expect(toggleItem([table()], 'ghost', 'x', NOW, TODAY)).toEqual({ error: 'not-found' })
  })
})

describe('deleteItem financial link', () => {
  it('deleting a done item also removes its linked transaction', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Egg', qty: 12, price: '1.5' })
    w.toggleItem(itemId)
    expect(w.list().transactions).toHaveLength(1)
    w.deleteItem(itemId)
    expect(w.list().items).toHaveLength(0)
    expect(w.list().transactions).toHaveLength(0)
  })

  it('deleting an undone item does not affect transactions', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Bread', qty: 1 })
    w.deleteItem(itemId)
    expect(w.list().transactions).toHaveLength(0)
  })
})

describe('updateItem linked transaction sync', () => {
  it('updating a done item qty updates the linked transaction amount', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Rice', qty: 2, price: '500' })
    w.toggleItem(itemId)
    w.updateItem(itemId, { qty: 5 })
    expect(w.list().transactions[0].amount).toBe('2500')
  })

  it('updating a done item price updates the linked transaction amount', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Rice', qty: 2, price: '500' })
    w.toggleItem(itemId)
    w.updateItem(itemId, { price: '800' })
    expect(w.list().transactions[0].amount).toBe('1600')
  })

  it('updating a done item name updates the linked transaction description', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Old Name', qty: 1, price: '100' })
    w.toggleItem(itemId)
    w.updateItem(itemId, { name: 'New Name' })
    expect(w.list().transactions[0].description).toBe('New Name')
  })

  it('updating both qty and price updates the linked transaction amount', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Rice', qty: 2, price: '500' })
    w.toggleItem(itemId)
    w.updateItem(itemId, { qty: 3, price: '700' })
    expect(w.list().transactions[0].amount).toBe('2100')
  })

  it('updating an undone item does not affect transactions', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Rice', qty: 2, price: '500' })
    w.addTransaction({ description: 'Extra', amount: '50', type: 'expense', date: '2026-04-01' })
    w.updateItem(itemId, { qty: 10 })
    expect(w.list().transactions).toHaveLength(1)
    expect(w.list().transactions[0].amount).toBe('50')
  })

  it('updating a done item without a linked transaction does not touch transactions', () => {
    const w = world()
    const itemId = w.addItem({ name: 'No Price', qty: 1 })
    w.toggleItem(itemId)
    w.addTransaction({ description: 'Manual', amount: '50', type: 'expense', date: '2026-04-01' })
    w.updateItem(itemId, { qty: 5 })
    expect(w.list().transactions).toHaveLength(1)
    expect(w.list().transactions[0].description).toBe('Manual')
  })

  it('refuses an item that does not exist', () => {
    expect(updateItem([table()], LIST, 'ghost', { qty: 2 }, NOW)).toEqual({ error: 'not-found' })
  })
})

describe('addItem price validation', () => {
  it('addItem with valid price string stores it canonicalized', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Item', qty: 1, price: '1500.50' })
    expect(w.list().items.find((i) => i.id === itemId)!.price).toBe('1500.5')
  })

  it('addItem with garbage price stores undefined', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Item', qty: 1, price: 'abc' })
    expect(w.list().items.find((i) => i.id === itemId)!.price).toBeUndefined()
  })

  it('addItem with empty price string stores undefined', () => {
    const w = world()
    const itemId = w.addItem({ name: 'Item', qty: 1, price: '   ' })
    expect(w.list().items.find((i) => i.id === itemId)!.price).toBeUndefined()
  })

  it('refuses a table that does not exist', () => {
    expect(addItem([table()], 'ghost', { name: 'x', qty: 1 }, NOW)).toEqual({ error: 'not-found' })
  })
})

describe('transaction actions', () => {
  it('addTransaction adds an income transaction', () => {
    const w = world([table({}, 'BRL')])
    const txId = w.addTransaction({
      description: 'Salário',
      amount: '5000',
      type: 'income',
      date: '2026-04-01'
    })
    const list = w.list()
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].id).toBe(txId)
    expect(list.transactions[0].type).toBe('income')
    expect(list.transactions[0].amount).toBe('5000')
    expect(list.transactions[0].createdAt).toBe('2026-10-16T12:00:00.000Z')
    expect(list.updatedAt).toBe('2026-10-16T12:00:00.000Z')
  })

  it('addTransaction adds an expense transaction', () => {
    const w = world()
    w.addTransaction({
      description: 'Aluguel',
      amount: '1500',
      type: 'expense',
      date: '2026-04-05',
      category: 'Moradia'
    })
    const tx = w.list().transactions[0]
    expect(tx.type).toBe('expense')
    expect(tx.category).toBe('Moradia')
  })

  it('deleteTransaction removes a manual transaction', () => {
    const w = world()
    const txId = w.addTransaction({
      description: 'Test',
      amount: '100',
      type: 'expense',
      date: '2026-04-01'
    })
    w.deleteTransaction(txId)
    expect(w.list().transactions).toHaveLength(0)
  })

  it('updateTransaction modifies transaction fields', () => {
    const w = world()
    const txId = w.addTransaction({
      description: 'Old',
      amount: '100',
      type: 'expense',
      date: '2026-04-01'
    })
    w.updateTransaction(txId, { description: 'Updated', amount: '200' })
    const tx = w.list().transactions[0]
    expect(tx.description).toBe('Updated')
    expect(tx.amount).toBe('200')
  })

  it('does not allow details to exceed the parent transaction total', () => {
    const w = world()
    const txId = w.addTransaction({
      description: 'Cartão',
      amount: '1200',
      type: 'expense',
      date: '2026-04-01',
      details: [
        {
          id: 'market',
          description: 'Mercado',
          amount: '700',
          category: 'Alimentação',
          date: '2026-03-29'
        }
      ]
    })

    w.updateTransaction(txId, { amount: '600' })
    w.updateTransaction(txId, {
      details: [{ id: 'over', description: 'Acima do total', amount: '1300' }]
    })

    const tx = w.list().transactions[0]
    expect(tx.amount).toBe('1200')
    expect(tx.details).toEqual([
      {
        id: 'market',
        description: 'Mercado',
        amount: '700',
        category: 'Alimentação',
        date: '2026-03-29'
      }
    ])
  })

  it('drops the details of a new transaction when they exceed its total', () => {
    const w = world()
    w.addTransaction({
      description: 'Cartão',
      amount: '100',
      type: 'expense',
      date: '2026-04-01',
      details: [{ id: 'a', description: 'Grande', amount: '150' }]
    })
    expect(w.list().transactions[0].details).toEqual([])
  })

  it('refuses a table or a transaction that does not exist', () => {
    const t = [table()]
    const data = { description: 'x', amount: '1', type: 'expense' as const, date: '2026-04-01' }
    expect(addTransaction(t, 'ghost', data, NOW)).toEqual({ error: 'not-found' })
    expect(updateTransaction(t, LIST, 'ghost', { amount: '2' }, NOW)).toEqual({
      error: 'not-found'
    })
    expect(deleteTransaction(t, LIST, 'ghost', NOW)).toEqual({ error: 'not-found' })
  })

  it('refuses an amount that is not a number instead of storing it', () => {
    const w = world()
    expect(
      addTransaction(
        w.tables(),
        LIST,
        { description: 'x', amount: 'abc', type: 'expense', date: '2026-04-01' },
        NOW
      )
    ).toEqual({ error: 'invalid-amount' })
  })

  it('does not change the tables it receives', () => {
    const before = [table()]
    const snapshot = JSON.stringify(before)
    addTransaction(
      before,
      LIST,
      { description: 'x', amount: '1', type: 'expense', date: '2026-04-01' },
      NOW
    )
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('debts and edits that must keep their meaning', () => {
  const debt = (remaining: string, completedAt?: string): FinancialTable['debts'] => [
    {
      id: 'debt',
      name: 'Curso',
      originalAmount: '100',
      remainingAmount: remaining,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      completedAt
    }
  ]
  const payment: FinancialTransaction = {
    id: 'pay',
    description: 'Pagamento de dívida: Curso',
    amount: '40',
    type: 'expense',
    date: '2026-10-16',
    debtId: 'debt'
  }

  it('deleting a debt payment gives the value back to the debt and reopens it', () => {
    const w = world([
      table({ debts: debt('0', '2026-10-16T10:00:00.000Z'), transactions: [{ ...payment }] })
    ])
    w.deleteTransaction('pay')
    const d = w.list().debts![0]
    expect(d.remainingAmount).toBe('40')
    expect(d.completedAt).toBeUndefined()
    expect(d.updatedAt).toBe('2026-10-16T12:00:00.000Z')
    expect(w.list().transactions).toHaveLength(0)
  })

  it('a debt payment is immutable: editing it changes nothing and keeps the same tables', () => {
    const tables = [table({ debts: debt('60'), transactions: [{ ...payment }] })]
    const r = ok(updateTransaction(tables, LIST, 'pay', { amount: '999' }, NOW))
    expect(r.tables).toBe(tables)
  })

  it('an edit that changes nothing keeps the same tables', () => {
    const tables = [
      table({
        transactions: [
          { id: 't', description: 'Café', amount: '5', type: 'expense', date: '2026-10-01' }
        ]
      })
    ]
    expect(ok(updateTransaction(tables, LIST, 't', { description: 'Café' }, NOW)).tables).toBe(
      tables
    )
  })

  it('deleting one side of a currency transfer clears the pair in the other table', () => {
    const out: FinancialTransaction = {
      id: 'out',
      description: 'Enviar',
      amount: '100',
      type: 'expense',
      date: '2026-10-06',
      currencyTransferId: 'group',
      currencyTransferFee: '5',
      currencyTransferFeeCurrency: 'BRL'
    }
    const incoming: FinancialTransaction = {
      id: 'in',
      description: 'Receber',
      amount: '3000',
      type: 'income',
      date: '2026-10-06',
      currencyTransferId: 'group',
      currencyTransferFee: '5',
      currencyTransferFeeCurrency: 'BRL'
    }
    const w = world([
      table({ id: 'brl', transactions: [out] }, 'BRL'),
      table({ id: 'jpy', transactions: [incoming] }, 'JPY')
    ])
    w.deleteTransaction('out', 'brl')
    const left = w.list('jpy').transactions[0]
    expect(left.currencyTransferId).toBeUndefined()
    expect(left.currencyTransferFee).toBeUndefined()
    expect(left.currencyTransferFeeCurrency).toBeUndefined()
    expect(left.audit?.[0].changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['currencyTransferId', 'currencyTransferFee'])
    )
    expect(w.list('brl').transactions).toHaveLength(0)
  })

  it('does not touch a table that the deletion did not reach', () => {
    const other = table({ id: 'other' }, 'USD')
    const w = world([
      table({
        transactions: [
          { id: 't', description: 'x', amount: '1', type: 'expense', date: '2026-10-01' }
        ]
      }),
      other
    ])
    w.deleteTransaction('t')
    expect(w.list('other')).toBe(other)
  })
})

describe('financial documentation', () => {
  it('keeps old transaction dates unknown and records later edits with previous values', () => {
    const w = world()
    const txId = w.addTransaction({
      description: 'Pagamento',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    w.updateTransaction(txId, {
      bankReference: 'E2E-123',
      counterparty: 'João',
      reconciledAt: '2026-10-07T10:00:00Z'
    })
    const tx = w.list().transactions[0]
    expect(tx.createdAt).toBeTruthy()
    expect(tx.updatedAt).toBeTruthy()
    expect(tx.audit?.[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'bankReference', after: 'E2E-123' }),
        expect.objectContaining({ field: 'counterparty', after: 'João' })
      ])
    )
    w.updateTransaction(txId, { counterparty: 'Maria' })
    expect(w.list().transactions[0].audit?.[1].changes[0]).toMatchObject({
      field: 'counterparty',
      before: 'João',
      after: 'Maria'
    })
  })

  it('clears bank reconciliation when a verified bank reference is corrected', () => {
    const w = world()
    const txId = w.addTransaction({
      description: 'Pagamento',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    w.updateTransaction(txId, {
      bankReference: 'E2E-antigo',
      reconciledAt: '2026-10-07T10:00:00Z'
    })
    w.updateTransaction(txId, { bankReference: 'E2E-correto' })
    const tx = w.list().transactions[0]
    expect(tx.reconciledAt).toBeUndefined()
    expect(tx.audit?.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bankReference',
          before: 'E2E-antigo',
          after: 'E2E-correto'
        }),
        expect.objectContaining({
          field: 'reconciledAt',
          before: '2026-10-07T10:00:00Z',
          after: undefined
        })
      ])
    )
  })

  it('keeps legacyFinancialMetadata, receiptFileIds and the audit trail through an edit', () => {
    const legacy = {
      budgets: [{ category: 'Casa', limit: 100 }],
      recurringTransactions: [{ id: 'monthly', amount: 50 }]
    }
    const audit = [{ at: '2026-10-01T00:00:00.000Z', changes: [{ field: 'amount', before: '1' }] }]
    const w = world([
      table({
        legacyFinancialMetadata: legacy,
        provider: 'Nubank',
        actualBalance: '10',
        transactions: [
          {
            id: 't',
            description: 'Conta de luz',
            amount: '80',
            type: 'expense',
            date: '2026-10-01',
            receiptFileIds: ['file-1', 'file-2'],
            audit,
            createdAt: '2026-10-01T00:00:00.000Z',
            details: [{ id: 'd', description: 'Item', amount: '30' }]
          }
        ]
      })
    ])
    w.updateTransaction('t', { amount: '90', source: 'Nubank' })
    const list = w.list()
    const tx = list.transactions[0]
    expect(list.legacyFinancialMetadata).toEqual(legacy)
    expect(list.provider).toBe('Nubank')
    expect(list.actualBalance).toBe('10')
    expect(tx.receiptFileIds).toEqual(['file-1', 'file-2'])
    expect(tx.details).toEqual([{ id: 'd', description: 'Item', amount: '30' }])
    expect(tx.createdAt).toBe('2026-10-01T00:00:00.000Z')
    // The old audit entry stays first; the edit is appended after it.
    expect(tx.audit?.[0]).toEqual(audit[0])
    expect(tx.audit).toHaveLength(2)
    expect(tx.audit?.[1].changes.map((c) => c.field)).toEqual(['amount', 'source'])
  })
})
