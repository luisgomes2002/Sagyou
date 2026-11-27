import { describe, expect, it } from 'vitest'
import {
  activeCodePathIds,
  normalizeProject,
  normalizeTimers,
  withActiveCodePaths
} from '../normalization'
import type { Project } from '../types'

describe('normalizeTimers', () => {
  it('keeps the running timers of the list', () => {
    expect(
      normalizeTimers({
        activeTimers: [
          { taskId: 't1', startedAt: 1 },
          { taskId: 't2', startedAt: 2 }
        ]
      })
    ).toEqual([
      { taskId: 't1', startedAt: 1 },
      { taskId: 't2', startedAt: 2 }
    ])
  })

  it('drops an item without a string taskId or a numeric startedAt', () => {
    expect(
      normalizeTimers({
        activeTimers: [
          { taskId: 't1', startedAt: 1 },
          { taskId: 't2' },
          { taskId: 3, startedAt: 3 },
          null,
          'x'
        ]
      })
    ).toEqual([{ taskId: 't1', startedAt: 1 }])
  })

  it('ignores the retired single-timer field', () => {
    expect(normalizeTimers({ activeTimer: { taskId: 't1', startedAt: 1 } } as never)).toEqual([])
  })

  it('reads anything else as no timers', () => {
    expect(normalizeTimers({})).toEqual([])
    expect(normalizeTimers({ activeTimers: 'x' })).toEqual([])
  })
})

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'P',
  color: '#000000',
  columns: [],
  codePaths: [
    { id: 'a', path: '/a' },
    { id: 'b', path: '/b' }
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

describe('withActiveCodePaths', () => {
  it('writes only the list, never the retired singular field', () => {
    const written = withActiveCodePaths(['a', 'b'])
    expect(written).toEqual({ activeCodePathIds: ['a', 'b'] })
    expect(written).not.toHaveProperty('activeCodePathId')
  })
})

describe('normalizeProject', () => {
  it('never fills an empty list, and ignores the retired singular field (backup-compat reads it)', () => {
    expect(normalizeProject(project({ activeCodePathIds: [] }), 0).activeCodePathIds).toEqual([])
    expect(normalizeProject(project({ activeCodePathId: 'b' }), 0).activeCodePathIds).toEqual([])
  })

  it('drops a selected id whose code path no longer exists', () => {
    expect(
      normalizeProject(project({ activeCodePathIds: ['a', 'gone'] }), 0).activeCodePathIds
    ).toEqual(['a'])
  })

  it('keeps the order it was given or the index', () => {
    expect(normalizeProject(project({ order: 4 }), 0).order).toBe(4)
    expect(normalizeProject(project(), 2).order).toBe(2)
  })
})

describe('activeCodePathIds', () => {
  it('reads only the list', () => {
    expect(activeCodePathIds(project({ activeCodePathIds: ['a'] }))).toEqual(['a'])
    expect(activeCodePathIds(project({ activeCodePathId: 'b' }))).toEqual([])
    expect(activeCodePathIds(project())).toEqual([])
  })
})
