import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import Decimal from 'decimal.js'
import * as core from '@sagyou/core/finance-actions'
import type {
  FinancialTable,
  FinancialProfile,
  FinancialTransaction,
  FinancialGoal,
  ShoppingItem,
  YieldEntry,
  Currency
} from '../../types'
import { DEFAULT_FINANCIAL_PROFILE_ID } from '../../types'
import { applyFinancialTransactionEdit } from '../../utils/financialRecord'
import { todayLocalISO } from '../../utils/dates'

export interface FinancialSlice {
  lists: FinancialTable[]
  financialProfiles: FinancialProfile[]
  activeFinancialProfileId: string
  createFinancialProfile: (name: string) => string
  renameFinancialProfile: (id: string, name: string) => boolean
  setActiveFinancialProfile: (id: string) => void
  addFinancialCategory: (profileId: string, category: string) => void
  removeFinancialCategory: (profileId: string, category: string) => void
  addFinancialSource: (profileId: string, source: string) => void
  removeFinancialSource: (profileId: string, source: string) => void
  addFinancialCounterparty: (profileId: string, counterparty: string) => void
  removeFinancialCounterparty: (profileId: string, counterparty: string) => void
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
  addFinancialDebt: (listId: string, name: string, amount: string) => string
  payFinancialDebt: (listId: string, debtId: string, amount: string, date: string) => boolean
  deleteFinancialDebt: (listId: string, debtId: string) => void
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

type FinancialStore = FinancialSlice & { _persist: () => void }

/**
 * Runs a rule of `@sagyou/core/finance-actions` over the current tables and saves when it changed
 * something. The core answers `{ error }` where the desktop used to ignore the call and returns the
 * very same array when nothing changed: neither is passed on and neither is saved.
 */
function runRule(
  get: () => FinancialStore,
  set: (partial: Partial<FinancialStore>) => void,
  rule: (tables: FinancialTable[]) => core.ActionResult
): core.ActionResult {
  const result = rule(get().lists)
  if (!core.isActionError(result) && result.tables !== get().lists) {
    set({ lists: result.tables })
    get()._persist()
  }
  return result
}

/** The id a rule created, or '' when it refused. */
const idOf = (result: core.ActionResult): string =>
  core.isActionError(result) ? '' : (result.id ?? '')

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

  renameFinancialProfile: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed || !get().financialProfiles.some((p) => p.id === id)) return false
    const now = new Date().toISOString()
    set((s) => ({
      financialProfiles: s.financialProfiles.map((p) =>
        p.id === id ? { ...p, name: trimmed, updatedAt: now } : p
      )
    }))
    get()._persist()
    return true
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

  addFinancialSource: (profileId, source) => {
    const trimmed = source.trim()
    const profile = get().financialProfiles.find((item) => item.id === profileId)
    if (
      !trimmed ||
      profile?.savedSources?.some((item) => item.toLowerCase() === trimmed.toLowerCase())
    )
      return
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              savedSources: [...(item.savedSources ?? []), trimmed],
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  removeFinancialSource: (profileId, source) => {
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              savedSources: (item.savedSources ?? []).filter((value) => value !== source),
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  addFinancialCounterparty: (profileId, counterparty) => {
    const trimmed = counterparty.trim()
    const profile = get().financialProfiles.find((item) => item.id === profileId)
    if (
      !trimmed ||
      profile?.savedCounterparties?.some((item) => item.toLowerCase() === trimmed.toLowerCase())
    )
      return
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              savedCounterparties: [...(item.savedCounterparties ?? []), trimmed],
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  removeFinancialCounterparty: (profileId, counterparty) => {
    set((s) => ({
      financialProfiles: s.financialProfiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              savedCounterparties: (item.savedCounterparties ?? []).filter(
                (value) => value !== counterparty
              ),
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }))
    get()._persist()
  },

  createList: (name, currency = 'BRL', profileId) => {
    const selectedProfile =
      profileId && get().financialProfiles.some((profile) => profile.id === profileId)
        ? profileId
        : get().activeFinancialProfileId
    return idOf(
      runRule(get, set, (tables) =>
        core.createTable(tables, name, currency, selectedProfile, new Date())
      )
    )
  },

  updateList: (id, name) => {
    runRule(get, set, (tables) => core.renameTable(tables, id, name, new Date()))
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
    runRule(get, set, (tables) => core.deleteTable(tables, id, new Date()))
  },

  addItem: (listId, data) =>
    idOf(runRule(get, set, (tables) => core.addItem(tables, listId, data, new Date()))),

  updateItem: (listId, itemId, updates) => {
    runRule(get, set, (tables) => core.updateItem(tables, listId, itemId, updates, new Date()))
  },

  deleteItem: (listId, itemId) => {
    runRule(get, set, (tables) => core.deleteItem(tables, listId, itemId, new Date()))
  },

  toggleItem: (listId, itemId) => {
    // todayLocalISO: the user's wall-clock day, so a toggle after 21:00 BRT
    // still lands on today — matching the AI criar_transacao tool which also
    // uses local date. (The former UTC-based toISOString() landed on tomorrow.)
    const now = new Date()
    const today = todayLocalISO(now)
    runRule(get, set, (tables) => core.toggleItem(tables, listId, itemId, now, today))
  },

  addTransaction: (listId, data) =>
    idOf(runRule(get, set, (tables) => core.addTransaction(tables, listId, data, new Date()))),

  updateTransaction: (listId, txId, updates) => {
    runRule(get, set, (tables) => core.updateTransaction(tables, listId, txId, updates, new Date()))
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
    runRule(get, set, (tables) => core.deleteTransaction(tables, listId, txId, new Date()))
  },

  addFinancialDebt: (listId, name, amount) =>
    idOf(runRule(get, set, (tables) => core.addDebt(tables, listId, name, amount, new Date()))),

  payFinancialDebt: (listId, debtId, amount, date) =>
    !core.isActionError(
      runRule(get, set, (tables) => core.payDebt(tables, listId, debtId, amount, date, new Date()))
    ),

  deleteFinancialDebt: (listId, debtId) => {
    runRule(get, set, (tables) => core.deleteDebt(tables, listId, debtId, new Date()))
  },

  addFinancialGoal: (listId, data) =>
    idOf(runRule(get, set, (tables) => core.addGoal(tables, listId, data, new Date()))),

  updateFinancialGoal: (listId, goalId, updates) => {
    runRule(get, set, (tables) => core.updateGoal(tables, listId, goalId, updates, new Date()))
  },

  deleteFinancialGoal: (listId, goalId) => {
    runRule(get, set, (tables) => core.deleteGoal(tables, listId, goalId, new Date()))
  },

  addYieldSource: (listId, name) =>
    idOf(runRule(get, set, (tables) => core.addYieldSource(tables, listId, name, new Date()))),

  updateYieldSource: (listId, sourceId, name) => {
    runRule(get, set, (tables) =>
      core.updateYieldSource(tables, listId, sourceId, name, new Date())
    )
  },

  deleteYieldSource: (listId, sourceId) => {
    runRule(get, set, (tables) => core.deleteYieldSource(tables, listId, sourceId, new Date()))
  },

  addYieldEntry: (listId, data) =>
    idOf(runRule(get, set, (tables) => core.addYieldEntry(tables, listId, data, new Date()))),

  updateYieldEntry: (listId, entryId, updates) => {
    runRule(get, set, (tables) =>
      core.updateYieldEntry(tables, listId, entryId, updates, new Date())
    )
  },

  deleteYieldEntry: (listId, entryId) => {
    runRule(get, set, (tables) => core.deleteYieldEntry(tables, listId, entryId, new Date()))
  }
})
