import { describe, expect, it } from 'vitest'
import { normalizeTimers } from '../normalization'

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
