import { describe, it, expect } from 'vitest'
import { HEATMAP_COLORS, heatColor, buildCountMap, buildHeatmapGrid } from '../../utils/heatmap'
import { isDoneColumn, isTaskDone } from '../../utils/columns'
import type { Task, Project } from '../../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    columnId: 'col-done',
    title: 'Task',
    priority: 'low',
    tags: [],
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    ...overrides
  }
}

function makeProject(colNames: string[]): Project {
  return {
    id: 'p1',
    name: 'Project',
    color: '#fff',
    columns: colNames.map((name, i) => ({ id: `c${i}`, name, order: i })),
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
}

// ── heatColor ─────────────────────────────────────────────────────────────────

describe('heatColor', () => {
  it('returns level 0 for count 0', () => {
    expect(heatColor(0)).toBe(HEATMAP_COLORS[0])
  })

  it('returns level 1 for count 1', () => {
    expect(heatColor(1)).toBe(HEATMAP_COLORS[1])
  })

  it('returns level 2 for count 2', () => {
    expect(heatColor(2)).toBe(HEATMAP_COLORS[2])
  })

  it('returns level 2 for count 3 (boundary)', () => {
    expect(heatColor(3)).toBe(HEATMAP_COLORS[2])
  })

  it('returns level 3 for count 4', () => {
    expect(heatColor(4)).toBe(HEATMAP_COLORS[3])
  })

  it('returns level 3 for count 6 (boundary)', () => {
    expect(heatColor(6)).toBe(HEATMAP_COLORS[3])
  })

  it('returns level 4 for count 7', () => {
    expect(heatColor(7)).toBe(HEATMAP_COLORS[4])
  })

  it('returns level 4 for large counts', () => {
    expect(heatColor(100)).toBe(HEATMAP_COLORS[4])
  })
})

// ── buildCountMap ──────────────────────────────────────────────────────────────

describe('buildCountMap', () => {
  it('returns empty map for empty task list', () => {
    expect(buildCountMap([])).toEqual(new Map())
  })

  it('uses completedAt when present', () => {
    const task = makeTask({
      id: 't1',
      completedAt: '2024-03-10T12:00:00.000Z',
      updatedAt: '2024-03-05T00:00:00.000Z'
    })
    const map = buildCountMap([task])
    expect(map.get('2024-03-10')).toBe(1)
    expect(map.has('2024-03-05')).toBe(false)
  })

  it('falls back to updatedAt when completedAt is absent', () => {
    const task = makeTask({ id: 't1', updatedAt: '2024-03-15T09:00:00.000Z' })
    const map = buildCountMap([task])
    expect(map.get('2024-03-15')).toBe(1)
  })

  it('accumulates multiple tasks on the same date', () => {
    const tasks = [
      makeTask({ id: 't1', completedAt: '2024-03-10T08:00:00.000Z' }),
      makeTask({ id: 't2', completedAt: '2024-03-10T10:00:00.000Z' }),
      makeTask({ id: 't3', completedAt: '2024-03-10T15:00:00.000Z' })
    ]
    expect(buildCountMap(tasks).get('2024-03-10')).toBe(3)
  })

  it('tracks multiple distinct dates independently', () => {
    const tasks = [
      makeTask({ id: 't1', completedAt: '2024-03-10T00:00:00.000Z' }),
      makeTask({ id: 't2', completedAt: '2024-03-11T00:00:00.000Z' })
    ]
    const map = buildCountMap(tasks)
    expect(map.get('2024-03-10')).toBe(1)
    expect(map.get('2024-03-11')).toBe(1)
    expect(map.size).toBe(2)
  })

  it('slices ISO datetime to date key (first 10 chars)', () => {
    const task = makeTask({ id: 't1', completedAt: '2024-06-17T23:59:59.999Z' })
    const map = buildCountMap([task])
    expect(map.has('2024-06-17')).toBe(true)
    expect(map.get('2024-06-17')).toBe(1)
  })

  it('mixes completedAt and updatedAt across tasks correctly', () => {
    const tasks = [
      makeTask({ id: 't1', completedAt: '2024-05-01T00:00:00.000Z' }),
      makeTask({ id: 't2', updatedAt: '2024-05-02T00:00:00.000Z' })
    ]
    const map = buildCountMap(tasks)
    expect(map.get('2024-05-01')).toBe(1)
    expect(map.get('2024-05-02')).toBe(1)
  })
})

// ── buildHeatmapGrid ──────────────────────────────────────────────────────────

describe('buildHeatmapGrid', () => {
  // Use local midnight to avoid UTC-vs-local timezone shifts
  // June = month index 5 (0-based)
  const FIXED_TODAY = new Date(2025, 5, 17) // 2025-06-17 local

  it('every week has exactly 7 cells', () => {
    const { weeks } = buildHeatmapGrid(FIXED_TODAY)
    for (const week of weeks) {
      expect(week).toHaveLength(7)
    }
  })

  it('total cell count is a multiple of 7', () => {
    const { weeks } = buildHeatmapGrid(FIXED_TODAY)
    const totalCells = weeks.reduce((sum, w) => sum + w.length, 0)
    expect(totalCells % 7).toBe(0)
  })

  it('produces 52 or 53 complete weeks (364–371 cells)', () => {
    const { weeks } = buildHeatmapGrid(FIXED_TODAY)
    const totalCells = weeks.reduce((sum, w) => sum + w.length, 0)
    expect(totalCells).toBeGreaterThanOrEqual(364)
    expect(totalCells).toBeLessThanOrEqual(371)
  })

  it('first cell is always a Sunday (getDay() === 0)', () => {
    // Use local midnight dates to avoid timezone issues
    const locals = [
      new Date(2025, 0, 1),  // Jan 1
      new Date(2025, 5, 17), // Jun 17
      new Date(2025, 11, 31) // Dec 31
    ]
    for (const d of locals) {
      const { weeks } = buildHeatmapGrid(d)
      expect(weeks[0][0].date.getDay()).toBe(0)
    }
  })

  it('today is present in the grid and not marked as future', () => {
    const { weeks, todayStr } = buildHeatmapGrid(FIXED_TODAY)
    const allCells = weeks.flat()
    const todayCell = allCells.find((c) => c.iso === todayStr)
    expect(todayCell).toBeDefined()
    expect(todayCell!.future).toBe(false)
  })

  it('dates after today are marked as future', () => {
    const { weeks, todayStr } = buildHeatmapGrid(FIXED_TODAY)
    const futureCells = weeks.flat().filter((c) => c.iso > todayStr)
    expect(futureCells.length).toBeGreaterThan(0)
    for (const cell of futureCells) {
      expect(cell.future).toBe(true)
    }
  })

  it('dates before today are not marked as future', () => {
    const { weeks, todayStr } = buildHeatmapGrid(FIXED_TODAY)
    const pastCells = weeks.flat().filter((c) => c.iso < todayStr)
    expect(pastCells.length).toBeGreaterThan(0)
    for (const cell of pastCells) {
      expect(cell.future).toBe(false)
    }
  })

  it('startStr matches the iso of the very first cell', () => {
    const { weeks, startStr } = buildHeatmapGrid(FIXED_TODAY)
    expect(startStr).toBe(weeks[0][0].iso)
  })

  it('startStr cell date is a Sunday', () => {
    // Check via the Date object (local time), not by re-parsing the string
    const { weeks } = buildHeatmapGrid(FIXED_TODAY)
    expect(weeks[0][0].date.getDay()).toBe(0)
  })

  it('works when today is a Sunday', () => {
    const sunday = new Date(2025, 5, 15) // 2025-06-15 is a Sunday
    const { weeks, todayStr } = buildHeatmapGrid(sunday)
    expect(weeks[0][0].date.getDay()).toBe(0)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.flat().some((c) => c.iso === todayStr)).toBe(true)
  })

  it('works when today is a Saturday', () => {
    const saturday = new Date(2025, 5, 21) // 2025-06-21 is a Saturday
    const { weeks, todayStr } = buildHeatmapGrid(saturday)
    expect(weeks[0][0].date.getDay()).toBe(0)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.flat().some((c) => c.iso === todayStr)).toBe(true)
  })

  it('todayStr is a 10-character yyyy-MM-dd string', () => {
    const { todayStr } = buildHeatmapGrid(FIXED_TODAY)
    expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayStr).toHaveLength(10)
  })
})

// ── isDoneColumn ──────────────────────────────────────────────────────────────

describe('isDoneColumn', () => {
  it('returns true for a column named "done"', () => {
    expect(isDoneColumn({ id: 'c1', name: 'done', order: 0 })).toBe(true)
  })

  it('is case-insensitive (Done, DONE)', () => {
    expect(isDoneColumn({ id: 'c1', name: 'Done', order: 0 })).toBe(true)
    expect(isDoneColumn({ id: 'c1', name: 'DONE', order: 0 })).toBe(true)
  })

  it('returns false for other column names', () => {
    expect(isDoneColumn({ id: 'c1', name: 'In Progress', order: 0 })).toBe(false)
    expect(isDoneColumn({ id: 'c1', name: 'Backlog', order: 0 })).toBe(false)
    expect(isDoneColumn({ id: 'c1', name: 'Review', order: 0 })).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isDoneColumn(undefined)).toBe(false)
  })
})

// ── isTaskDone ─────────────────────────────────────────────────────────────────

describe('isTaskDone', () => {
  it('returns true when task is in a done column', () => {
    const project = makeProject(['Backlog', 'done'])
    const task = makeTask({ id: 't1', columnId: 'c1', projectId: 'p1' })
    expect(isTaskDone(task, [project])).toBe(true)
  })

  it('returns false when task is in a non-done column', () => {
    const project = makeProject(['Backlog', 'done'])
    const task = makeTask({ id: 't1', columnId: 'c0', projectId: 'p1' })
    expect(isTaskDone(task, [project])).toBe(false)
  })

  it('returns false when project is not found', () => {
    const task = makeTask({ id: 't1', columnId: 'c1', projectId: 'unknown' })
    expect(isTaskDone(task, [])).toBe(false)
  })

  it('returns false when columnId does not match any column in the project', () => {
    const project = makeProject(['Backlog', 'done'])
    const task = makeTask({ id: 't1', columnId: 'nonexistent', projectId: 'p1' })
    expect(isTaskDone(task, [project])).toBe(false)
  })
})
