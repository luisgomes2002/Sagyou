import { startOfWeek, subWeeks, addDays, format } from 'date-fns'
import type { Task } from '../types'

export const HEATMAP_COLORS = ['#161b2c', '#312e81', '#4338ca', '#7c3aed', '#a080f0'] as const

export function heatColor(count: number): string {
  if (count === 0) return HEATMAP_COLORS[0]
  if (count === 1) return HEATMAP_COLORS[1]
  if (count <= 3) return HEATMAP_COLORS[2]
  if (count <= 6) return HEATMAP_COLORS[3]
  return HEATMAP_COLORS[4]
}

export type HeatCell = { date: Date; iso: string; future: boolean }

export function buildCountMap(doneTasks: Task[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of doneTasks) {
    const d = (t.completedAt ?? t.updatedAt)?.slice(0, 10)
    if (d) map.set(d, (map.get(d) ?? 0) + 1)
  }
  return map
}

export function buildHeatmapGrid(today: Date): {
  weeks: HeatCell[][]
  startStr: string
  todayStr: string
} {
  const startDate = startOfWeek(subWeeks(today, 51), { weekStartsOn: 0 })
  const todayStr = format(today, 'yyyy-MM-dd')
  const weeks: HeatCell[][] = []
  let cur = new Date(startDate)

  while (cur <= today || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([])
    const iso = format(cur, 'yyyy-MM-dd')
    weeks[weeks.length - 1].push({ date: new Date(cur), iso, future: iso > todayStr })
    cur = addDays(cur, 1)
    if (weeks.length > 53) break
  }

  while (weeks[weeks.length - 1].length < 7) {
    const last = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1]
    const next = addDays(last.date, 1)
    const iso = format(next, 'yyyy-MM-dd')
    weeks[weeks.length - 1].push({ date: next, iso, future: true })
  }

  return { weeks, startStr: format(startDate, 'yyyy-MM-dd'), todayStr }
}
