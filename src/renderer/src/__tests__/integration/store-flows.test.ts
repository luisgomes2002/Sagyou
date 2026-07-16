/**
 * Integration tests — exercise multi-step flows that cross several store actions
 * and verify the system stays consistent end-to-end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue({ projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] })
    this.save = vi.fn().mockResolvedValue(undefined)
    this.exportBackup = vi.fn().mockResolvedValue({ success: true })
    this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    this.loadConversations = vi.fn().mockResolvedValue([])
    this.saveConversations = vi.fn().mockResolvedValue(undefined)
  })
}))

import { useKanbanStore } from '../../store/kanban'
import type { Backup, Habit, Project } from '../../types'

function reset() {
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

// ── Full kanban board flow ────────────────────────────────────────────────────

describe('full kanban board workflow', () => {
  beforeEach(reset)

  it('creates project → adds tasks → moves tasks through columns → verifies order', () => {
    const { createProject, createTask, moveTask } = useKanbanStore.getState()

    const pid = createProject('Board Flow Test')
    const cols = useKanbanStore.getState().projects[0].columns
    const [backlog, inProgress, review, done] = cols.map((c) => c.id)

    const t1 = createTask({ projectId: pid, columnId: backlog, title: 'Task A' })
    const t2 = createTask({ projectId: pid, columnId: backlog, title: 'Task B' })
    const t3 = createTask({ projectId: pid, columnId: backlog, title: 'Task C' })

    // Move A to In Progress
    moveTask(t1, inProgress, 0)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === t1)!.columnId).toBe(inProgress)

    // Move A from In Progress to Review
    moveTask(t1, review, 0)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === t1)!.columnId).toBe(review)

    // Move A to Done
    moveTask(t1, done, 0)
    expect(useKanbanStore.getState().tasks.find((t) => t.id === t1)!.columnId).toBe(done)

    // Remaining tasks still in Backlog
    const backlogTasks = useKanbanStore.getState().tasks.filter((t) => t.columnId === backlog)
    expect(backlogTasks).toHaveLength(2)
    expect(backlogTasks.map((t) => t.id).sort()).toEqual([t2, t3].sort())
  })

  it('insert task at specific position reorders siblings correctly', () => {
    const pid = useKanbanStore.getState().createProject('Order Test')
    const colId = useKanbanStore.getState().projects[0].columns[0].id

    const t1 = useKanbanStore.getState().createTask({ projectId: pid, columnId: colId, title: 'First' })
    const t2 = useKanbanStore.getState().createTask({ projectId: pid, columnId: colId, title: 'Third' })
    const t3 = useKanbanStore.getState().createTask({ projectId: pid, columnId: colId, title: 'Middle' })

    // Insert t3 between t1 and t2 (position 1)
    useKanbanStore.getState().moveTask(t3, colId, 1)

    const tasks = useKanbanStore.getState().tasks
      .filter((t) => t.columnId === colId)
      .sort((a, b) => a.order - b.order)

    expect(tasks[0].id).toBe(t1)
    expect(tasks[1].id).toBe(t3)
    expect(tasks[2].id).toBe(t2)
  })
})

// ── Sprint lifecycle ──────────────────────────────────────────────────────────

describe('sprint lifecycle integration', () => {
  beforeEach(reset)

  it('links tasks to sprint → closes sprint → sprint tasks retain sprintId', () => {
    const pid = useKanbanStore.getState().createProject('Sprint Project')
    const colId = useKanbanStore.getState().projects[0].columns[0].id
    const sprintId = useKanbanStore.getState().createSprint(pid, 'Sprint 1')

    const t1 = useKanbanStore.getState().createTask({ projectId: pid, columnId: colId, title: 'Sprint task', sprintId })
    useKanbanStore.getState().closeSprint(sprintId)

    const sprint = useKanbanStore.getState().sprints.find((s) => s.id === sprintId)!
    expect(sprint.closedAt).toBeDefined()
    // Task still linked after close
    expect(useKanbanStore.getState().tasks.find((t) => t.id === t1)!.sprintId).toBe(sprintId)
  })

  it('bulk sprint creation creates exact count (ignoring blanks)', () => {
    const pid = useKanbanStore.getState().createProject('Bulk')
    useKanbanStore.getState().createSprints(pid, ['S1', '', '  ', 'S2', 'S3'])
    expect(useKanbanStore.getState().sprints).toHaveLength(3)
  })
})

// ── Backup merge (importBackup) ───────────────────────────────────────────────

describe('importBackup merge logic', () => {
  beforeEach(reset)

  it('merges remote projects that are not present locally', async () => {
    const remoteProject: Project = {
      id: 'remote-p1',
      name: 'Remote Project',
      color: '#ff0000',
      columns: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const backup: Backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [remoteProject],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: []
    }

    // Patch the mocked importBackup to return this backup
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importBackup.mockResolvedValueOnce({ success: true, data: backup })

    const ok = await useKanbanStore.getState().importBackup()
    expect(ok).toBe(true)
    expect(useKanbanStore.getState().projects.find((p) => p.id === 'remote-p1')).toBeDefined()
  })

  it('tombstoned remote projects are excluded after merge', async () => {
    const now = new Date().toISOString()
    const oldDate = '2026-01-01T00:00:00.000Z'
    const remoteProject: Project = {
      id: 'dead-p1',
      name: 'Deleted Project',
      color: '#fff',
      columns: [],
      createdAt: oldDate,
      updatedAt: oldDate
    }
    const backup: Backup = {
      version: 2,
      exportedAt: now,
      projects: [remoteProject],
      tasks: [],
      tombstones: [{ id: 'dead-p1', type: 'project', deletedAt: now }]
    }

    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()
    expect(useKanbanStore.getState().projects.find((p) => p.id === 'dead-p1')).toBeUndefined()
  })

  it('returns false when importBackup is cancelled', async () => {
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importBackup.mockResolvedValueOnce({ success: false, cancelled: true })

    const ok = await useKanbanStore.getState().importBackup()
    expect(ok).toBe(false)
  })
})

// ── Habit merge (importBackup with habits) ────────────────────────────────────

describe('habit merge during importBackup', () => {
  beforeEach(reset)

  it('unions completions from local and remote habits', async () => {
    const habitId = useKanbanStore.getState().createHabit({ name: 'Run', color: '#22c55e' })
    useKanbanStore.getState().toggleHabit(habitId, '2026-01-01')

    const localHabit = useKanbanStore.getState().habits[0]
    const remoteHabit: Habit = {
      ...localHabit,
      completions: ['2026-01-02'],
      updatedAt: new Date().toISOString()
    }
    const backup: Backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [],
      tasks: [],
      habits: [remoteHabit]
    }

    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    const merged = useKanbanStore.getState().habits.find((h) => h.id === habitId)!
    expect(merged.completions).toContain('2026-01-01')
    expect(merged.completions).toContain('2026-01-02')
  })
})

// ── Shopping list full flow ───────────────────────────────────────────────────

describe('shopping list end-to-end flow', () => {
  beforeEach(reset)

  it('creates list → adds items → checks off items → calculates total correctly', () => {
    const listId = useKanbanStore.getState().createList('Feira', 'BRL')

    const i1 = useKanbanStore.getState().addItem(listId, { name: 'Arroz', qty: 2, price: '5.0' })
    const i2 = useKanbanStore.getState().addItem(listId, { name: 'Feijão', qty: 1, price: '4.5' })
    const i3 = useKanbanStore.getState().addItem(listId, { name: 'Azeite', qty: 1, price: '18.0' })

    useKanbanStore.getState().toggleItem(listId, i1)
    useKanbanStore.getState().toggleItem(listId, i2)

    const list = useKanbanStore.getState().lists.find((l) => l.id === listId)!
    const checkedItems = list.items.filter((i) => i.done)
    expect(checkedItems).toHaveLength(2)

    const total = list.items.reduce((sum, i) => sum + Number(i.price ?? 0) * i.qty, 0)
    expect(total).toBeCloseTo(32.5) // 2×5.0 + 1×4.5 + 1×18.0

    // Delete one item
    useKanbanStore.getState().deleteItem(listId, i3)
    expect(useKanbanStore.getState().lists.find((l) => l.id === listId)!.items).toHaveLength(2)
  })
})

// ── AI JSON import ────────────────────────────────────────────────────────────

describe('importAIJson integration', () => {
  beforeEach(reset)

  it('imports tasks into correct columns using name matching', async () => {
    const pid = useKanbanStore.getState().createProject('AI Import')
    const cols = useKanbanStore.getState().projects[0].columns

    const aiJson = {
      tasks: [
        { title: 'Task in Backlog', column: 'Backlog', priority: 'high' },
        { title: 'Task in Review', column: 'Review', priority: 'low' },
        { title: 'Unknown column task', column: 'NonExistent' }
      ]
    }

    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importAIJson.mockResolvedValueOnce({ success: true, data: aiJson })

    const count = await useKanbanStore.getState().importAIJson(pid)
    expect(count).toBe(3)

    const tasks = useKanbanStore.getState().tasks
    const backlogCol = cols.find((c) => c.name === 'Backlog')!
    const reviewCol = cols.find((c) => c.name === 'Review')!

    expect(tasks.find((t) => t.title === 'Task in Backlog')!.columnId).toBe(backlogCol.id)
    expect(tasks.find((t) => t.title === 'Task in Review')!.columnId).toBe(reviewCol.id)
    // Unknown column → first column (Backlog)
    expect(tasks.find((t) => t.title === 'Unknown column task')!.columnId).toBe(backlogCol.id)
  })

  it('returns 0 when JSON has no tasks array', async () => {
    const pid = useKanbanStore.getState().createProject('Empty AI')
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = (ElectronStorage as ReturnType<typeof vi.fn>).mock.results[0]?.value
    instance.importAIJson.mockResolvedValueOnce({ success: true, data: { tasks: [] } })

    const count = await useKanbanStore.getState().importAIJson(pid)
    expect(count).toBe(0)
  })
})
