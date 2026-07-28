import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import Decimal from 'decimal.js'
import type {
  FinancialTable,
  FinancialTransaction,
  FinancialGoal,
  ShoppingItem,
  Currency
} from '../../types'

export interface FinancialSlice {
  lists: FinancialTable[]
  createList: (name: string, currency?: Currency) => string
  updateList: (id: string, name: string) => void
  setListCurrency: (id: string, currency: Currency) => void
  deleteList: (id: string) => void
  addItem: (
    listId: string,
    data: Pick<ShoppingItem, 'name' | 'qty'> & { price?: string; link?: string }
  ) => string
  updateItem: (
    listId: string,
    itemId: string,
    updates: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'price' | 'done' | 'link'>>
  ) => void
  deleteItem: (listId: string, itemId: string) => void
  toggleItem: (listId: string, itemId: string) => void
  addTransaction: (listId: string, data: Omit<FinancialTransaction, 'id'>) => string
  updateTransaction: (
    listId: string,
    txId: string,
    updates: Partial<Omit<FinancialTransaction, 'id'>>
  ) => void
  deleteTransaction: (listId: string, txId: string) => void
  addFinancialGoal: (listId: string, data: Omit<FinancialGoal, 'id'>) => string
  updateFinancialGoal: (
    listId: string,
    goalId: string,
    updates: Partial<Omit<FinancialGoal, 'id'>>
  ) => void
  deleteFinancialGoal: (listId: string, goalId: string) => void
}

export const createFinancialSlice: StateCreator<
  FinancialSlice & { _persist: () => void },
  [],
  [],
  FinancialSlice
> = (set, get) => ({
  lists: [],

  createList: (name, currency = 'BRL') => {
    const now = new Date().toISOString()
    const id = uuidv4()
    set((s) => ({
      lists: [
        ...s.lists,
        { id, name, currency, items: [], transactions: [], goals: [], createdAt: now, updatedAt: now }
      ]
    }))
    get()._persist()
    return id
  },

  updateList: (id, name) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, name, updatedAt: new Date().toISOString() } : l
      )
    }))
    get()._persist()
  },

  setListCurrency: (id, currency) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, currency, updatedAt: new Date().toISOString() } : l
      )
    }))
    get()._persist()
  },

  deleteList: (id) => {
    set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }))
    get()._persist()
  },

  addItem: (listId, data) => {
    const now = new Date().toISOString()
    const itemId = uuidv4()
    const item: ShoppingItem = {
      id: itemId,
      name: data.name,
      qty: data.qty,
      price: data.price,
      done: false,
      link: data.link
    }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId ? { ...l, items: [...l.items, item], updatedAt: now } : l
      )
    }))
    get()._persist()
    return itemId
  },

  updateItem: (listId, itemId, updates) => {
    const now = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
              updatedAt: now
            }
          : l
      )
    }))
    get()._persist()
  },

  deleteItem: (listId, itemId) => {
    const now = new Date().toISOString()
    const list = get().lists.find((l) => l.id === listId)
    const item = list?.items.find((i) => i.id === itemId)
    const linkedTxId = item?.done ? item.linkedTransactionId : undefined
    set((s) => ({
      lists: s.lists.map((l) => {
        if (l.id !== listId) return l
        return {
          ...l,
          items: l.items.filter((i) => i.id !== itemId),
          transactions: linkedTxId
            ? l.transactions.filter((t) => t.id !== linkedTxId)
            : l.transactions,
          updatedAt: now
        }
      })
    }))
    get()._persist()
  },

  toggleItem: (listId, itemId) => {
    const now = new Date().toISOString()
    const list = get().lists.find((l) => l.id === listId)
    const item = list?.items.find((i) => i.id === itemId)
    if (!item) return

    if (!item.done) {
      const txId = uuidv4()
      const amount = item.price != null ? new Decimal(item.qty).times(item.price).toString() : '0'
      const tx: FinancialTransaction = {
        id: txId,
        description: item.name,
        amount,
        type: 'expense',
        date: now.slice(0, 10),
        fromShopping: true
      }
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id !== listId
            ? l
            : {
                ...l,
                updatedAt: now,
                items: l.items.map((i) =>
                  i.id === itemId ? { ...i, done: true, linkedTransactionId: txId } : i
                ),
                transactions: [...l.transactions, tx]
              }
        )
      }))
    } else {
      const linkedTxId = item.linkedTransactionId
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id !== listId
            ? l
            : {
                ...l,
                updatedAt: now,
                items: l.items.map((i) =>
                  i.id === itemId ? { ...i, done: false, linkedTransactionId: undefined } : i
                ),
                transactions: linkedTxId
                  ? l.transactions.filter((t) => t.id !== linkedTxId)
                  : l.transactions
              }
        )
      }))
    }
    get()._persist()
  },

  addTransaction: (listId, data) => {
    const txId = uuidv4()
    const tx: FinancialTransaction = { id: txId, ...data }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : { ...l, transactions: [...l.transactions, tx], updatedAt: new Date().toISOString() }
      )
    }))
    get()._persist()
    return txId
  },

  updateTransaction: (listId, txId, updates) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              transactions: l.transactions.map((t) =>
                t.id === txId ? { ...t, ...updates } : t
              ),
              updatedAt: new Date().toISOString()
            }
      )
    }))
    get()._persist()
  },

  deleteTransaction: (listId, txId) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              transactions: l.transactions.filter((t) => t.id !== txId),
              updatedAt: new Date().toISOString()
            }
      )
    }))
    get()._persist()
  },

  addFinancialGoal: (listId, data) => {
    const goalId = uuidv4()
    const goal: FinancialGoal = { id: goalId, ...data }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : { ...l, goals: [...l.goals, goal], updatedAt: new Date().toISOString() }
      )
    }))
    get()._persist()
    return goalId
  },

  updateFinancialGoal: (listId, goalId, updates) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              goals: l.goals.map((g) => (g.id === goalId ? { ...g, ...updates } : g)),
              updatedAt: new Date().toISOString()
            }
      )
    }))
    get()._persist()
  },

  deleteFinancialGoal: (listId, goalId) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              goals: l.goals.filter((g) => g.id !== goalId),
              updatedAt: new Date().toISOString()
            }
      )
    }))
    get()._persist()
  }
})
