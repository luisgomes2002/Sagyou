import { describe, it, expect } from 'vitest'
import { computeSprintVelocity } from '../../utils/reports'
import type { Sprint, Task } from '../../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSprint(overrides: Partial<Sprint> & { id: string; createdAt: string }): Sprint {
  return {
    projectId: 'p1',
    name: overrides.id,
    closedAt: '2024-01-31T00:00:00.000Z',
    ...overrides,
  }
}

function makeDoneTask(id: string, sprintId?: string): Task {
  return {
    id,
    projectId: 'p1',
    columnId: 'done',
    title: `Task ${id}`,
    priority: 'low',
    tags: [],
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    sprintId,
  }
}

// ── computeSprintVelocity ─────────────────────────────────────────────────────

describe('computeSprintVelocity', () => {
  it('returns empty array when there are no sprints', () => {
    const result = computeSprintVelocity([], [makeDoneTask('t1', 's1')])
    expect(result).toEqual([])
  })

  it('returns empty array when there are no done tasks', () => {
    const sprint = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' })
    const result = computeSprintVelocity([sprint], [])
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(0)
  })

  it('counts done tasks correctly per sprint', () => {
    const s1 = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' })
    const s2 = makeSprint({ id: 's2', createdAt: '2024-02-01T00:00:00.000Z' })
    const tasks = [
      makeDoneTask('t1', 's1'),
      makeDoneTask('t2', 's1'),
      makeDoneTask('t3', 's2'),
    ]
    const result = computeSprintVelocity([s1, s2], tasks)
    expect(result.find((r) => r.sprint.id === 's1')?.count).toBe(2)
    expect(result.find((r) => r.sprint.id === 's2')?.count).toBe(1)
  })

  it('ignores done tasks without sprintId', () => {
    const sprint = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' })
    const tasks = [
      makeDoneTask('t1', 's1'),
      makeDoneTask('t2', undefined), // no sprint
      makeDoneTask('t3', undefined),
    ]
    const result = computeSprintVelocity([sprint], tasks)
    expect(result[0].count).toBe(1)
  })

  it('ignores done tasks belonging to other sprints not in the list', () => {
    const sprint = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' })
    const tasks = [
      makeDoneTask('t1', 's1'),
      makeDoneTask('t2', 'other-sprint'),
    ]
    const result = computeSprintVelocity([sprint], tasks)
    expect(result[0].count).toBe(1)
  })

  it('marks sprint without closedAt as active', () => {
    const active = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z', closedAt: undefined })
    const result = computeSprintVelocity([active], [])
    expect(result[0].active).toBe(true)
  })

  it('marks sprint with closedAt as not active', () => {
    const closed = makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z', closedAt: '2024-01-31T00:00:00.000Z' })
    const result = computeSprintVelocity([closed], [])
    expect(result[0].active).toBe(false)
  })

  it('limits output to the last 8 sprints ordered by createdAt', () => {
    const sprints = Array.from({ length: 10 }, (_, i) =>
      makeSprint({
        id: `s${i + 1}`,
        createdAt: `2024-${String(i + 1).padStart(2, '0')}-01T00:00:00.000Z`,
      })
    )
    const result = computeSprintVelocity(sprints, [])
    expect(result).toHaveLength(8)
    expect(result[0].sprint.id).toBe('s3')  // oldest of the last 8
    expect(result[7].sprint.id).toBe('s10') // most recent
  })

  it('orders output by createdAt ascending within the window', () => {
    const sprints = [
      makeSprint({ id: 's3', createdAt: '2024-03-01T00:00:00.000Z' }),
      makeSprint({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' }),
      makeSprint({ id: 's2', createdAt: '2024-02-01T00:00:00.000Z' }),
    ]
    const result = computeSprintVelocity(sprints, [])
    expect(result.map((r) => r.sprint.id)).toEqual(['s1', 's2', 's3'])
  })

  it('with exactly 8 sprints returns all of them', () => {
    const sprints = Array.from({ length: 8 }, (_, i) =>
      makeSprint({
        id: `s${i + 1}`,
        createdAt: `2024-${String(i + 1).padStart(2, '0')}-01T00:00:00.000Z`,
      })
    )
    const result = computeSprintVelocity(sprints, [])
    expect(result).toHaveLength(8)
  })
})
