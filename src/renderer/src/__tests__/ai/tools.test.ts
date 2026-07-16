import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock ElectronStorage before importing the store (same pattern as kanban.test.ts)
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
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { runTool } from '../../ai/tools'

function resetStore(): void {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    files: [],
    activeProjectId: null,
    sprintFilter: null,
    activeTimer: null,
    isLoaded: false
  })
}

const st = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()
const call = async (name: string, args: Record<string, unknown>): Promise<{ [k: string]: unknown }> =>
  JSON.parse(await runTool(name, args))

// ── concluir_task ──────────────────────────────────────────────────────────────

describe('concluir_task', () => {
  beforeEach(resetStore)

  it('moves the task to Done and stops the running timer', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })

    st().startTimer(tid)
    expect(st().activeTimer?.taskId).toBe(tid)

    const res = await call('concluir_task', { taskId: tid })
    expect(res.ok).toBe(true)

    const task = st().tasks.find((t) => t.id === tid)!
    const doneCol = st().projects[0].columns.find((c) => c.name === 'Done')!
    expect(task.columnId).toBe(doneCol.id)
    expect(task.completedAt).toBeTruthy()
    expect(st().activeTimer).toBeNull()
  })

  it('finds the task by exact title (case-insensitive)', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    st().createTask({ projectId: pid, columnId: backlog.id, title: 'Fix bug' })

    const res = await call('concluir_task', { titulo: 'fix bug' })
    expect(res.ok).toBe(true)
    expect(st().tasks[0].completedAt).toBeTruthy()
  })

  it('returns an error when the task is not found', async () => {
    st().createProject('P')
    expect((await call('concluir_task', { taskId: 'nope' })).error).toBeTruthy()
  })
})

// ── criar_sprints ────────────────────────────────────────────────────────────

describe('criar_sprints', () => {
  beforeEach(resetStore)

  it('creates sprints in the given project', async () => {
    const pid = st().createProject('P')
    const res = await call('criar_sprints', { projectId: pid, nomes: ['Sprint 1', 'Sprint 2'] })
    expect(res.criadas).toEqual(['Sprint 1', 'Sprint 2'])

    const names = st()
      .sprints.filter((s) => s.projectId === pid)
      .map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining(['Sprint 1', 'Sprint 2']))
  })

  it('falls back to the active project when projectId is omitted', async () => {
    const pid = st().createProject('P') // createProject sets it active
    await call('criar_sprints', { nomes: ['Sprint X'] })
    expect(st().sprints.some((s) => s.projectId === pid && s.name === 'Sprint X')).toBe(true)
  })

  it('returns an error when no names are given', async () => {
    st().createProject('P')
    expect((await call('criar_sprints', { nomes: [] })).error).toBeTruthy()
  })
})

// ── atribuir_sprint ──────────────────────────────────────────────────────────

describe('atribuir_sprint', () => {
  beforeEach(resetStore)

  it('assigns an existing sprint to a task by name (case-insensitive)', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })
    st().createSprints(pid, ['Sprint 1'])
    const sprintId = st().sprints.find((s) => s.name === 'Sprint 1')!.id

    const res = await call('atribuir_sprint', { taskId: tid, sprint: 'sprint 1' })
    expect(res.ok).toBe(true)
    expect(st().tasks.find((t) => t.id === tid)!.sprintId).toBe(sprintId)
  })

  it('returns an error listing available sprints when the sprint is unknown', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })
    st().createSprints(pid, ['Sprint 1'])

    const res = await call('atribuir_sprint', { taskId: tid, sprint: 'Missing' })
    expect(res.error).toBeTruthy()
    expect(res.disponiveis).toEqual(['Sprint 1'])
  })
})

// ── criar_tasks / importTasksFromAIChat ──────────────────────────────────────

describe('importTasksFromAIChat (via criar_tasks)', () => {
  beforeEach(resetStore)

  it('matches column and sprint by name (case-insensitive)', async () => {
    const pid = st().createProject('P')
    st().createSprints(pid, ['Sprint 1'])
    const inProgress = st().projects[0].columns.find((c) => c.name === 'In Progress')!
    const first = st().projects[0].columns[0]
    const sprintId = st().sprints.find((s) => s.name === 'Sprint 1')!.id

    const count = st().importTasksFromAIChat(pid, [
      { title: 'A', column: 'in progress', sprint: 'SPRINT 1' },
      { title: 'B' }
    ])
    expect(count).toBe(2)

    const a = st().tasks.find((t) => t.title === 'A')!
    const b = st().tasks.find((t) => t.title === 'B')!
    expect(a.columnId).toBe(inProgress.id)
    expect(a.sprintId).toBe(sprintId)
    // B has no column/sprint → first column, no sprint
    expect(b.columnId).toBe(first.id)
    expect(b.sprintId).toBeUndefined()
  })

  it('falls back to the first column when the column name does not match', async () => {
    const pid = st().createProject('P')
    const first = st().projects[0].columns[0]
    st().importTasksFromAIChat(pid, [{ title: 'X', column: 'Nonexistent' }])
    expect(st().tasks.find((t) => t.title === 'X')!.columnId).toBe(first.id)
  })

  it('returns 0 when the project does not exist', async () => {
    expect(st().importTasksFromAIChat('nope', [{ title: 'X' }])).toBe(0)
  })

  it('criar_tasks tool delegates to importTasksFromAIChat', async () => {
    const pid = st().createProject('P')
    const res = await call('criar_tasks', { projectId: pid, tasks: [{ title: 'A' }, { title: 'B' }] })
    expect(res.criadas).toBe(2)
    expect(st().tasks.filter((t) => t.projectId === pid)).toHaveLength(2)
  })
})
