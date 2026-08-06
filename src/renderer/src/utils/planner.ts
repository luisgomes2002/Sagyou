import type { TimeBlock } from '../types'
import { todayLocalISO } from './dates'

export type PlannerViewMode = 'day' | 'week' | 'month'

export interface LaidOutTimeBlock {
  block: TimeBlock
  col: number
  cols: number
}

export const MODE_LABELS: Record<PlannerViewMode, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mes'
}

export const HOURS = Array.from({ length: 24 }, (_, index) => index)
export const HOUR_HEIGHT = 80
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']

export function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

export function formatShortDay(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

function localDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function calendarDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export function formatWeekStart(date: string): string {
  const current = calendarDate(date)
  current.setDate(current.getDate() - current.getDay())
  return localDateISO(current)
}

export function addDays(date: string, days: number): string {
  const current = calendarDate(date)
  current.setDate(current.getDate() + days)
  return localDateISO(current)
}

export function addMonths(date: string, months: number): string {
  const current = calendarDate(date)
  current.setMonth(current.getMonth() + months)
  return localDateISO(current)
}

export function todayString(now: Date = new Date()): string {
  return todayLocalISO(now)
}

export function minutesToPixels(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours * 60 + minutes) * (HOUR_HEIGHT / 60)
}

export function durationInMinutes(start: string, end: string): number {
  const [startHours, startMinutes] = start.split(':').map(Number)
  const [endHours, endMinutes] = end.split(':').map(Number)
  return endHours * 60 + endMinutes - (startHours * 60 + startMinutes)
}

export function getVisibleDays(mode: PlannerViewMode, currentDate: string): string[] {
  if (mode === 'day') return [currentDate]

  if (mode === 'week') {
    const weekStart = formatWeekStart(currentDate)
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  }

  const [year, month] = currentDate.split('-')
  const daysInMonth = new Date(Number(year), Number(month), 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    return `${year}-${month}-${String(day).padStart(2, '0')}`
  })
}

export function layoutOverlappingBlocks(blocks: TimeBlock[]): LaidOutTimeBlock[] {
  if (blocks.length === 0) return []

  const sorted = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const groups: TimeBlock[][] = []

  for (const block of sorted) {
    const group = groups.find((candidate) =>
      candidate.some(
        (existing) => block.startTime < existing.endTime && block.endTime > existing.startTime
      )
    )
    if (group) group.push(block)
    else groups.push([block])
  }

  return groups.flatMap((group) => {
    const sortedGroup = [...group].sort((a, b) => {
      const startDifference = a.startTime.localeCompare(b.startTime)
      return (
        startDifference ||
        durationInMinutes(b.startTime, b.endTime) - durationInMinutes(a.startTime, a.endTime)
      )
    })
    const columns: TimeBlock[][] = []

    for (const block of sortedGroup) {
      const column = columns.find((candidate) => block.startTime >= candidate.at(-1)!.endTime)
      if (column) column.push(block)
      else columns.push([block])
    }

    return columns.flatMap((column, col) =>
      column.map((block) => ({ block, col, cols: columns.length }))
    )
  })
}
