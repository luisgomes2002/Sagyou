import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock ElectronStorage before importing the store
vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({ projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] })
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { DEFAULT_COLUMN_NAMES } from '../../types'

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

// ── Projects ──────────────────────────────────────────────────────────────────

describe('project actions', () => {
  beforeEach(resetStore)

  it('createProject adds a project with default columns and sets it active', () => {
    const id = useKanbanStore.getState().createProject('My App', 'desc', '#ff0000')
    const { projects, activeProjectId } = useKanbanStore.getState()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(id)
    expect(projects[0].name).toBe('My App')
    expect(projects[0].color).toBe('#ff0000')
    expect(projects[0].columns.map((c) => c.name)).toEqual(DEFAULT_COLUMN_NAMES)
    expect(activeProjectId).toBe(id)
  })

  it('createProject uses default color when none is provided', () => {
    useKanbanStore.getState().createProject('No Color')
    expect(useKanbanStore.getState().projects[0].color).toBe('#6366f1')
  })

  it('updateProject changes name and color', () => {
    const id = useKanbanStore.getState().createProject('Old Name')
    useKanbanStore.getState().updateProject(id, { name: 'New Name', color: '#aabbcc' })
    const p = useKanbanStore.getState().projects.find((p) => p.id === id)!
    expect(p.name).toBe('New Name')
    expect(p.color).toBe('#aabbcc')
  })

  it('deleteProject removes project, its tasks, and adds tombstones', () => {
    const pid = useKanbanStore.getState().createProject('Delete Me')
    const col = useKanbanStore.getState().projects[0].columns[0]
    useKanbanStore.getState().createTask({ projectId: pid, columnId: col.id, title: 'Task 1' })
    useKanbanStore.getState().deleteProject(pid)
    const { projects, tasks, tombstones } = useKanbanStore.getState()
    expect(projects).toHaveLength(0)
    expect(tasks).toHaveLength(0)
    expect(tombstones.some((t) => t.id === pid && t.type === 'project')).toBe(true)
  })

  it('deleteProject switches activeProject to another project', () => {
    const id1 = useKanbanStore.getState().createProject('First')
    const id2 = useKanbanStore.getState().createProject('Second')
    useKanbanStore.getState().setActiveProject(id1)
    useKanbanStore.getState().deleteProject(id1)
    expect(useKanbanStore.getState().activeProjectId).toBe(id2)
  })
})

// ── Columns ───────────────────────────────────────────────────────────────────

describe('column actions', () => {
  let projectId: string

  beforeEach(() => {
    resetStore()
    projectId = useKanbanStore.getState().createProject('Test')
  })

  it('createColumn adds a column to the project', () => {
    useKanbanStore.getState().createColumn(projectId, 'QA', '#00ff00')
    const project = useKanbanStore.getState().projects.find((p) => p.id === projectId)!
    const col = project.columns.find((c) => c.name === 'QA')!
    expect(col).toBeDefined()
    expect(col.color).toBe('#00ff00')
  })

  it('updateColumn renames a column', () => {
    const project = useKanbanStore.getState().projects.find((p) => p.id === projectId)!
    const colId = project.columns[0].id
    useKanbanStore.getState().updateColumn(projectId, colId, { name: 'Renamed' })
    const updated = useKanbanStore.getState().projects.find((p) => p.id === projectId)!.columns[0]
    expect(updated.name).toBe('Renamed')
  })

  it('deleteColumn removes the column and its tasks', () => {
    const project = useKanbanStore.getState().projects.find((p) => p.id === projectId)!
    const colId = project.columns[0].id
    useKanbanStore.getState().createTask({ projectId, columnId: colId, title: 'Orphan task' })
    useKanbanStore.getState().deleteColumn(projectId, colId)
    const cols = useKanbanStore.getState().projects.find((p) => p.id === projectId)!.columns
    expect(cols.some((c) => c.id === colId)).toBe(false)
    expect(useKanbanStore.getState().tasks).toHaveLength(0)
  })

  it('reorderColumns updates order values', () => {
    const project = useKanbanStore.getState().projects.find((p) => p.id === projectId)!
    const ids = project.columns.map((c) => c.id)
    const reversed = [...ids].reverse()
    useKanbanStore.getState().reorderColumns(projectId, reversed)
    const cols = useKanbanStore.getState().projects.find((p) => p.id === projectId)!.columns
    expect(cols[0].id).toBe(reversed[0])
    expect(cols[0].order).toBe(0)
  })
})

// ── Tasks ─────────────────────────────────────────────────────────────────────

describe('task actions', () => {
  let projectId: string
  let columnId: string

  beforeEach(() => {
    resetStore()
    projectId = useKanbanStore.getState().createProject('Test')
    columnId = useKanbanStore.getState().projects[0].columns[0].id
  })

  it('createTask adds a task with defaults', () => {
    const id = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Fix bug' })
    const task = useKanbanStore.getState().tasks.find((t) => t.id === id)!
    expect(task.title).toBe('Fix bug')
    expect(task.priority).toBe('medium')
    expect(task.tags).toEqual([])
    expect(task.images).toEqual([])
  })

  it('createTask assigns sequential order within the column', () => {
    useKanbanStore.getState().createTask({ projectId, columnId, title: 'First' })
    useKanbanStore.getState().createTask({ projectId, columnId, title: 'Second' })
    const tasks = useKanbanStore.getState().tasks.sort((a, b) => a.order - b.order)
    expect(tasks[0].title).toBe('First')
    expect(tasks[0].order).toBe(0)
    expect(tasks[1].order).toBe(1)
  })

  it('updateTask updates fields and bumps updatedAt', () => {
    const id = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Original' })
    const before = useKanbanStore.getState().tasks.find((t) => t.id === id)!.updatedAt
    useKanbanStore.getState().updateTask(id, { title: 'Updated', priority: 'high' })
    const task = useKanbanStore.getState().tasks.find((t) => t.id === id)!
    expect(task.title).toBe('Updated')
    expect(task.priority).toBe('high')
    expect(task.updatedAt >= before).toBe(true)
  })

  it('deleteTask removes task and creates tombstone', () => {
    const id = useKanbanStore.getState().createTask({ projectId, columnId, title: 'To delete' })
    useKanbanStore.getState().deleteTask(id)
    expect(useKanbanStore.getState().tasks).toHaveLength(0)
    expect(useKanbanStore.getState().tombstones.some((t) => t.id === id && t.type === 'task')).toBe(true)
  })

  it('moveTask moves a task to a new column and reorders', () => {
    const col2Id = useKanbanStore.getState().projects[0].columns[1].id
    const id = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Movable' })
    useKanbanStore.getState().moveTask(id, col2Id, 0)
    const task = useKanbanStore.getState().tasks.find((t) => t.id === id)!
    expect(task.columnId).toBe(col2Id)
    expect(task.order).toBe(0)
  })

  it('moveTask is a no-op for unknown task id', () => {
    const before = useKanbanStore.getState().tasks
    useKanbanStore.getState().moveTask('non-existent', columnId, 0)
    expect(useKanbanStore.getState().tasks).toEqual(before)
  })
})

// ── Sprints ───────────────────────────────────────────────────────────────────

describe('sprint actions', () => {
  let projectId: string
  let columnId: string

  beforeEach(() => {
    resetStore()
    projectId = useKanbanStore.getState().createProject('Test')
    columnId = useKanbanStore.getState().projects[0].columns[0].id
  })

  it('createSprint adds a sprint', () => {
    const id = useKanbanStore.getState().createSprint(projectId, 'Sprint 1')
    const sprint = useKanbanStore.getState().sprints.find((s) => s.id === id)!
    expect(sprint.name).toBe('Sprint 1')
    expect(sprint.projectId).toBe(projectId)
    expect(sprint.closedAt).toBeUndefined()
  })

  it('createSprints adds multiple sprints from a list', () => {
    useKanbanStore.getState().createSprints(projectId, ['S1', 'S2', '  S3  ', ''])
    expect(useKanbanStore.getState().sprints).toHaveLength(3)
  })

  it('closeSprint sets closedAt', () => {
    const id = useKanbanStore.getState().createSprint(projectId, 'Sprint X')
    useKanbanStore.getState().closeSprint(id)
    expect(useKanbanStore.getState().sprints.find((s) => s.id === id)!.closedAt).toBeDefined()
  })

  it('deleteSprint removes sprint, unlinks tasks, and adds tombstone', () => {
    const sprintId = useKanbanStore.getState().createSprint(projectId, 'Bye Sprint')
    const taskId = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Linked' })
    useKanbanStore.getState().setTaskSprint(taskId, sprintId)
    useKanbanStore.getState().deleteSprint(sprintId)
    expect(useKanbanStore.getState().sprints).toHaveLength(0)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === taskId)!.sprintId).toBeUndefined()
    expect(useKanbanStore.getState().tombstones.some((t) => t.id === sprintId && t.type === 'sprint')).toBe(true)
  })

  it('deleteSprint clears sprintFilter when the deleted sprint was active', () => {
    const sprintId = useKanbanStore.getState().createSprint(projectId, 'Active')
    useKanbanStore.getState().setSprintFilter(sprintId)
    useKanbanStore.getState().deleteSprint(sprintId)
    expect(useKanbanStore.getState().sprintFilter).toBeNull()
  })
})

// ── Timer ─────────────────────────────────────────────────────────────────────

describe('timer actions', () => {
  let projectId: string
  let columnId: string
  let taskId: string

  beforeEach(() => {
    resetStore()
    projectId = useKanbanStore.getState().createProject('Test')
    columnId = useKanbanStore.getState().projects[0].columns[0].id
    taskId = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Timed task' })
  })

  it('addTimeSpent adds seconds to timeSpent', () => {
    useKanbanStore.getState().addTimeSpent(taskId, 120)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === taskId)!.timeSpent).toBe(120)
    useKanbanStore.getState().addTimeSpent(taskId, 30)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === taskId)!.timeSpent).toBe(150)
  })

  it('addTimeSpent ignores non-positive values', () => {
    useKanbanStore.getState().addTimeSpent(taskId, 0)
    useKanbanStore.getState().addTimeSpent(taskId, -5)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === taskId)!.timeSpent).toBeUndefined()
  })

  it('startTimer sets activeTimer', () => {
    useKanbanStore.getState().startTimer(taskId)
    expect(useKanbanStore.getState().activeTimer?.taskId).toBe(taskId)
  })

  it('stopTimer clears activeTimer and records time', () => {
    useKanbanStore.getState().startTimer(taskId)
    useKanbanStore.getState().stopTimer()
    expect(useKanbanStore.getState().activeTimer).toBeNull()
  })

  it('startTimer saves elapsed time from previous timer before switching', () => {
    const taskId2 = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Task 2' })
    useKanbanStore.setState({ activeTimer: { taskId, startedAt: Date.now() - 5000 } })
    useKanbanStore.getState().startTimer(taskId2)
    const spent = useKanbanStore.getState().tasks.find((t) => t.id === taskId)!.timeSpent ?? 0
    expect(spent).toBeGreaterThanOrEqual(4)
    expect(useKanbanStore.getState().activeTimer?.taskId).toBe(taskId2)
  })
})

// ── Notes ─────────────────────────────────────────────────────────────────────

describe('note actions', () => {
  let projectId: string

  beforeEach(() => {
    resetStore()
    projectId = useKanbanStore.getState().createProject('Test')
  })

  it('createNote adds a note with defaults', () => {
    const id = useKanbanStore.getState().createNote(projectId)
    const note = useKanbanStore.getState().notes.find((n) => n.id === id)!
    expect(note.projectId).toBe(projectId)
    expect(note.content).toBe('')
    expect(note.color).toBe('#fef08a')
    expect(note.connections).toEqual([])
  })

  it('createNote accepts custom data', () => {
    const id = useKanbanStore.getState().createNote(projectId, { content: 'Hello', color: '#ff0000', x: 50, y: 60 })
    const note = useKanbanStore.getState().notes.find((n) => n.id === id)!
    expect(note.content).toBe('Hello')
    expect(note.x).toBe(50)
  })

  it('updateNote updates fields', () => {
    const id = useKanbanStore.getState().createNote(projectId)
    useKanbanStore.getState().updateNote(id, { content: 'Updated content' })
    expect(useKanbanStore.getState().notes.find((n) => n.id === id)!.content).toBe('Updated content')
  })

  it('deleteNote removes the note and cleans up connections', () => {
    const id1 = useKanbanStore.getState().createNote(projectId)
    const id2 = useKanbanStore.getState().createNote(projectId)
    useKanbanStore.getState().connectNotes(id1, id2)
    useKanbanStore.getState().deleteNote(id2)
    expect(useKanbanStore.getState().notes).toHaveLength(1)
    expect(useKanbanStore.getState().notes[0].connections).not.toContain(id2)
  })

  it('connectNotes adds connection and is idempotent', () => {
    const id1 = useKanbanStore.getState().createNote(projectId)
    const id2 = useKanbanStore.getState().createNote(projectId)
    useKanbanStore.getState().connectNotes(id1, id2)
    useKanbanStore.getState().connectNotes(id1, id2)
    const conns = useKanbanStore.getState().notes.find((n) => n.id === id1)!.connections!
    expect(conns).toHaveLength(1)
  })

  it('connectNotes does nothing when fromId === toId', () => {
    const id = useKanbanStore.getState().createNote(projectId)
    useKanbanStore.getState().connectNotes(id, id)
    expect(useKanbanStore.getState().notes.find((n) => n.id === id)!.connections).toHaveLength(0)
  })

  it('disconnectNotes removes an existing connection', () => {
    const id1 = useKanbanStore.getState().createNote(projectId)
    const id2 = useKanbanStore.getState().createNote(projectId)
    useKanbanStore.getState().connectNotes(id1, id2)
    useKanbanStore.getState().disconnectNotes(id1, id2)
    expect(useKanbanStore.getState().notes.find((n) => n.id === id1)!.connections).toHaveLength(0)
  })
})

// ── Goals ─────────────────────────────────────────────────────────────────────

describe('goal actions', () => {
  beforeEach(resetStore)

  it('createGoal adds a goal with empty entries', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'Run 100km', target: 100, unit: 'km', color: '#22c55e' })
    const goal = useKanbanStore.getState().goals.find((g) => g.id === id)!
    expect(goal.entries).toEqual([])
    expect(goal.target).toBe(100)
  })

  it('addGoalEntry adds an entry and accumulates current', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'Books', target: 10, unit: 'livros', color: '#fff' })
    useKanbanStore.getState().addGoalEntry(id, { date: '2026-06-01', label: 'Dom Casmurro', value: 1 })
    useKanbanStore.getState().addGoalEntry(id, { date: '2026-06-05', value: 2.5 })
    const goal = useKanbanStore.getState().goals.find((g) => g.id === id)!
    expect(goal.entries).toHaveLength(2)
    const total = goal.entries.reduce((s, e) => s + e.value, 0)
    expect(total).toBeCloseTo(3.5)
    expect(goal.entries[0].label).toBe('Dom Casmurro')
    expect(goal.entries[1].label).toBeUndefined()
  })

  it('addGoalEntry accepts floating-point values', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'Corrida', target: 10, unit: 'km', color: '#fff' })
    useKanbanStore.getState().addGoalEntry(id, { date: '2026-06-14', value: 2.3 })
    useKanbanStore.getState().addGoalEntry(id, { date: '2026-06-15', value: 3.7 })
    const goal = useKanbanStore.getState().goals.find((g) => g.id === id)!
    const total = goal.entries.reduce((s, e) => s + e.value, 0)
    expect(total).toBeCloseTo(6)
  })

  it('deleteGoalEntry removes an entry', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'G', target: 10, unit: 'x', color: '#fff' })
    useKanbanStore.getState().addGoalEntry(id, { date: '2026-06-01', value: 3 })
    const entryId = useKanbanStore.getState().goals.find((g) => g.id === id)!.entries[0].id
    useKanbanStore.getState().deleteGoalEntry(id, entryId)
    expect(useKanbanStore.getState().goals.find((g) => g.id === id)!.entries).toHaveLength(0)
  })

  it('updateGoal changes metadata fields', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'Old', target: 5, unit: 'x', color: '#fff' })
    useKanbanStore.getState().updateGoal(id, { title: 'New', target: 20 })
    const g = useKanbanStore.getState().goals.find((g) => g.id === id)!
    expect(g.title).toBe('New')
    expect(g.target).toBe(20)
  })

  it('deleteGoal removes the goal', () => {
    const id = useKanbanStore.getState().createGoal({ title: 'Delete', target: 1, unit: 'x', color: '#fff' })
    useKanbanStore.getState().deleteGoal(id)
    expect(useKanbanStore.getState().goals).toHaveLength(0)
  })
})

// ── Habits ────────────────────────────────────────────────────────────────────

describe('habit actions', () => {
  beforeEach(resetStore)

  it('createHabit adds a habit with no completions', () => {
    const id = useKanbanStore.getState().createHabit({ name: 'Meditate', color: '#8b5cf6' })
    const habit = useKanbanStore.getState().habits.find((h) => h.id === id)!
    expect(habit.name).toBe('Meditate')
    expect(habit.completions).toEqual([])
  })

  it('toggleHabit adds date when not present', () => {
    const id = useKanbanStore.getState().createHabit({ name: 'Exercise', color: '#22c55e' })
    useKanbanStore.getState().toggleHabit(id, '2026-01-01')
    expect(useKanbanStore.getState().habits.find((h) => h.id === id)!.completions).toContain('2026-01-01')
  })

  it('toggleHabit removes date when already present (untoggle)', () => {
    const id = useKanbanStore.getState().createHabit({ name: 'Exercise', color: '#22c55e' })
    useKanbanStore.getState().toggleHabit(id, '2026-01-01')
    useKanbanStore.getState().toggleHabit(id, '2026-01-01')
    expect(useKanbanStore.getState().habits.find((h) => h.id === id)!.completions).not.toContain('2026-01-01')
  })

  it('deleteHabit removes the habit', () => {
    const id = useKanbanStore.getState().createHabit({ name: 'Read', color: '#06b6d4' })
    useKanbanStore.getState().deleteHabit(id)
    expect(useKanbanStore.getState().habits).toHaveLength(0)
  })
})

// ── Shopping lists ────────────────────────────────────────────────────────────

describe('shopping list actions', () => {
  beforeEach(resetStore)

  it('createList adds a list with default BRL currency and empty financial fields', () => {
    const id = useKanbanStore.getState().createList('Supermercado')
    const list = useKanbanStore.getState().lists.find((l) => l.id === id)!
    expect(list.name).toBe('Supermercado')
    expect(list.currency).toBe('BRL')
    expect(list.items).toEqual([])
    expect(list.transactions).toEqual([])
    expect(list.goals).toEqual([])
  })

  it('createList respects provided currency', () => {
    const id = useKanbanStore.getState().createList('Amazon', 'USD')
    expect(useKanbanStore.getState().lists.find((l) => l.id === id)!.currency).toBe('USD')
  })

  it('updateList renames the list', () => {
    const id = useKanbanStore.getState().createList('Old')
    useKanbanStore.getState().updateList(id, 'New')
    expect(useKanbanStore.getState().lists.find((l) => l.id === id)!.name).toBe('New')
  })

  it('setListCurrency changes currency', () => {
    const id = useKanbanStore.getState().createList('My List')
    useKanbanStore.getState().setListCurrency(id, 'JPY')
    expect(useKanbanStore.getState().lists.find((l) => l.id === id)!.currency).toBe('JPY')
  })

  it('addItem adds item with done:false', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Apple', qty: 3, price: 1.5 })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const item = list.items.find((i) => i.id === itemId)!
    expect(item.name).toBe('Apple')
    expect(item.qty).toBe(3)
    expect(item.price).toBe(1.5)
    expect(item.done).toBe(false)
  })

  it('toggleItem marks done and creates a linked transaction', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Milk', qty: 2, price: 3.5 })
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items[0].done).toBe(true)
    expect(list.items[0].linkedTransactionId).toBeDefined()
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].type).toBe('expense')
    expect(list.transactions[0].amount).toBeCloseTo(7)
    expect(list.transactions[0].fromShopping).toBe(true)
  })

  it('toggleItem unmarks done and removes the linked transaction', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Milk', qty: 1 })
    useKanbanStore.getState().toggleItem(listId, itemId)
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items[0].done).toBe(false)
    expect(list.items[0].linkedTransactionId).toBeUndefined()
    expect(list.transactions).toHaveLength(0)
  })

  it('updateItem changes fields', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Bread', qty: 1 })
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 5, price: 3.0 })
    const item = useKanbanStore.getState().lists.find((l) => l.id === listId)!.items[0]
    expect(item.qty).toBe(5)
    expect(item.price).toBe(3.0)
  })

  it('deleteItem removes the item', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Egg', qty: 12 })
    useKanbanStore.getState().deleteItem(listId, itemId)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.items).toHaveLength(0)
  })

  it('deleteList removes the list', () => {
    const id = useKanbanStore.getState().createList('To remove')
    useKanbanStore.getState().deleteList(id)
    expect(useKanbanStore.getState().lists).toHaveLength(0)
  })
})
