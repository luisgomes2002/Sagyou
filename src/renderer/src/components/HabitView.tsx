import { useState } from 'react'
import type { Habit } from '../types'
import { PROJECT_COLORS } from '../types'
import { useKanbanStore } from '../store/kanban'

// ── Date utilities ────────────────────────────────────────────────────────────

function getToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d - n)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getStreak(completions: string[], today: string): number {
  const set = new Set(completions)
  let current = set.has(today) ? today : subtractDays(today, 1)
  let streak = 0
  while (set.has(current)) {
    streak++
    current = subtractDays(current, 1)
  }
  return streak
}

function getMonthDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay() // 0=Dom
  const days: (string | null)[] = Array(startPad).fill(null)
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (days.length % 7 !== 0) days.push(null)
  return days
}

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]
const WEEK_DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// ── HabitModal ────────────────────────────────────────────────────────────────

interface ModalProps {
  onSave: (data: { name: string; color: string }) => void
  onClose: () => void
}

function HabitModal({ onSave, onClose }: ModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), color })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xs mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42]">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Novo hábito</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Nome *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Exercitar-se, Leitura..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8892a4] mb-2">Cor</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px #13151f, 0 0 0 4px ${c}` : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#6366f1] text-white font-medium hover:bg-[#5254c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Criar hábito
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── HabitCalendar ─────────────────────────────────────────────────────────────

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
          <div key={i} className="text-[9px] text-center text-[#8892a4] font-medium select-none">{d}</div>
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
                isFuture
                  ? 'cursor-default opacity-15'
                  : 'cursor-pointer hover:opacity-80 active:scale-90'
              }`}
              style={{
                backgroundColor: done ? habit.color : '#2a2d42',
                opacity: isFuture ? 0.15 : done ? 1 : 0.45,
                color: done ? 'rgba(0,0,0,0.55)' : '#8892a4',
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

// ── HabitCard ─────────────────────────────────────────────────────────────────

interface CardProps {
  habit: Habit
  today: string
  year: number
  month: number
  onToggle: (date: string) => void
  onDelete: () => void
}

function HabitCard({ habit, today, year, month, onToggle, onDelete }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const completionSet = new Set(habit.completions)
  const isDoneToday = completionSet.has(today)
  const streak = getStreak(habit.completions, today)
  const totalDone = habit.completions.length

  return (
    <div className="group rounded-xl border border-[#2a2d42] bg-[#1e2235] p-4 hover:border-[#3a3e58] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: habit.color }} />
          <span className="text-sm font-medium text-[#e2e8f0] truncate">{habit.name}</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-[#3a3e58] hover:text-[#8892a4] hover:bg-[#2a2d42] transition-colors opacity-0 group-hover:opacity-100"
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
              <div className="absolute right-0 top-7 z-20 w-32 rounded-lg border border-[#2a2d42] bg-[#13151f] shadow-xl py-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                  onClick={() => { setMenuOpen(false); onDelete() }}
                >
                  Deletar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Calendar */}
      <HabitCalendar
        habit={habit}
        today={today}
        year={year}
        month={month}
        onToggle={onToggle}
      />

      {/* Footer: streak + check-in */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={streak > 0 ? habit.color : '#8892a4'} strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span className="text-xs font-semibold tabular-nums" style={{ color: streak > 0 ? habit.color : '#8892a4' }}>
              {streak}d
            </span>
          </div>
          <span className="text-[10px] text-[#8892a4]">{totalDone} total</span>
        </div>

        <button
          onClick={() => onToggle(today)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all"
          style={
            isDoneToday
              ? { backgroundColor: `${habit.color}18`, borderColor: `${habit.color}40`, color: habit.color }
              : { backgroundColor: 'transparent', borderColor: '#2a2d42', color: '#8892a4' }
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

// ── HabitView ─────────────────────────────────────────────────────────────────

export function HabitView() {
  const habits = useKanbanStore((s) => s.habits)
  const createHabit = useKanbanStore((s) => s.createHabit)
  const deleteHabit = useKanbanStore((s) => s.deleteHabit)
  const toggleHabit = useKanbanStore((s) => s.toggleHabit)

  const [showModal, setShowModal] = useState(false)

  const today = getToday()
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth()
  const doneToday = habits.filter((h) => h.completions.includes(today)).length

  const handlePrevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) }
    else setViewMonth((m) => m - 1)
  }

  const handleNextMonth = () => {
    if (isCurrentMonth) return
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) }
    else setViewMonth((m) => m + 1)
  }

  const handleSave = (data: { name: string; color: string }) => {
    createHabit(data)
    setShowModal(false)
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <h1 className="text-base font-semibold text-[#e2e8f0]">Hábitos</h1>
            {habits.length > 0 && (
              <span className="text-xs text-[#8892a4]">{doneToday}/{habits.length} hoje</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {habits.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="text-xs font-medium text-[#e2e8f0] w-32 text-center select-none">
                  {MONTHS_PT[viewMonth]} {viewYear}
                </span>
                <button
                  onClick={handleNextMonth}
                  disabled={isCurrentMonth}
                  className="p-1.5 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}

            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22c55e]/90 text-sm text-white font-medium hover:bg-[#16a34a] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Novo hábito
            </button>
          </div>
        </div>

        {/* Content */}
        {habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#1e2235] border border-[#2a2d42] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="1.5">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#e2e8f0] font-medium mb-1">Nenhum hábito ainda</p>
              <p className="text-sm text-[#8892a4]">Crie hábitos e faça check-in diariamente</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-lg bg-[#22c55e]/90 text-sm text-white font-medium hover:bg-[#16a34a] transition-colors"
            >
              Criar hábito
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-4">
              {habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  today={today}
                  year={viewYear}
                  month={viewMonth}
                  onToggle={(date) => toggleHabit(habit.id, date)}
                  onDelete={() => deleteHabit(habit.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <HabitModal onSave={handleSave} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}
