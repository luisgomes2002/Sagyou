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
      this.loadConversations = vi.fn().mockResolvedValue([])
      this.saveConversations = vi.fn().mockResolvedValue(undefined)
      this.loadMemories = vi.fn().mockResolvedValue([])
      this.replaceMemories = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { ElectronStorage } from '../../services/ElectronStorage'
import { DEFAULT_COLUMN_NAMES } from '../../types'

function getStorageMock() {
  return vi.mocked(ElectronStorage).mock.instances[0] as unknown as {
    importBackup: ReturnType<typeof vi.fn>
    exportBackup: ReturnType<typeof vi.fn>
    loadConversations: ReturnType<typeof vi.fn>
    saveConversations: ReturnType<typeof vi.fn>
    loadMemories: ReturnType<typeof vi.fn>
    replaceMemories: ReturnType<typeof vi.fn>
  }
}

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

  it('closeSprint clears sprintFilter when the closed sprint was selected', () => {
    const sprintId = useKanbanStore.getState().createSprint(projectId, 'Active')
    useKanbanStore.getState().setSprintFilter(sprintId)
    useKanbanStore.getState().closeSprint(sprintId)
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

  it('updateTask stops timer when task is moved to done column', () => {
    const doneColumnId = useKanbanStore.getState().projects[0].columns.find((c) => c.name.toLowerCase() === 'done')!.id
    useKanbanStore.getState().startTimer(taskId)
    useKanbanStore.getState().updateTask(taskId, { columnId: doneColumnId })
    expect(useKanbanStore.getState().activeTimer).toBeNull()
  })

  it('moveTask stops timer when task is dragged to done column', () => {
    const doneColumnId = useKanbanStore.getState().projects[0].columns.find((c) => c.name.toLowerCase() === 'done')!.id
    useKanbanStore.getState().startTimer(taskId)
    useKanbanStore.getState().moveTask(taskId, doneColumnId, 0)
    expect(useKanbanStore.getState().activeTimer).toBeNull()
  })

  it('updateTask does not stop timer when another task is marked done', () => {
    const taskId2 = useKanbanStore.getState().createTask({ projectId, columnId, title: 'Other task' })
    const doneColumnId = useKanbanStore.getState().projects[0].columns.find((c) => c.name.toLowerCase() === 'done')!.id
    useKanbanStore.getState().startTimer(taskId)
    useKanbanStore.getState().updateTask(taskId2, { columnId: doneColumnId })
    expect(useKanbanStore.getState().activeTimer?.taskId).toBe(taskId)
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
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Apple', qty: 3, price: '1.5' })
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const item = list.items.find((i) => i.id === itemId)!
    expect(item.name).toBe('Apple')
    expect(item.qty).toBe(3)
    expect(item.price).toBe('1.5')
    expect(item.done).toBe(false)
  })

  it('toggleItem marks done and creates a linked transaction', () => {
    const listId = useKanbanStore.getState().createList('Cart')
    const itemId = useKanbanStore.getState().addItem(listId, { name: 'Milk', qty: 2, price: '3.5' })
    useKanbanStore.getState().toggleItem(listId, itemId)
    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    expect(list.items[0].done).toBe(true)
    expect(list.items[0].linkedTransactionId).toBeDefined()
    expect(list.transactions).toHaveLength(1)
    expect(list.transactions[0].type).toBe('expense')
    expect(list.transactions[0].amount).toBe('7')
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
    useKanbanStore.getState().updateItem(listId, itemId, { qty: 5, price: '3.0' })
    const item = useKanbanStore.getState().lists.find((l) => l.id === listId)!.items[0]
    expect(item.qty).toBe(5)
    expect(item.price).toBe('3.0')
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

// ── AI chat history in backups ────────────────────────────────────────────────

describe('backups carry AI chat history', () => {
  beforeEach(resetStore)

  const conversation = {
    id: 'c1',
    title: 'Planejar sprint',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    messages: [
      { role: 'user' as const, content: 'oi' },
      // Display-only agent trace — must survive a round-trip like any other line.
      { role: 'status' as const, content: 'Lendo src/App.tsx' },
      { role: 'assistant' as const, content: 'olá' }
    ]
  }

  it('exportBackup includes the stored conversations and memories at version 4', async () => {
    const storage = getStorageMock()
    storage.loadConversations.mockResolvedValueOnce([conversation])
    const memory = { id: 'm1', projectId: null, type: 'fato', title: 't', body: 'b', tags: [], pinned: false, source: 'modelo', createdAt: 'x', updatedAt: 'x', lastAccessedAt: 'x', accessCount: 0, archivedAt: null }
    storage.loadMemories.mockResolvedValueOnce([memory])

    await useKanbanStore.getState().exportBackup()

    const backup = storage.exportBackup.mock.calls[0][0]
    expect(backup.version).toBe(4)
    expect(backup.conversations).toEqual([conversation])
    expect(backup.memories).toEqual([memory])
  })

  it('exportBackup still succeeds when memory cannot be read', async () => {
    const storage = getStorageMock()
    storage.loadMemories.mockRejectedValueOnce(new Error('db locked'))

    const result = await useKanbanStore.getState().exportBackup()

    expect(result).toBe(true)
    expect(storage.exportBackup.mock.calls.at(-1)![0].memories).toEqual([])
  })

  it('importBackup restores memories from a v4 backup', async () => {
    const storage = getStorageMock()
    const memory = { id: 'm1', projectId: null, type: 'fato', title: 't', body: 'b', tags: [], pinned: false, source: 'modelo', createdAt: 'x', updatedAt: 'x', lastAccessedAt: 'x', accessCount: 0, archivedAt: null }
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 4,
        exportedAt: new Date().toISOString(),
        projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [],
        memories: [memory]
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(storage.replaceMemories).toHaveBeenCalledWith([memory])
  })

  it('importBackup leaves local memory alone for a backup without the key', async () => {
    const storage = getStorageMock()
    storage.replaceMemories.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 3,
        exportedAt: new Date().toISOString(),
        projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [],
        conversations: []
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(storage.replaceMemories).not.toHaveBeenCalled()
  })

  it('exportBackup still succeeds when the history cannot be read', async () => {
    const storage = getStorageMock()
    storage.loadConversations.mockRejectedValueOnce(new Error('disk on fire'))

    const result = await useKanbanStore.getState().exportBackup()

    expect(result).toBe(true)
    expect(storage.exportBackup.mock.calls.at(-1)![0].conversations).toEqual([])
  })

  it('importBackup restores conversations from a v3 backup', async () => {
    const storage = getStorageMock()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 3,
        exportedAt: new Date().toISOString(),
        projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [],
        conversations: [conversation]
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(storage.saveConversations).toHaveBeenCalledWith([conversation])
  })

  it('importBackup leaves local history alone for a v2 backup', async () => {
    const storage = getStorageMock()
    storage.saveConversations.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 2,
        exportedAt: new Date().toISOString(),
        projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: []
      }
    })

    const result = await useKanbanStore.getState().importBackup()

    expect(result).toBe(true)
    expect(storage.saveConversations).not.toHaveBeenCalled()
  })
})

// ── importBackup ──────────────────────────────────────────────────────────────

describe('importBackup', () => {
  beforeEach(resetStore)

  it('returns false and leaves state unchanged when cancelled', async () => {
    const pid = useKanbanStore.getState().createProject('Local project')
    getStorageMock().importBackup.mockResolvedValueOnce({ success: false, cancelled: true })

    const result = await useKanbanStore.getState().importBackup()

    expect(result).toBe(false)
    expect(useKanbanStore.getState().projects).toHaveLength(1)
    expect(useKanbanStore.getState().projects[0].id).toBe(pid)
  })

  it('replaces all local state with backup data', async () => {
    useKanbanStore.getState().createProject('Local project')
    useKanbanStore.getState().createHabit({ name: 'Local habit', color: '#fff' })

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [{ id: 'bp1', name: 'Backup project', color: '#ff0000', columns: [], order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      tasks: [{ id: 'bt1', projectId: 'bp1', columnId: 'c1', title: 'Backup task', order: 0, priority: 'medium', tags: [], images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [{ id: 'bh1', name: 'Backup habit', color: '#0f0', completions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    const result = await useKanbanStore.getState().importBackup()

    expect(result).toBe(true)
    const state = useKanbanStore.getState()
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].id).toBe('bp1')
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0].id).toBe('bt1')
    expect(state.habits).toHaveLength(1)
    expect(state.habits[0].id).toBe('bh1')
  })

  it('sets activeProjectId to the first backup project', async () => {
    useKanbanStore.getState().createProject('Local')

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [
        { id: 'first', name: 'First', color: '#fff', columns: [], order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'second', name: 'Second', color: '#000', columns: [], order: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeProjectId).toBe('first')
  })

  it('sets activeProjectId to null when backup has no projects', async () => {
    useKanbanStore.getState().createProject('Local')

    const backup = { version: 2, exportedAt: new Date().toISOString(), projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeProjectId).toBeNull()
  })

  it('clears any running timer on restore', async () => {
    const pid = useKanbanStore.getState().createProject('P')
    const col = useKanbanStore.getState().projects[0].columns[0]
    const tid = useKanbanStore.getState().createTask({ projectId: pid, columnId: col.id, title: 'T' })
    useKanbanStore.getState().startTimer(tid)
    expect(useKanbanStore.getState().activeTimer).not.toBeNull()

    const backup = { version: 2, exportedAt: new Date().toISOString(), projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeTimer).toBeNull()
  })

  it('applies defaults for missing optional fields in backup lists', async () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: [{ id: 'l1', name: 'Old list', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    const list = useKanbanStore.getState().lists[0]
    expect(list.transactions).toEqual([])
    expect(list.goals).toEqual([])
    expect(list.currency).toBe('BRL')
  })

  it('assigns order to backup projects that are missing it', async () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [
        { id: 'p1', name: 'A', color: '#fff', columns: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'p2', name: 'B', color: '#000', columns: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    const projects = useKanbanStore.getState().projects
    expect(projects[0].order).toBe(0)
    expect(projects[1].order).toBe(1)
  })
})

// ── Code paths ─────────────────────────────────────────────────────────────────

describe('code path actions', () => {
  let pid: string

  beforeEach(() => {
    resetStore()
    pid = useKanbanStore.getState().createProject('P')
  })

  const project = () => useKanbanStore.getState().projects.find((p) => p.id === pid)!

  it('addCodePath adds a path and selects the first one as active', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/proj', 'main')
    expect(project().codePaths).toHaveLength(1)
    expect(project().codePaths![0]).toMatchObject({ id: id1, path: 'C:/proj', label: 'main' })
    expect(project().activeCodePathId).toBe(id1)

    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/other')
    // Second path does not steal the active selection.
    expect(project().activeCodePathId).toBe(id1)
    expect(project().codePaths!.map((c) => c.id)).toEqual([id1, id2])
  })

  it('setActiveCodePath changes the persisted selection', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    useKanbanStore.getState().setActiveCodePath(pid, id2)
    expect(project().activeCodePathId).toBe(id2)
    useKanbanStore.getState().setActiveCodePath(pid, null)
    expect(project().activeCodePathId).toBeUndefined()
    // sanity: ids are distinct
    expect(id1).not.toBe(id2)
  })

  it('removeCodePath deselects the removed path without promoting another', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    useKanbanStore.getState().removeCodePath(pid, id1) // id1 was selected
    expect(project().codePaths!.map((c) => c.id)).toEqual([id2])
    // id2 must NOT be auto-selected: the user never picked it, and selecting it
    // would silently give the AI a folder to read.
    expect(project().activeCodePathIds).toEqual([])
    expect(project().activeCodePathId).toBeUndefined()

    useKanbanStore.getState().removeCodePath(pid, id2)
    expect(project().codePaths).toHaveLength(0)
    expect(project().activeCodePathId).toBeUndefined()
  })

  it('deleting an unselected path leaves an empty selection empty', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    useKanbanStore.getState().toggleCodePath(pid, id1) // user turns code access off
    expect(project().activeCodePathIds).toEqual([])
    useKanbanStore.getState().removeCodePath(pid, id2) // delete an unrelated path
    expect(project().activeCodePathIds).toEqual([])
  })

  it('toggleCodePath selects several paths at once', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    const id3 = useKanbanStore.getState().addCodePath(pid, 'C:/c')
    expect(project().activeCodePathIds).toEqual([id1])

    useKanbanStore.getState().toggleCodePath(pid, id3)
    expect(project().activeCodePathIds).toEqual([id1, id3])

    useKanbanStore.getState().toggleCodePath(pid, id1)
    expect(project().activeCodePathIds).toEqual([id3])
    expect(id2).not.toBe(id3)
  })

  it('toggleCodePath can clear the selection entirely', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    useKanbanStore.getState().toggleCodePath(pid, id1)
    expect(project().activeCodePathIds).toEqual([])
    expect(project().activeCodePathId).toBeUndefined()
  })

  it('keeps the legacy activeCodePathId in sync with the first selection', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    useKanbanStore.getState().toggleCodePath(pid, id2)
    // Old app versions read the singular field; it must point at a real path.
    expect(project().activeCodePathIds).toEqual([id1, id2])
    expect(project().activeCodePathId).toBe(id1)

    // Removing the first selection promotes the next one already selected.
    useKanbanStore.getState().removeCodePath(pid, id1)
    expect(project().activeCodePathIds).toEqual([id2])
    expect(project().activeCodePathId).toBe(id2)
  })

  it('exportBackup carries the multi selection and the legacy mirror', async () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a', 'a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b', 'b')
    useKanbanStore.getState().toggleCodePath(pid, id2)

    await useKanbanStore.getState().exportBackup()

    const storage = vi.mocked(ElectronStorage).mock.instances[0] as unknown as {
      exportBackup: ReturnType<typeof vi.fn>
    }
    const backup = storage.exportBackup.mock.calls.at(-1)![0]
    const p = backup.projects.find((x: { id: string }) => x.id === pid)!
    expect(p.activeCodePathIds).toEqual([id1, id2])
    // Older versions restoring this backup read the singular field.
    expect(p.activeCodePathId).toBe(id1)
  })

  it('importBackup migrates a legacy single activeCodePathId', async () => {
    const storage = vi.mocked(ElectronStorage).mock.instances[0] as unknown as {
      importBackup: ReturnType<typeof vi.fn>
    }
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 3,
        exportedAt: '2024-01-01T00:00:00.000Z',
        projects: [{
          id: 'p-old', name: 'Antigo', color: '#fff', columns: [],
          codePaths: [{ id: 'cp1', path: 'C:/a' }, { id: 'cp2', path: 'C:/b' }],
          activeCodePathId: 'cp2', // backup written before multi-select existed
          createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z'
        }],
        tasks: []
      }
    })

    await useKanbanStore.getState().importBackup()

    const p = useKanbanStore.getState().projects.find((x) => x.id === 'p-old')!
    expect(p.activeCodePathIds).toEqual(['cp2'])
  })

  it('loadData migrates a legacy single activeCodePathId to the array form', async () => {
    const legacy = {
      id: 'p-legacy',
      name: 'Legado',
      color: '#fff',
      columns: [],
      codePaths: [{ id: 'cp1', path: 'C:/a' }, { id: 'cp2', path: 'C:/b' }],
      activeCodePathId: 'cp2', // written by a pre-multi-select version
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
    const storage = vi.mocked(ElectronStorage).mock.instances[0] as unknown as {
      load: ReturnType<typeof vi.fn>
    }
    storage.load.mockResolvedValueOnce({
      projects: [legacy], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: []
    })
    await useKanbanStore.getState().loadData()
    const p = useKanbanStore.getState().projects.find((x) => x.id === 'p-legacy')!
    expect(p.activeCodePathIds).toEqual(['cp2'])
  })

  it('loadData drops selected ids whose code path no longer exists', async () => {
    const stale = {
      id: 'p-stale',
      name: 'Stale',
      color: '#fff',
      columns: [],
      codePaths: [{ id: 'cp1', path: 'C:/a' }],
      activeCodePathIds: ['cp1', 'ghost'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
    const storage = vi.mocked(ElectronStorage).mock.instances[0] as unknown as {
      load: ReturnType<typeof vi.fn>
    }
    storage.load.mockResolvedValueOnce({
      projects: [stale], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: []
    })
    await useKanbanStore.getState().loadData()
    const p = useKanbanStore.getState().projects.find((x) => x.id === 'p-stale')!
    expect(p.activeCodePathIds).toEqual(['cp1'])
  })

  it('removeCodePath only drops the removed path from a multi selection', () => {
    const id1 = useKanbanStore.getState().addCodePath(pid, 'C:/a')
    const id2 = useKanbanStore.getState().addCodePath(pid, 'C:/b')
    useKanbanStore.getState().toggleCodePath(pid, id2)
    useKanbanStore.getState().removeCodePath(pid, id2)
    expect(project().activeCodePathIds).toEqual([id1])
  })
})
