import { describe, expect, it } from 'vitest'
import {
  durationInMinutes,
  formatWeekStart,
  getVisibleDays,
  layoutOverlappingBlocks,
  minutesToPixels
} from '../../utils/planner'
import type { TimeBlock } from '../../types'

function makeBlock(id: string, startTime: string, endTime: string): TimeBlock {
  return {
    id,
    date: '2026-07-27',
    startTime,
    endTime,
    title: id,
    type: 'custom',
    order: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  }
}

describe('planner utilities', () => {
  it('builds the calendar days for each view mode', () => {
    expect(getVisibleDays('day', '2026-07-29')).toEqual(['2026-07-29'])
    expect(formatWeekStart('2026-07-29')).toBe('2026-07-26')
    expect(getVisibleDays('week', '2026-07-29')).toEqual([
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01'
    ])
    expect(getVisibleDays('month', '2024-02-10')).toHaveLength(29)
  })

  it('converts times consistently for the calendar grid', () => {
    expect(durationInMinutes('09:15', '10:45')).toBe(90)
    expect(minutesToPixels('06:00')).toBe(0)
    expect(minutesToPixels('07:30')).toBe(120)
  })

  it('assigns overlapping blocks to separate columns without duplicating them', () => {
    const layout = layoutOverlappingBlocks([
      makeBlock('a', '09:00', '11:00'),
      makeBlock('b', '10:00', '12:00'),
      makeBlock('c', '11:00', '13:00')
    ])

    expect(layout).toHaveLength(3)
    expect(layout.map(({ block }) => block.id).sort()).toEqual(['a', 'b', 'c'])
    expect(layout.every(({ cols }) => cols === 2)).toBe(true)
    expect(new Set(layout.map(({ col }) => col))).toEqual(new Set([0, 1]))
  })
})
