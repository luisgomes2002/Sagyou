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
    this.autoSaveBackup = vi.fn().mockResolvedValue({ success: true })
    this.commitBackupBlobs = vi.fn().mockResolvedValue({ success: true })
    this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    this.loadMemories = vi.fn().mockResolvedValue([])
    this.replaceMemories = vi.fn().mockResolvedValue(undefined)
    this.rebuildSearchIndex = vi.fn().mockResolvedValue(undefined)
  })
}))

import { useKanbanStore } from '../../store/kanban'
import type { Backup, Habit, Project } from '@sagyou/core/types'

function reset(): void {
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
    activeTimers: [],
    isLoaded: false
  })
}

// ── Full kanban board flow ────────────────────────────────────────────────────

describe('full kanban board workflow', () => {
  beforeEach(reset)

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
})

// ── importBackup: tombstones ───────────────────────────────────────────────

describe('importBackup replaces the state', () => {
  beforeEach(reset)

  it('does not restore a project that the backup marks as deleted', async () => {
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
})

// ── importBackup: the one thing it merges ────────────────────────────────────

describe('habit completions during importBackup', () => {
  beforeEach(reset)

  it('keeps the days marked here together with the ones of the backup', async () => {
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
