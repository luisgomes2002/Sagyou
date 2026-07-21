import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({ projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] })
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
    activeProjectId: null,
    sprintFilter: null,
    activeTimer: null,
    isLoaded: false
  })
}

// ── FinancialTable CRUD ───────────────────────────────────────────────────────

describe('financial table creation', () => {
  beforeEach(resetStore)

  it('createList initializes transactions and goals as empty arrays', () => {
    const id = useKanbanStore.getState().createList('Pessoal', 'JPY')
    const list = useKanbanStore.getState().lists.find((l) => l.id === id)!
    expect(list.currency).toBe('JPY')
    expect(list.transactions).toEqual([])
    expect(list.goals).toEqual([])
  })

  it('deleteList removes the table entirely', () => {
    const id = useKanbanStore.getState().createList('Empresa 1')
    useKanbanStore.getState().deleteList(id)
    expect(useKanbanStore.getState().lists).toHaveLength(0)
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
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Rice', qty: 3, price: '1000' })
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

  it('marking done without price creates an expense transaction with amount 0', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Unknown item', qty: 1 })
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].amount).toBe('0')
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
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(1)
    useKanbanStore.getState().deleteItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items).toHaveLength(0)
    expect(list.transactions).toHaveLength(0)
  })

  it('deleting an undone item does not affect transactions', () => {
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Bread', qty: 1 })
    useKanbanStore.getState().deleteItem(listId, itemId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(0)
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
      description: 'Test', amount: '100', type: 'expense', date: '2026-04-01'
    })
    useKanbanStore.getState().deleteTransaction(listId, txId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions).toHaveLength(0)
  })

  it('updateTransaction modifies transaction fields', () => {
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Old', amount: '100', type: 'expense', date: '2026-04-01'
    })
    useKanbanStore.getState().updateTransaction(listId, txId, { description: 'Updated', amount: '200' })
    const tx = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions[0]
    expect(tx.description).toBe('Updated')
    expect(tx.amount).toBe('200')
  })

  it('accumulated balance is computed correctly from income and expense', () => {
    useKanbanStore.getState().addTransaction(listId, { description: 'Entrada', amount: '10000', type: 'income', date: '2026-01-01' })
    useKanbanStore.getState().addTransaction(listId, { description: 'Gasto', amount: '3000', type: 'expense', date: '2026-01-15' })
    useKanbanStore.getState().addTransaction(listId, { description: 'Outro gasto', amount: '2000', type: 'expense', date: '2026-02-01' })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce((s, t) => t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount), 0)
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
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals.find((g) => g.id === goalId)!
    expect(goal.name).toBe('Aluguel Agosto')
    expect(goal.targetAmount).toBe('70000')
    expect(goal.targetMonth).toBe(8)
    expect(goal.targetYear).toBe(2026)
  })

  it('updateFinancialGoal changes fields', () => {
    const goalId = useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Old', targetAmount: '1000', targetMonth: 1, targetYear: 2026
    })
    useKanbanStore.getState().updateFinancialGoal(listId, goalId, { name: 'New', targetAmount: '5000' })
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    expect(goal.name).toBe('New')
    expect(goal.targetAmount).toBe('5000')
  })

  it('deleteFinancialGoal removes the goal', () => {
    const goalId = useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Temp', targetAmount: '1000', targetMonth: 6, targetYear: 2026
    })
    useKanbanStore.getState().deleteFinancialGoal(listId, goalId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals).toHaveLength(0)
  })

  it('goal progress: 0% when balance is 0', () => {
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel', targetAmount: '70000', targetMonth: 8, targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce((s, t) => t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount), 0)
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(0)
  })

  it('goal progress: partial when balance < target', () => {
    useKanbanStore.getState().addTransaction(listId, { description: 'Renda', amount: '35000', type: 'income', date: '2026-04-01' })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel', targetAmount: '70000', targetMonth: 8, targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce((s, t) => t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount), 0)
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBeCloseTo(0.5)
  })

  it('goal progress: 100% when balance >= target', () => {
    useKanbanStore.getState().addTransaction(listId, { description: 'Renda', amount: '80000', type: 'income', date: '2026-04-01' })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel', targetAmount: '70000', targetMonth: 8, targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce((s, t) => t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount), 0)
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(1)
  })

  it('goal progress uses accumulated balance (all months, not just current)', () => {
    useKanbanStore.getState().addTransaction(listId, { description: 'Jan', amount: '30000', type: 'income', date: '2026-01-01' })
    useKanbanStore.getState().addTransaction(listId, { description: 'Feb', amount: '30000', type: 'income', date: '2026-02-01' })
    useKanbanStore.getState().addTransaction(listId, { description: 'Mar', amount: '30000', type: 'income', date: '2026-03-01' })
    useKanbanStore.getState().addTransaction(listId, { description: 'Gasto', amount: '10000', type: 'expense', date: '2026-03-15' })
    useKanbanStore.getState().addFinancialGoal(listId, {
      name: 'Aluguel Agosto', targetAmount: '70000', targetMonth: 8, targetYear: 2026
    })
    const txs = useKanbanStore.getState().lists.find((l) => l.id === listId)!.transactions
    const balance = txs.reduce((s, t) => t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount), 0)
    expect(balance).toBe(80000)
    const goal = useKanbanStore.getState().lists.find((l) => l.id === listId)!.goals[0]
    const progress = Math.min(balance / Number(goal.targetAmount), 1)
    expect(progress).toBe(1)
  })
})
