import { addDays, parseISO, format } from 'date-fns'
import type { Habit } from '../types'

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
      let cur = set.has(todayStr)
        ? todayStr
        : format(addDays(parseISO(todayStr), -1), 'yyyy-MM-dd')
      while (set.has(cur)) {
        streak++
        cur = format(addDays(parseISO(cur), -1), 'yyyy-MM-dd')
      }
      const monthDone = habit.completions.filter(
        (d) => d.startsWith(yearMonth) && d <= todayStr
      ).length
      const rate = Math.round((monthDone / dayOfMonth) * 100)
      return { habit, streak, rate, monthDone }
    })
    .sort((a, b) => b.streak - a.streak || b.rate - a.rate)
}
