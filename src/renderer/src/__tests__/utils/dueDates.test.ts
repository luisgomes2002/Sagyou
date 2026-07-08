import { describe, it, expect } from 'vitest'
import { computeDueDateData } from '../../utils/dueDates'
import { isDoneColumn } from '../../utils/columns'
import type { Task, Project, Column } from '../../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    columnId: 'col-active',
    title: 'Task',
    priority: 'low',
    tags: [],
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeProject(id = 'p1'): Project {
  return {
    id,
    name: `Project ${id}`,
    color: '#6366f1',
    columns: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
}

// Fixed reference date: 2025-06-17 (local midnight, no UTC shift)
// todayStr  = '2025-06-17'
// in7Str    = '2025-06-24'
const TODAY = new Date(2025, 5, 17)

const emptyProjectMap = new Map<string, Project>()

// ── empty state ───────────────────────────────────────────────────────────────

describe('computeDueDateData — empty state', () => {
  it('returns empty arrays when there are no active tasks', () => {
    const result = computeDueDateData([], emptyProjectMap, TODAY)
    expect(result.overdue).toEqual([])
    expect(result.upcoming).toEqual([])
    expect(result.list).toEqual([])
  })

  it('returns empty arrays when no active task has a dueDate', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })]
    const result = computeDueDateData(tasks, emptyProjectMap, TODAY)
    expect(result.overdue).toHaveLength(0)
    expect(result.upcoming).toHaveLength(0)
  })
})

// ── overdue ───────────────────────────────────────────────────────────────────

describe('computeDueDateData — overdue', () => {
  it('puts a task due yesterday in overdue', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-16' }) // yesterday
    const { overdue } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(overdue).toHaveLength(1)
    expect(overdue[0].task.id).toBe('t1')
  })

  it('puts a task due long ago in overdue', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-01-01' })
    const { overdue } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(overdue).toHaveLength(1)
  })

  it('does NOT put a task due today in overdue (today is not < today)', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-17' }) // today
    const { overdue } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(overdue).toHaveLength(0)
  })

  it('counts multiple overdue tasks independently', () => {
    const tasks = [
      makeTask({ id: 't1', dueDate: '2025-06-10' }),
      makeTask({ id: 't2', dueDate: '2025-06-15' }),
      makeTask({ id: 't3', dueDate: '2025-06-16' })
    ]
    const { overdue } = computeDueDateData(tasks, emptyProjectMap, TODAY)
    expect(overdue).toHaveLength(3)
  })
})

// ── upcoming ──────────────────────────────────────────────────────────────────

describe('computeDueDateData — upcoming', () => {
  it('puts a task due today in upcoming', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-17' })
    const { upcoming } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].task.id).toBe('t1')
  })

  it('puts a task due in 3 days in upcoming', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-20' })
    const { upcoming } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(upcoming).toHaveLength(1)
  })

  it('puts a task due in exactly 7 days in upcoming (boundary inclusive)', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-24' }) // today + 7
    const { upcoming } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(upcoming).toHaveLength(1)
  })

  it('does NOT put a task due in 8 days in upcoming', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-25' }) // today + 8
    const { upcoming } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(upcoming).toHaveLength(0)
  })

  it('does NOT put a far-future task in overdue or upcoming', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-12-31' })
    const result = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(result.overdue).toHaveLength(0)
    expect(result.upcoming).toHaveLength(0)
  })
})

// ── done tasks excluded ───────────────────────────────────────────────────────

describe('computeDueDateData — done tasks are excluded by caller', () => {
  // computeDueDateData receives activeTasks (pre-filtered).
  // Completed tasks in "done" columns are excluded via isDoneColumn before
  // this function is called — tested here end-to-end.

  it('a done task with a past dueDate does NOT appear when filtered out', () => {
    const doneCol: Column = { id: 'col-done', name: 'done', order: 0 }
    const activeCol: Column = { id: 'col-active', name: 'In Progress', order: 1 }

    const overdueTask = makeTask({ id: 't1', dueDate: '2025-06-10', columnId: 'col-done' })
    const allTasks = [overdueTask]

    // Simulate what ReportsView does: filter out done-column tasks
    const activeTasks = allTasks.filter(
      (t) => !isDoneColumn(t.columnId === 'col-done' ? doneCol : activeCol)
    )

    const result = computeDueDateData(activeTasks, emptyProjectMap, TODAY)
    expect(result.overdue).toHaveLength(0)
  })

  it('an active task with the same past dueDate DOES appear', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-10', columnId: 'col-active' })
    const { overdue } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(overdue).toHaveLength(1)
  })
})

// ── list (combined + sorted) ──────────────────────────────────────────────────

describe('computeDueDateData — list', () => {
  it('list contains all overdue and upcoming entries', () => {
    const tasks = [
      makeTask({ id: 't1', dueDate: '2025-06-10' }), // overdue
      makeTask({ id: 't2', dueDate: '2025-06-20' }), // upcoming
      makeTask({ id: 't3', dueDate: '2025-06-16' })  // overdue
    ]
    const { list } = computeDueDateData(tasks, emptyProjectMap, TODAY)
    expect(list).toHaveLength(3)
    expect(list.map((e) => e.task.id).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('list is sorted by dueDate ascending', () => {
    const tasks = [
      makeTask({ id: 't1', dueDate: '2025-06-20' }), // upcoming
      makeTask({ id: 't2', dueDate: '2025-06-10' }), // overdue (oldest)
      makeTask({ id: 't3', dueDate: '2025-06-16' })  // overdue (recent)
    ]
    const { list } = computeDueDateData(tasks, emptyProjectMap, TODAY)
    expect(list.map((e) => e.task.dueDate)).toEqual([
      '2025-06-10',
      '2025-06-16',
      '2025-06-20'
    ])
  })

  it('list excludes tasks with no dueDate or due beyond 7 days', () => {
    const tasks = [
      makeTask({ id: 't1' }),                         // no dueDate
      makeTask({ id: 't2', dueDate: '2025-12-31' })  // far future
    ]
    const { list } = computeDueDateData(tasks, emptyProjectMap, TODAY)
    expect(list).toHaveLength(0)
  })
})

// ── project lookup ────────────────────────────────────────────────────────────

describe('computeDueDateData — project resolution', () => {
  it('resolves project when present in projectMap', () => {
    const project = makeProject('p1')
    const task = makeTask({ id: 't1', dueDate: '2025-06-10', projectId: 'p1' })
    const projectMap = new Map([['p1', project]])
    const { overdue } = computeDueDateData([task], projectMap, TODAY)
    expect(overdue[0].project).toBe(project)
  })

  it('sets project to undefined when not in projectMap', () => {
    const task = makeTask({ id: 't1', dueDate: '2025-06-10', projectId: 'unknown' })
    const { overdue } = computeDueDateData([task], emptyProjectMap, TODAY)
    expect(overdue[0].project).toBeUndefined()
  })

  it('resolves correct project for each task', () => {
    const pA = makeProject('pA')
    const pB = makeProject('pB')
    const tasks = [
      makeTask({ id: 't1', dueDate: '2025-06-10', projectId: 'pA' }),
      makeTask({ id: 't2', dueDate: '2025-06-20', projectId: 'pB' })
    ]
    const projectMap = new Map([['pA', pA], ['pB', pB]])
    const result = computeDueDateData(tasks, projectMap, TODAY)
    expect(result.overdue[0].project?.id).toBe('pA')
    expect(result.upcoming[0].project?.id).toBe('pB')
  })
})

// ── todayStr ──────────────────────────────────────────────────────────────────

describe('computeDueDateData — todayStr', () => {
  it('returns todayStr as a yyyy-MM-dd string', () => {
    const { todayStr } = computeDueDateData([], emptyProjectMap, TODAY)
    expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayStr).toHaveLength(10)
  })
})
