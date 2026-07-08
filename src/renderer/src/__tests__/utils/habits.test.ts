import { describe, it, expect } from 'vitest'
import { computeHabitSummary } from '../../utils/habits'
import type { Habit } from '../../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeHabit(overrides: Partial<Habit> & { id: string }): Habit {
  return {
    name: 'Hábito',
    color: '#6366f1',
    completions: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

// Fixed reference date: 2025-06-17 (Tuesday), day 17 of June
// Use local midnight (year, month-1, day) to avoid UTC timezone offset issues
const TODAY = new Date(2025, 5, 17) // 2025-06-17

// Helpers to generate date strings relative to TODAY
function daysAgo(n: number): string {
  const d = new Date(2025, 5, 17 - n)
  return d.toISOString().slice(0, 10).replace(
    /\d{4}-\d{2}-\d{2}/,
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  )
}

// Simpler: just define key dates as constants
const D0 = '2025-06-17' // today
const D1 = '2025-06-16' // yesterday
const D2 = '2025-06-15'
const D3 = '2025-06-14'
const D4 = '2025-06-13'
const D5 = '2025-06-12'

// ── empty state ───────────────────────────────────────────────────────────────

describe('computeHabitSummary — empty state', () => {
  it('returns empty array when habits list is empty', () => {
    expect(computeHabitSummary([], TODAY)).toEqual([])
  })

  it('returns streak 0 and rate 0 for a habit with no completions', () => {
    const habit = makeHabit({ id: 'h1' })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(0)
    expect(entry.rate).toBe(0)
    expect(entry.monthDone).toBe(0)
  })
})

// ── streak ────────────────────────────────────────────────────────────────────

describe('computeHabitSummary — streak', () => {
  it('counts streak of 1 when only today is completed', () => {
    const habit = makeHabit({ id: 'h1', completions: [D0] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(1)
  })

  it('counts consecutive days ending today', () => {
    const habit = makeHabit({ id: 'h1', completions: [D0, D1, D2] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(3)
  })

  it('stops streak at a gap — day before the gap does not count', () => {
    // Today, yesterday completed but two days ago is missing, three days ago completed
    const habit = makeHabit({ id: 'h1', completions: [D0, D1, D3] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(2) // D0 + D1, gap at D2
  })

  it('counts streak starting from yesterday when today is not completed', () => {
    const habit = makeHabit({ id: 'h1', completions: [D1, D2, D3] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(3)
  })

  it('streak is 0 when today and yesterday are both missing', () => {
    const habit = makeHabit({ id: 'h1', completions: [D2, D3, D4] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(0)
  })

  it('streak is 0 when yesterday is missing even if today is not checked', () => {
    const habit = makeHabit({ id: 'h1', completions: [D3, D4, D5] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(0)
  })

  it('counts a long consecutive sequence correctly', () => {
    // 10 consecutive days ending today
    const completions = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(2025, 5, 17 - i)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    const habit = makeHabit({ id: 'h1', completions })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(10)
  })

  it('streak ignores completions from the future', () => {
    const future = '2025-06-20'
    const habit = makeHabit({ id: 'h1', completions: [D0, D1, future] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.streak).toBe(2) // D0 + D1; future entry doesn't extend streak
  })
})

// ── monthly rate ──────────────────────────────────────────────────────────────

describe('computeHabitSummary — monthly rate', () => {
  // today = 2025-06-17, dayOfMonth = 17

  it('rate is 100% when every day of the month so far is completed', () => {
    const completions = Array.from({ length: 17 }, (_, i) => {
      const d = new Date(2025, 5, i + 1)
      return `2025-06-${String(i + 1).padStart(2, '0')}`
    })
    const habit = makeHabit({ id: 'h1', completions })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.monthDone).toBe(17)
    expect(entry.rate).toBe(100)
  })

  it('rate is 0% when no days in the current month are completed', () => {
    const habit = makeHabit({ id: 'h1', completions: [] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.rate).toBe(0)
    expect(entry.monthDone).toBe(0)
  })

  it('computes rate correctly for partial completion', () => {
    // 8 out of 17 days → Math.round(8/17 * 100) = Math.round(47.06) = 47
    const completions = Array.from({ length: 8 }, (_, i) => `2025-06-${String(i + 1).padStart(2, '0')}`)
    const habit = makeHabit({ id: 'h1', completions })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.monthDone).toBe(8)
    expect(entry.rate).toBe(47)
  })

  it('does not count completions from a previous month', () => {
    const habit = makeHabit({ id: 'h1', completions: ['2025-05-31', '2025-05-30', D0] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.monthDone).toBe(1) // only D0 is in June
  })

  it('does not count future completions in the same month', () => {
    const habit = makeHabit({ id: 'h1', completions: [D0, '2025-06-30', '2025-06-25'] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.monthDone).toBe(1) // only D0 <= today
  })

  it('does not count completions from the next year', () => {
    const habit = makeHabit({ id: 'h1', completions: ['2026-06-01', D0] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.monthDone).toBe(1)
  })

  it('rounds rate correctly (Math.round)', () => {
    // 1 out of 17 → Math.round(1/17 * 100) = Math.round(5.88) = 6
    const habit = makeHabit({ id: 'h1', completions: [D0] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.rate).toBe(6)
  })
})

// ── sorting ───────────────────────────────────────────────────────────────────

describe('computeHabitSummary — sorting', () => {
  it('sorts by streak descending', () => {
    const h1 = makeHabit({ id: 'h1', name: 'Low streak', completions: [D0] })          // streak 1
    const h2 = makeHabit({ id: 'h2', name: 'High streak', completions: [D0, D1, D2] }) // streak 3
    const result = computeHabitSummary([h1, h2], TODAY)
    expect(result[0].habit.id).toBe('h2')
    expect(result[1].habit.id).toBe('h1')
  })

  it('breaks streak ties by rate descending', () => {
    // Both have streak 1 (today only), but different rates
    const h1 = makeHabit({ id: 'h1', completions: [D0] })                       // 1/17 ≈ 6%
    const h2 = makeHabit({ id: 'h2', completions: [D0, '2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05', '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-09'] }) // 10/17 ≈ 59%
    const result = computeHabitSummary([h1, h2], TODAY)
    expect(result[0].habit.id).toBe('h2')
    expect(result[1].habit.id).toBe('h1')
  })

  it('preserves order input → output when streak and rate are equal', () => {
    const h1 = makeHabit({ id: 'h1', completions: [D0] })
    const h2 = makeHabit({ id: 'h2', completions: [D0] })
    const result = computeHabitSummary([h1, h2], TODAY)
    // Both have the same streak (1) and same rate (6%), sort is stable
    expect(result.map((e) => e.habit.id)).toEqual(['h1', 'h2'])
  })

  it('returns each habit in the result exactly once', () => {
    const habits = [
      makeHabit({ id: 'h1', completions: [D0, D1, D2] }),
      makeHabit({ id: 'h2', completions: [D0] }),
      makeHabit({ id: 'h3', completions: [] })
    ]
    const result = computeHabitSummary(habits, TODAY)
    expect(result).toHaveLength(3)
    expect(result.map((e) => e.habit.id).sort()).toEqual(['h1', 'h2', 'h3'])
  })
})

// ── habit identity ────────────────────────────────────────────────────────────

describe('computeHabitSummary — habit reference', () => {
  it('result entries carry the original habit object', () => {
    const habit = makeHabit({ id: 'h1', name: 'Meditar', completions: [D0] })
    const [entry] = computeHabitSummary([habit], TODAY)
    expect(entry.habit).toBe(habit)
  })
})
