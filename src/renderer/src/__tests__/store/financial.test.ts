import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      })
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadConversations = vi.fn().mockResolvedValue([])
      this.saveConversations = vi.fn().mockResolvedValue(undefined)
      this.loadMemories = vi.fn().mockResolvedValue([])
      this.replaceMemories = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { DEFAULT_FINANCIAL_PROFILE_ID } from '../../types'
import { preserveLegacyFinancialMetadata } from '../../utils/financialLegacy'
import { financialCategories } from '../../components/financial/shared'

function resetStore() {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
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
    activeProjectId: null,
    sprintFilter: null,
    activeTimers: [],
    isLoaded: false
  })
}

// ── FinancialTable CRUD ───────────────────────────────────────────────────────

describe('financial table creation', () => {
  beforeEach(resetStore)

  it('creates tables in the selected financial profile', () => {
    const profileId = useKanbanStore.getState().createFinancialProfile('Finanças dos meus pais')
    useKanbanStore.getState().setActiveFinancialProfile(profileId)
    const tableId = useKanbanStore.getState().createList('Casa')
    expect(useKanbanStore.getState().lists.find((list) => list.id === tableId)?.profileId).toBe(
      profileId
    )
    expect(useKanbanStore.getState().activeFinancialProfileId).toBe(profileId)
  })

  it('keeps custom categories scoped to the profile and preserves old transactions when removed', () => {
    const companyId = useKanbanStore.getState().createFinancialProfile('Murasaki')
    const companyTable = useKanbanStore.getState().createList('Murasaki Japão', 'JPY', companyId)
    const personalTable = useKanbanStore.getState().createList('Pessoal', 'JPY')
    useKanbanStore.getState().addFinancialCategory(companyId, 'Canal')
    useKanbanStore.getState().addFinancialCategory(companyId, 'canal')
    expect(
      useKanbanStore.getState().financialProfiles.find((profile) => profile.id === companyId)
        ?.customCategories
    ).toEqual(['Canal'])
    expect(
      useKanbanStore
        .getState()
        .financialProfiles.find((profile) => profile.id === DEFAULT_FINANCIAL_PROFILE_ID)
        ?.customCategories
    ).toBeUndefined()

    useKanbanStore.getState().addTransaction(companyTable, {
      description: 'Câmera',
      amount: '1000',
      type: 'expense',
      date: '2026-10-06',
      category: 'Canal'
    })
    useKanbanStore.getState().removeFinancialCategory(companyId, 'Canal')
    const state = useKanbanStore.getState()
    expect(state.lists.find((list) => list.id === companyTable)?.transactions[0].category).toBe(
      'Canal'
    )
    expect(
      financialCategories(
        state.financialProfiles.find((profile) => profile.id === companyId),
        state.lists.filter((list) => list.profileId === companyId)
      )
    ).toContain('Canal')
    expect(
      financialCategories(
        state.financialProfiles.find((profile) => profile.id === DEFAULT_FINANCIAL_PROFILE_ID),
        state.lists.filter((list) => list.id === personalTable)
      )
    ).not.toContain('Canal')
  })

  it('deleteList removes the table entirely', () => {
    const id = useKanbanStore.getState().createList('Empresa 1')
    useKanbanStore.getState().deleteList(id)
    expect(useKanbanStore.getState().lists).toHaveLength(0)
  })
})

describe('legacy financial metadata', () => {
  it('retains unsupported old settings without exposing them as active table fields', () => {
    const old = {
      id: 'old',
      name: 'Old',
      currency: 'BRL',
      items: [],
      transactions: [],
      goals: [],
      budgets: [{ category: 'Casa', limit: 100 }],
      recurringTransactions: [{ id: 'monthly', amount: 50 }],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    }
    const normalized = preserveLegacyFinancialMetadata(
      old as unknown as import('../../types').FinancialTable
    )
    expect('budgets' in normalized).toBe(false)
    expect('recurringTransactions' in normalized).toBe(false)
    expect(normalized.legacyFinancialMetadata).toEqual({
      budgets: old.budgets,
      recurringTransactions: old.recurringTransactions
    })
  })
})

describe('financial documentation and currency transfers', () => {
  beforeEach(resetStore)

  it('keeps old transaction dates unknown and records later edits with previous values', () => {
    const listId = useKanbanStore.getState().createList('Brasil', 'BRL')
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Pagamento',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    useKanbanStore.getState().updateTransaction(listId, txId, {
      bankReference: 'E2E-123',
      counterparty: 'João',
      reconciledAt: '2026-10-07T10:00:00Z'
    })
    const tx = useKanbanStore.getState().lists.find((list) => list.id === listId)!.transactions[0]
    expect(tx.createdAt).toBeTruthy()
    expect(tx.updatedAt).toBeTruthy()
    expect(tx.audit?.[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'bankReference', after: 'E2E-123' }),
        expect.objectContaining({ field: 'counterparty', after: 'João' })
      ])
    )
    useKanbanStore.getState().updateTransaction(listId, txId, { counterparty: 'Maria' })
    expect(
      useKanbanStore.getState().lists.find((list) => list.id === listId)!.transactions[0].audit?.[1]
        .changes[0]
    ).toMatchObject({ field: 'counterparty', before: 'João', after: 'Maria' })
  })

  it('clears bank reconciliation when a verified bank reference is corrected', () => {
    const listId = useKanbanStore.getState().createList('Brasil', 'BRL')
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Pagamento',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    useKanbanStore.getState().updateTransaction(listId, txId, {
      bankReference: 'E2E-antigo',
      reconciledAt: '2026-10-07T10:00:00Z'
    })
    useKanbanStore.getState().updateTransaction(listId, txId, { bankReference: 'E2E-correto' })
    const tx = useKanbanStore.getState().lists.find((list) => list.id === listId)!.transactions[0]
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

  it('pairs different currencies without using invoice links and clears the pair on deletion', () => {
    const brl = useKanbanStore.getState().createList('Brasil', 'BRL')
    const jpy = useKanbanStore.getState().createList('Japão', 'JPY')
    const out = useKanbanStore.getState().addTransaction(brl, {
      description: 'Enviar',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    const incoming = useKanbanStore.getState().addTransaction(jpy, {
      description: 'Receber',
      amount: '3000',
      type: 'income',
      date: '2026-10-06'
    })
    expect(useKanbanStore.getState().linkCurrencyTransfer(brl, out, jpy, incoming)).toBe(true)
    const first = useKanbanStore.getState().lists.find((list) => list.id === brl)!.transactions[0]
    const second = useKanbanStore.getState().lists.find((list) => list.id === jpy)!.transactions[0]
    expect(first.currencyTransferId).toBe(second.currencyTransferId)
    expect(first.linkedTransactionId).toBeUndefined()
    useKanbanStore.getState().setCurrencyTransferFee(first.currencyTransferId!, '5', 'BRL')
    expect(
      useKanbanStore.getState().lists.find((list) => list.id === jpy)!.transactions[0]
        .currencyTransferFee
    ).toBe('5')
    useKanbanStore.getState().deleteTransaction(brl, out)
    expect(
      useKanbanStore.getState().lists.find((list) => list.id === jpy)!.transactions[0]
        .currencyTransferId
    ).toBeUndefined()
  })

  it('refuses pairing transactions from different financial profiles', () => {
    const brl = useKanbanStore.getState().createList('Brasil', 'BRL')
    const other = useKanbanStore.getState().createFinancialProfile('Empresa')
    const jpy = useKanbanStore.getState().createList('Japão', 'JPY', other)
    const out = useKanbanStore.getState().addTransaction(brl, {
      description: 'Enviar',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    const incoming = useKanbanStore.getState().addTransaction(jpy, {
      description: 'Receber',
      amount: '3000',
      type: 'income',
      date: '2026-10-06'
    })
    expect(useKanbanStore.getState().linkCurrencyTransfer(brl, out, jpy, incoming)).toBe(false)
  })
})

// ── Shopping → Finance link (toggleItem) ─────────────────────────────────────

describe('toggleItem financial link', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Cart', 'JPY')
  })

  it('marking done with price creates an expense transaction with correct amount', () => {
    const itemId = useKanbanStore
      .getState()
      .addItem(listId, { name: 'Rice', qty: 3, price: '1000' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
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
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Unknown item', qty: 1 })
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items[0].done).toBe(true)
    expect(list.items[0].linkedTransactionId).toBeUndefined()
    expect(list.transactions).toHaveLength(0)
  })

  it('unmarking done removes the linked transaction', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Milk', qty: 1, price: '200' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items[0].done).toBe(false)
    expect(list.items[0].linkedTransactionId).toBeUndefined()
    expect(list.transactions).toHaveLength(0)
  })

  it('toggling multiple items creates independent transactions', () => {
    const id1 = useKanbanStore.getState().addItem(listId, { name: 'A', qty: 1, price: '100' })
    const id2 = useKanbanStore.getState().addItem(listId, { name: 'B', qty: 2, price: '50' })
    useKanbanStore.getState().toggleItem(listId, id1)
    useKanbanStore.getState().toggleItem(listId, id2)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions).toHaveLength(2)
    expect(list.transactions.find((t) => t.description === 'A')?.amount).toBe('100')
    expect(list.transactions.find((t) => t.description === 'B')?.amount).toBe('100')
  })
})

// ── deleteItem removes linked transaction ────────────────────────────────────

describe('deleteItem financial link', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Cart')
  })

  it('deleting a done item also removes its linked transaction', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Egg', qty: 12, price: '1.5' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(
      1
    )
    useKanbanStore.getState().deleteItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items).toHaveLength(0)
    expect(list.transactions).toHaveLength(0)
  })

  it('deleting an undone item does not affect transactions', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Bread', qty: 1 })
    useKanbanStore.getState().deleteItem(listId, itemId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(
      0
    )
  })
})

// ── updateItem keeps linked transaction in sync ──────────────────────────────

describe('updateItem linked transaction sync', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Cart')
  })

  it('updating a done item qty updates the linked transaction amount', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Rice', qty: 2, price: '500' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 5 })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions[0].amount).toBe('2500')
  })

  it('updating a done item price updates the linked transaction amount', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Rice', qty: 2, price: '500' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().updateItem(listId, itemId, { price: '800' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions[0].amount).toBe('1600')
  })

  it('updating a done item name updates the linked transaction description', () => {
    const itemId = useKanbanStore
      .getState()
      .addItem(listId, { name: 'Old Name', qty: 1, price: '100' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().updateItem(listId, itemId, { name: 'New Name' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions[0].description).toBe('New Name')
  })

  it('updating both qty and price updates the linked transaction amount', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Rice', qty: 2, price: '500' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 3, price: '700' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions[0].amount).toBe('2100')
  })

  it('updating an undone item does not affect transactions', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Rice', qty: 2, price: '500' })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Extra',
      amount: '50',
      type: 'expense',
      date: '2026-04-01'
    })
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 10 })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].amount).toBe('50')
  })

  it('updating a done item without a linked transaction does not touch transactions', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'No Price', qty: 1 })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Manual',
      amount: '50',
      type: 'expense',
      date: '2026-04-01'
    })
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 5 })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].description).toBe('Manual')
  })
})

// ── addItem price validation ──────────────────────────────────────────────────

describe('addItem price validation', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Cart')
  })

  it('addItem with valid price string stores it canonicalized', () => {
    const itemId = useKanbanStore
      .getState()
      .addItem(listId, { name: 'Item', qty: 1, price: '1500.50' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const item = list.items.find((i) => i.id === itemId)!
    expect(item.price).toBe('1500.5')
  })

  it('addItem with garbage price stores undefined', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Item', qty: 1, price: 'abc' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const item = list.items.find((i) => i.id === itemId)!
    expect(item.price).toBeUndefined()
  })

  it('addItem with empty price string stores undefined', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Item', qty: 1, price: '   ' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const item = list.items.find((i) => i.id === itemId)!
    expect(item.price).toBeUndefined()
  })
})

// ── Transactions CRUD ─────────────────────────────────────────────────────────

describe('transaction actions', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Pessoal', 'BRL')
  })

  it('addTransaction adds an income transaction', () => {
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Salário',
      amount: '5000',
      type: 'income',
      date: '2026-04-01'
    })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].id).toBe(txId)
    expect(list.transactions[0].type).toBe('income')
    expect(list.transactions[0].amount).toBe('5000')
  })

  it('addTransaction adds an expense transaction', () => {
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Aluguel',
      amount: '1500',
      type: 'expense',
      date: '2026-04-05',
      category: 'Moradia'
    })
    const tx = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions[0]
    expect(tx.type).toBe('expense')
    expect(tx.category).toBe('Moradia')
  })

  it('deleteTransaction removes a manual transaction', () => {
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Test',
      amount: '100',
      type: 'expense',
      date: '2026-04-01'
    })
    useKanbanStore.getState().deleteTransaction(listId, txId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(
      0
    )
  })

  it('updateTransaction modifies transaction fields', () => {
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Old',
      amount: '100',
      type: 'expense',
      date: '2026-04-01'
    })
    useKanbanStore
      .getState()
      .updateTransaction(listId, txId, { description: 'Updated', amount: '200' })
    const tx = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions[0]
    expect(tx.description).toBe('Updated')
    expect(tx.amount).toBe('200')
  })

  it('does not allow details to exceed the parent transaction total', () => {
    const txId = useKanbanStore.getState().addTransaction(listId, {
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

    useKanbanStore.getState().updateTransaction(listId, txId, { amount: '600' })
    useKanbanStore.getState().updateTransaction(listId, txId, {
      details: [{ id: 'over', description: 'Acima do total', amount: '1300' }]
    })

    const tx = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions[0]
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

  it('accumulated balance is computed correctly from income and expense', () => {
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Entrada',
      amount: '10000',
      type: 'income',
      date: '2026-01-01'
    })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Gasto',
      amount: '3000',
      type: 'expense',
      date: '2026-01-15'
    })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Outro gasto',
      amount: '2000',
      type: 'expense',
      date: '2026-02-01'
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce(
      (s, t) => (t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount)),
      0
    )
    expect(balance).toBe(5000)
  })
})

// ── Financial Goals CRUD ──────────────────────────────────────────────────────

describe('financial goal actions', () => {
  let listId: string

  beforeEach(() => {
    resetStore()
    listId = useKanbanStore.getState().createList('Pessoal', 'JPY')
  })

  it('addFinancialGoal creates a goal', () => {
    const goalId = useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel Agosto',
      targetAmount: '70000',
      targetMonth: 8,
      targetYear: 2026
    })
    const goal = useKanbanStore
      .getState()
      .lists.find((l) => l.id === listId)!
      .goals.find((g) => g.id === goalId)!
    expect(goal.name).toBe('Aluguel Agosto')
    expect(goal.targetAmount).toBe('70000')
    expect(goal.targetMonth).toBe(8)
    expect(goal.targetYear).toBe(2026)
  })

  it('updateFinancialGoal changes fields', () => {
    const goalId = useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Old',
      targetAmount: '1000',
      targetMonth: 1,
      targetYear: 2026
    })
    useKanbanStore
      .getState()
      .updateFinancialGoal(listId, goalId, { name: 'New', targetAmount: '5000' })
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    expect(goal.name).toBe('New')
    expect(goal.targetAmount).toBe('5000')
  })

  it('deleteFinancialGoal removes the goal', () => {
    const goalId = useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Temp',
      targetAmount: '1000',
      targetMonth: 6,
      targetYear: 2026
    })
    useKanbanStore.getState().deleteFinancialGoal(listId, goalId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals).toHaveLength(0)
  })

  it('goal progress: 0% when balance is 0', () => {
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel',
      targetAmount: '70000',
      targetMonth: 8,
      targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce(
      (s, t) => (t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount)),
      0
    )
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(0)
  })

  it('goal progress: partial when balance < target', () => {
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Renda',
      amount: '35000',
      type: 'income',
      date: '2026-04-01'
    })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel',
      targetAmount: '70000',
      targetMonth: 8,
      targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce(
      (s, t) => (t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount)),
      0
    )
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBeCloseTo(0.5)
  })

  it('goal progress: 100% when balance >= target', () => {
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Renda',
      amount: '80000',
      type: 'income',
      date: '2026-04-01'
    })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel',
      targetAmount: '70000',
      targetMonth: 8,
      targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce(
      (s, t) => (t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount)),
      0
    )
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(1)
  })

  it('goal progress uses accumulated balance (all months, not just current)', () => {
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Jan',
      amount: '30000',
      type: 'income',
      date: '2026-01-01'
    })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Feb',
      amount: '30000',
      type: 'income',
      date: '2026-02-01'
    })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Mar',
      amount: '30000',
      type: 'income',
      date: '2026-03-01'
    })
    useKanbanStore.getState().addTransaction(listId, {
      description: 'Gasto',
      amount: '10000',
      type: 'expense',
      date: '2026-03-15'
    })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel Agosto',
      targetAmount: '70000',
      targetMonth: 8,
      targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce(
      (s, t) => (t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount)),
      0
    )
    expect(balance).toBe(80000)
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(1)
  })
})
