import { describe, it, expect } from 'vitest'
import { computeTagData } from '../../utils/tags'
import { isDoneColumn } from '../../utils/columns'
import type { Task, Column } from '../../types'

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

// ── empty state ───────────────────────────────────────────────────────────────

describe('computeTagData — empty state', () => {
  it('returns empty array for empty task list', () => {
    expect(computeTagData([])).toEqual([])
  })

  it('returns empty array when all tasks have no tags', () => {
    const tasks = [makeTask({ id: 't1', tags: [] }), makeTask({ id: 't2', tags: [] })]
    expect(computeTagData(tasks)).toEqual([])
  })
})

// ── counting ──────────────────────────────────────────────────────────────────

describe('computeTagData — counting', () => {
  it('counts a single tag on a single task as 1', () => {
    const tasks = [makeTask({ id: 't1', tags: ['frontend'] })]
    const result = computeTagData(tasks)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ tag: 'frontend', count: 1 })
  })

  it('accumulates the same tag across multiple tasks', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['backend'] }),
      makeTask({ id: 't2', tags: ['backend'] }),
      makeTask({ id: 't3', tags: ['backend'] })
    ]
    const result = computeTagData(tasks)
    expect(result[0]).toEqual({ tag: 'backend', count: 3 })
  })

  it('counts each tag on a multi-tag task independently', () => {
    const tasks = [makeTask({ id: 't1', tags: ['feat', 'frontend', 'backend'] })]
    const result = computeTagData(tasks)
    expect(result).toHaveLength(3)
    for (const entry of result) expect(entry.count).toBe(1)
  })

  it('accumulates correctly across tasks that share some tags', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['feat', 'frontend'] }),
      makeTask({ id: 't2', tags: ['feat', 'backend'] }),
      makeTask({ id: 't3', tags: ['feat'] })
    ]
    const result = computeTagData(tasks)
    const byTag = Object.fromEntries(result.map((r) => [r.tag, r.count]))
    expect(byTag['feat']).toBe(3)
    expect(byTag['frontend']).toBe(1)
    expect(byTag['backend']).toBe(1)
  })
})

// ── sorting ───────────────────────────────────────────────────────────────────

describe('computeTagData — sorting', () => {
  it('returns tags sorted by count descending', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['rare'] }),
      makeTask({ id: 't2', tags: ['common'] }),
      makeTask({ id: 't3', tags: ['common'] }),
      makeTask({ id: 't4', tags: ['common'] })
    ]
    const result = computeTagData(tasks)
    expect(result[0].tag).toBe('common')
    expect(result[0].count).toBe(3)
    expect(result[1].tag).toBe('rare')
    expect(result[1].count).toBe(1)
  })

  it('counts are strictly non-increasing from first to last entry', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['a', 'b', 'c'] }),
      makeTask({ id: 't2', tags: ['a', 'b'] }),
      makeTask({ id: 't3', tags: ['a'] })
    ]
    const result = computeTagData(tasks)
    for (let i = 1; i < result.length; i++) {
      expect(result[i].count).toBeLessThanOrEqual(result[i - 1].count)
    }
  })
})

// ── top-10 limit ──────────────────────────────────────────────────────────────

describe('computeTagData — top-10 limit', () => {
  it('returns at most 10 entries regardless of distinct tag count', () => {
    // 15 tasks each with a unique tag
    const tasks = Array.from({ length: 15 }, (_, i) =>
      makeTask({ id: `t${i}`, tags: [`tag-${i}`] })
    )
    const result = computeTagData(tasks)
    expect(result).toHaveLength(10)
  })

  it('the 10 returned entries are the ones with the highest counts', () => {
    // 11 tags: 'top-0'...'top-9' each appear i+2 times, 'bottom' appears 1 time
    const tasks: Task[] = []
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < i + 2; j++) {
        tasks.push(makeTask({ id: `t-${i}-${j}`, tags: [`top-${i}`] }))
      }
    }
    tasks.push(makeTask({ id: 'bottom', tags: ['bottom'] })) // count 1

    const result = computeTagData(tasks)
    expect(result).toHaveLength(10)
    const returnedTags = result.map((r) => r.tag)
    expect(returnedTags).not.toContain('bottom')
    for (let i = 0; i < 10; i++) {
      expect(returnedTags).toContain(`top-${i}`)
    }
  })

  it('returns all entries when there are fewer than 10 distinct tags', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['a', 'b', 'c'] }),
      makeTask({ id: 't2', tags: ['d', 'e'] })
    ]
    const result = computeTagData(tasks)
    expect(result).toHaveLength(5)
  })
})

// ── done tasks excluded ───────────────────────────────────────────────────────

describe('computeTagData — done tasks excluded by caller', () => {
  // computeTagData receives activeTasks (pre-filtered, same as habits/dueDates).
  // Done-column tasks are excluded via isDoneColumn before this function is called.

  it('tags from done tasks do not appear when those tasks are filtered out', () => {
    const doneCol: Column = { id: 'col-done', name: 'done', order: 0 }
    const activeCol: Column = { id: 'col-active', name: 'In Progress', order: 1 }

    const allTasks = [
      makeTask({ id: 't1', tags: ['backend'], columnId: 'col-done' }),   // done — should be excluded
      makeTask({ id: 't2', tags: ['frontend'], columnId: 'col-active' }) // active — should count
    ]

    const activeTasks = allTasks.filter(
      (t) => !isDoneColumn(t.columnId === 'col-done' ? doneCol : activeCol)
    )

    const result = computeTagData(activeTasks)
    const tags = result.map((r) => r.tag)
    expect(tags).toContain('frontend')
    expect(tags).not.toContain('backend')
  })

  it('all tags disappear when every task is in a done column', () => {
    // Simulate: activeTasks is empty after filtering
    expect(computeTagData([])).toEqual([])
  })

  it('active task tags still count even when done tasks share the same tag', () => {
    // done task also has 'shared' but is filtered out; active task has it too
    const tasks = [makeTask({ id: 't1', tags: ['shared', 'active-only'] })]
    // pass only active tasks (the done task is already removed by caller)
    const result = computeTagData(tasks)
    const byTag = Object.fromEntries(result.map((r) => [r.tag, r.count]))
    expect(byTag['shared']).toBe(1)
    expect(byTag['active-only']).toBe(1)
  })
})
