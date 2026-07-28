import { useState } from 'react'
import type { Habit } from '../types'

const WEEK_DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d - n)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getStreak(completions: string[], today: string): number {
  const set = new Set(completions)
  let current = set.has(today) ? today : subtractDays(today, 1)
  let streak = 0
  while (set.has(current)) {
    streak++
    current = subtractDays(current, 1)
  }
  return streak
}

export function getMonthDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay()
  const days: (string | null)[] = Array(startPad).fill(null)
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (days.length % 7 !== 0) days.push(null)
  return days
}

interface CalendarProps {
  habit: Habit
  today: string
  year: number
  month: number
  onToggle: (date: string) => void
}

function HabitCalendar({ habit, today, year, month, onToggle }: CalendarProps) {
  const completionSet = new Set(habit.completions)
  const days = getMonthDays(year, month)

  return (
    <div className="mt-3">
      <div className="grid grid-cols-7 gap-px mb-1">
        {WEEK_DAYS.map((d, i) => (
          <div key={i} className="text-[9px] text-center text-[#999999] font-medium select-none">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map((date, i) => {
          if (!date) return <div key={i} className="aspect-square" />
          const done = completionSet.has(date)
          const isToday = date === today
          const isFuture = date > today
          const dayNum = parseInt(date.split('-')[2])

          return (
            <button
              key={date}
              disabled={isFuture}
              onClick={() => onToggle(date)}
              title={date}
              className={`aspect-square rounded-sm flex items-center justify-center text-[8px] font-medium transition-colors select-none ${
                isFuture ? 'cursor-default opacity-15' : 'cursor-pointer hover:opacity-80 active:scale-90'
              }`}
              style={{
                backgroundColor: done ? habit.color : '#3b3b3b',
                opacity: isFuture ? 0.15 : done ? 1 : 0.45,
                color: done ? 'rgba(0,0,0,0.55)' : '#999999',
                ...(isToday && !isFuture
                  ? { outline: `2px solid ${habit.color}`, outlineOffset: '1px', opacity: done ? 1 : 0.7 }
                  : {})
              }}
            >
              {dayNum}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  habit: Habit
  today: string
  year: number
  month: number
  onToggle: (date: string) => void
  onEdit: () => void
  onDelete: () => void
}

export function HabitCard({ habit, today, year, month, onToggle, onEdit, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  const completionSet = new Set(habit.completions)
  const isDoneToday = completionSet.has(today)
  const streak = getStreak(habit.completions, today)
  const totalDone = habit.completions.length

  return (
    <div className="group rounded-xl border border-[#3b3b3b] bg-[#2a2a2a] p-4 hover:border-[#555555] transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: habit.color }} />
          <span className="text-sm font-medium text-[#d4d4d4] truncate">{habit.name}</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-[#555555] hover:text-[#999999] hover:bg-[#3b3b3b] transition-colors opacity-0 group-hover:opacity-100"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="1" fill="currentColor" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="12" cy="19" r="1" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-20 w-32 rounded-lg border border-[#3b3b3b] bg-[#232323] shadow-xl py-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
                  onClick={() => { setMenuOpen(false); onEdit() }}
                >
                  Editar
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
                  onClick={() => { setMenuOpen(false); onDelete() }}
                >
                  Deletar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <HabitCalendar habit={habit} today={today} year={year} month={month} onToggle={onToggle} />

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={streak > 0 ? habit.color : '#999999'} strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span className="text-xs font-semibold tabular-nums" style={{ color: streak > 0 ? habit.color : '#999999' }}>
              {streak}d
            </span>
          </div>
          <span className="text-[10px] text-[#999999]">{totalDone} total</span>
        </div>

        <button
          onClick={() => onToggle(today)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all"
          style={
            isDoneToday
              ? { backgroundColor: `${habit.color}18`, borderColor: `${habit.color}40`, color: habit.color }
              : { backgroundColor: 'transparent', borderColor: '#3b3b3b', color: '#999999' }
          }
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isDoneToday ? 3 : 2}>
            {isDoneToday ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </>
            )}
          </svg>
          {isDoneToday ? 'Feito hoje' : 'Check-in'}
        </button>
      </div>
    </div>
  )
}
