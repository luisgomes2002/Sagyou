import { addDays, parseISO, format } from 'date-fns'
import type { Habit } from '../types'

export interface HabitSummaryEntry {
  habit: Habit
  streak: number
  rate: number
  monthDone: number
}

/**
 * The day `now` falls on, as the YYYY-MM-DD string Habit.completions stores.
 *
 * Built from the LOCAL date parts, matching HabitView's checkbox. Using
 * toISOString() here would hand back the UTC day, so marking a habit at 21:00
 * in Brazil would tick tomorrow's box.
 */
export function todayISO(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd')
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
