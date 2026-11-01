import { addDays, format } from 'date-fns'
import type { Habit } from '../types'

export { todayLocalISO as todayISO } from './dates'

export interface HabitSummaryEntry {
  habit: Habit
  streak: number
  rate: number
  monthDone: number
}

export function computeHabitSummary(habits: Habit[], today: Date): HabitSummaryEntry[] {
  const todayStr = format(today, 'yyyy-MM-dd')
  const yearMonth = format(today, 'yyyy-MM')
  const dayOfMonth = today.getDate()

  return habits
    .map((habit) => {
      const set = new Set(habit.completions)
      let streak = 0
      // Walk backwards one calendar day at a time from today (or yesterday, if
      // today isn't marked yet), stepping a single Date instead of re-parsing
      // the YYYY-MM-DD string on every iteration.
      let cur = set.has(todayStr) ? today : addDays(today, -1)
      let curStr = format(cur, 'yyyy-MM-dd')
      while (set.has(curStr)) {
        streak++
        cur = addDays(cur, -1)
        curStr = format(cur, 'yyyy-MM-dd')
      }
      const monthDone = habit.completions.filter(
        (d) => d.startsWith(yearMonth) && d <= todayStr
      ).length
      const rate = Math.round((monthDone / dayOfMonth) * 100)
      return { habit, streak, rate, monthDone }
    })
    .sort((a, b) => b.streak - a.streak || b.rate - a.rate)
}
