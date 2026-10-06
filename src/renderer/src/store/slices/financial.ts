import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import Decimal from 'decimal.js'
import type {
  FinancialTable,
  FinancialProfile,
  FinancialTransaction,
  FinancialGoal,
  ShoppingItem,
  YieldSource,
  YieldEntry,
  Currency
} from '../../types'
import { DEFAULT_FINANCIAL_PROFILE_ID } from '../../types'
import { applyFinancialTransactionEdit } from '../../utils/financialRecord'

export interface FinancialSlice {
  lists: FinancialTable[]
  financialProfiles: FinancialProfile[]
  activeFinancialProfileId: string
  createFinancialProfile: (name: string) => string
  setActiveFinancialProfile: (id: string) => void
  addFinancialCategory: (profileId: string, category: string) => void
  removeFinancialCategory: (profileId: string, category: string) => void
  createList: (name: string, currency?: Currency, profileId?: string) => string
  updateList: (id: string, name: string) => void
  setListCurrency: (id: string, currency: Currency) => void
  updateFinancialSettings: (
    id: string,
    settings: Partial<Pick<FinancialTable, 'provider' | 'actualBalance' | 'actualBalanceUpdatedAt'>>
  ) => void
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
  linkCurrencyTransfer: (
    fromListId: string,
    fromTxId: string,
    toListId: string,
    toTxId: string
  ) => boolean
  unlinkCurrencyTransfer: (groupId: string) => void
  setCurrencyTransferFee: (
    groupId: string,
    fee: string | undefined,
    currency: Currency | undefined
  ) => void
  addFinancialGoal: (listId: string, data: Omit<FinancialGoal, 'id'>) => string
  updateFinancialGoal: (
    listId: string,
    goalId: string,
    updates: Partial<Omit<FinancialGoal, 'id'>>
  ) => void
  deleteFinancialGoal: (listId: string, goalId: string) => void
  addYieldSource: (listId: string, name: string) => string
  updateYieldSource: (listId: string, sourceId: string, name: string) => void
  deleteYieldSource: (listId: string, sourceId: string) => void
  addYieldEntry: (listId: string, data: Omit<YieldEntry, 'id'>) => string
  updateYieldEntry: (
    listId: string,
    entryId: string,
    updates: Partial<Omit<YieldEntry, 'id'>>
  ) => void
  deleteYieldEntry: (listId: string, entryId: string) => void
}

export const createFinancialSlice: StateCreator<
  FinancialSlice & { _persist: () => void },
  [],
  [],
  FinancialSlice
> = (set, get) => ({
  lists: [],
  financialProfiles: [
    {
      id: DEFAULT_FINANCIAL_PROFILE_ID,
      name: 'Minhas finanças',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z'
    }
  ],
  activeFinancialProfileId: DEFAULT_FINANCIAL_PROFILE_ID,

  createFinancialProfile: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const now = new Date().toISOString()
    const id = uuidv4()
    set((s) => ({
      financialProfiles: [
        ...s.financialProfiles,
        { id, name: trimmed, createdAt: now, updatedAt: now }
      ]
    }))
    get()._persist()
    return id
  },

  setActiveFinancialProfile: (id) => {
    if (!get().financialProfiles.some((profile) => profile.id === id)) return
    set({ activeFinancialProfileId: id })
    get()._persist()
  },

  addFinancialCategory: (profileId, category) => {
    const trimmed = category.trim()
    if (!trimmed) return
    const profile = get().financialProfiles.find((item) => item.id === profileId)
    if (
      !profile ||
      profile.customCategories?.some((item) => item.toLowerCase() === trimmed.toLowerCase())
    )
      return
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              customCategories: [...(item.customCategories ?? []), trimmed],
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  removeFinancialCategory: (profileId, category) => {
    const profile = get().financialProfiles.find((item) => item.id === profileId)
    if (!profile?.customCategories?.includes(category)) return
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              customCategories: (item.customCategories ?? []).filter((value) => value !== category),
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  createList: (name, currency = 'BRL', profileId) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const selectedProfile =
      profileId && get().financialProfiles.some((profile) => profile.id === profileId)
        ? profileId
        : get().activeFinancialProfileId
    set((s) => ({
      lists: [
        ...s.lists,
        {
          id,
          name,
          currency,
          profileId: selectedProfile,
          items: [],
          transactions: [],
          goals: [],
          yieldSources: [],
          yieldEntries: [],
          createdAt: now,
          updatedAt: now
        }
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

  updateFinancialSettings: (id, settings) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, ...settings, updatedAt: new Date().toISOString() } : l
      )
    }))
    get()._persist()
  },

  deleteList: (id) => {
    const groups = new Set(
      get()
        .lists.find((list) => list.id === id)
        ?.transactions.map((tx) => tx.currencyTransferId)
        .filter(Boolean)
    )
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists
        .filter((l) => l.id !== id)
        .map((list) => ({
          ...list,
          transactions: list.transactions.map((tx) =>
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
        }))
    }))
    get()._persist()
  },

  addItem: (listId, data) => {
    const now = new Date().toISOString()
    const itemId = uuidv4()
    let price: string | undefined = undefined
    if (typeof data.price === 'string' && data.price.trim() !== '') {
      try {
        const d = new Decimal(data.price.trim())
        if (!d.isNaN() && d.isFinite()) price = d.toDecimalPlaces(2).toString()
      } catch {
        /* invalid price => store as undefined */
      }
    }
    const item: ShoppingItem = {
      id: itemId,
      name: data.name,
      qty: data.qty,
      price,
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
      lists: s.lists.map((l) => {
        if (l.id !== listId) return l
        const item = l.items.find((i) => i.id === itemId)
        if (!item) return l
        const newItem = { ...item, ...updates }
        let transactions = l.transactions
        if (item.done && item.linkedTransactionId) {
          const newQty = 'qty' in updates && updates.qty !== undefined ? updates.qty : item.qty
          const newPrice = 'price' in updates ? (updates.price as string | undefined) : item.price
          const newName = 'name' in updates && updates.name !== undefined ? updates.name : item.name
          if (updates.qty !== undefined || 'price' in updates || updates.name !== undefined) {
            const amount =
              newPrice != null ? new Decimal(newQty).times(newPrice).toString() : undefined
            const txUpdates: Partial<FinancialTransaction> = {}
            if (amount !== undefined) txUpdates.amount = amount
            if (newName !== undefined) txUpdates.description = newName
            if (Object.keys(txUpdates).length > 0) {
              transactions = l.transactions.map((t) =>
                t.id === item.linkedTransactionId ? { ...t, ...txUpdates } : t
              )
            }
          }
        }
        return {
          ...l,
          items: l.items.map((i) => (i.id === itemId ? newItem : i)),
          transactions,
          updatedAt: now
        }
      })
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
    // todayLocalISO: the user's wall-clock day, so a toggle after 21:00 BRT
    // still lands on today — matching the AI criar_transacao tool which also
    // uses local date. (The former UTC-based toISOString() landed on tomorrow.)
    const d = new Date()
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const list = get().lists.find((l) => l.id === listId)
    const item = list?.items.find((i) => i.id === itemId)
    if (!item) return

    if (!item.done) {
      if (item.price == null) {
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id !== listId
              ? l
              : {
                  ...l,
                  updatedAt: local,
                  items: l.items.map((i) =>
                    i.id === itemId ? { ...i, done: true, linkedTransactionId: undefined } : i
                  )
                }
          )
        }))
        get()._persist()
        return
      }
      const txId = uuidv4()
      const amount = new Decimal(item.qty).times(item.price).toString()
      const tx: FinancialTransaction = {
        id: txId,
        description: item.name,
        amount,
        type: 'expense',
        date: local,
        fromShopping: true,
        createdAt: new Date().toISOString()
      }
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id !== listId
            ? l
            : {
                ...l,
                updatedAt: local,
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
                updatedAt: local,
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
    const details = data.details ?? []
    const detailed = details.reduce((total, detail) => total.plus(detail.amount), new Decimal(0))
    // Details are allocations of the parent amount, never independent expenses.
    const tx: FinancialTransaction = {
      id: txId,
      ...data,
      createdAt: new Date().toISOString(),
      ...(detailed.greaterThan(new Decimal(data.amount)) ? { details: [] } : {})
    }
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
    let changed = false
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) => {
        if (l.id !== listId) return l
        const transactions = l.transactions.map((t) => {
          if (t.id !== txId) return t
          const next = applyFinancialTransactionEdit(t, updates, at)
          const detailed = (next.details ?? []).reduce(
            (total, detail) => total.plus(detail.amount),
            new Decimal(0)
          )
          if (detailed.greaterThan(new Decimal(next.amount))) return t
          if (next !== t) changed = true
          return next
        })
        return changed ? { ...l, transactions, updatedAt: at } : l
      })
    }))
    if (changed) get()._persist()
  },

  linkCurrencyTransfer: (fromListId, fromTxId, toListId, toTxId) => {
    const fromList = get().lists.find((list) => list.id === fromListId)
    const toList = get().lists.find((list) => list.id === toListId)
    const from = fromList?.transactions.find((tx) => tx.id === fromTxId)
    const to = toList?.transactions.find((tx) => tx.id === toTxId)
    if (
      !fromList ||
      !toList ||
      !from ||
      !to ||
      fromList.id === toList.id ||
      fromList.profileId !== toList.profileId ||
      fromList.currency === toList.currency ||
      from.type !== 'expense' ||
      to.type !== 'income' ||
      from.currencyTransferId ||
      to.currencyTransferId ||
      from.linkedTransactionId ||
      to.linkedTransactionId ||
      from.fromShopping ||
      to.fromShopping ||
      get().lists.some((list) =>
        list.transactions.some(
          (tx) =>
            tx.linkedTransactionId === from.id ||
            tx.linkedTransactionId === to.id ||
            tx.details?.some(
              (detail) =>
                detail.linkedTransactionId === from.id || detail.linkedTransactionId === to.id
            )
        )
      )
    )
      return false
    const groupId = uuidv4()
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((list) =>
        list.id !== fromListId && list.id !== toListId
          ? list
          : {
              ...list,
              transactions: list.transactions.map((tx) =>
                tx.id === fromTxId || tx.id === toTxId
                  ? applyFinancialTransactionEdit(tx, { currencyTransferId: groupId }, at)
                  : tx
              ),
              updatedAt: at
            }
      )
    }))
    get()._persist()
    return true
  },

  unlinkCurrencyTransfer: (groupId) => {
    if (!groupId) return
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((list) => ({
        ...list,
        transactions: list.transactions.map((tx) =>
          tx.currencyTransferId === groupId
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
      }))
    }))
    get()._persist()
  },

  setCurrencyTransferFee: (groupId, fee, currency) => {
    if (!groupId) return
    if (fee !== undefined) {
      try {
        if (!new Decimal(fee).isFinite() || new Decimal(fee).isNegative()) return
      } catch {
        return
      }
    }
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((list) => ({
        ...list,
        transactions: list.transactions.map((tx) =>
          tx.currencyTransferId === groupId
            ? applyFinancialTransactionEdit(
                tx,
                { currencyTransferFee: fee, currencyTransferFeeCurrency: currency },
                at
              )
            : tx
        )
      }))
    }))
    get()._persist()
  },

  deleteTransaction: (listId, txId) => {
    const groupId = get()
      .lists.find((l) => l.id === listId)
      ?.transactions.find((tx) => tx.id === txId)?.currencyTransferId
    const at = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) => {
        const transactions = l.transactions
          .filter((t) => l.id !== listId || t.id !== txId)
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
        return transactions.length !== l.transactions.length ||
          transactions.some((tx, index) => tx !== l.transactions[index])
          ? { ...l, transactions, updatedAt: at }
          : l
      })
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
  },

  addYieldSource: (listId, name) => {
    const now = new Date().toISOString()
    const sourceId = uuidv4()
    const source: YieldSource = { id: sourceId, name: name.trim(), createdAt: now }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? { ...l, yieldSources: [...(l.yieldSources ?? []), source], updatedAt: now }
          : l
      )
    }))
    get()._persist()
    return sourceId
  },

  updateYieldSource: (listId, sourceId, name) => {
    const now = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              yieldSources: (l.yieldSources ?? []).map((s) =>
                s.id === sourceId ? { ...s, name: name.trim() } : s
              ),
              updatedAt: now
            }
          : l
      )
    }))
    get()._persist()
  },

  deleteYieldSource: (listId, sourceId) => {
    const now = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              yieldSources: (l.yieldSources ?? []).filter((s) => s.id !== sourceId),
              yieldEntries: (l.yieldEntries ?? []).filter((e) => e.sourceId !== sourceId),
              updatedAt: now
            }
          : l
      )
    }))
    get()._persist()
  },

  addYieldEntry: (listId, data) => {
    const entryId = uuidv4()
    const now = new Date().toISOString()
    const entry: YieldEntry = { id: entryId, ...data, createdAt: data.createdAt ?? now }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              yieldEntries: [...(l.yieldEntries ?? []), entry],
              updatedAt: new Date().toISOString()
            }
          : l
      )
    }))
    get()._persist()
    return entryId
  },

  updateYieldEntry: (listId, entryId, updates) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              yieldEntries: (l.yieldEntries ?? []).map((e) =>
                e.id === entryId ? { ...e, ...updates } : e
              ),
              updatedAt: new Date().toISOString()
            }
          : l
      )
    }))
    get()._persist()
  },

  deleteYieldEntry: (listId, entryId) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              yieldEntries: (l.yieldEntries ?? []).filter((e) => e.id !== entryId),
              updatedAt: new Date().toISOString()
            }
          : l
      )
    }))
    get()._persist()
  }
})
