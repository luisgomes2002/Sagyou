import { useState } from 'react'
import type { Habit } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'
import { HabitModal } from './HabitModal'
import { HabitCard } from './HabitCard'

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

function getToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function HabitView() {
  const habits = useKanbanStore((s) => s.habits)
  const createHabit = useKanbanStore((s) => s.createHabit)
  const updateHabit = useKanbanStore((s) => s.updateHabit)
  const deleteHabit = useKanbanStore((s) => s.deleteHabit)
  const toggleHabit = useKanbanStore((s) => s.toggleHabit)

  const [showModal, setShowModal] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [confirm, setConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

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

  const handleEditSave = (data: { name: string; color: string }) => {
    if (editingHabit) updateHabit(editingHabit.id, data)
    setEditingHabit(null)
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3b3b3b] shrink-0">
          <div className="flex items-center gap-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#20b858" strokeWidth="2">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <h1 className="text-base font-semibold text-[#d4d4d4]">Hábitos</h1>
            {habits.length > 0 && (
              <span className="text-xs text-[#999999]">{doneToday}/{habits.length} hoje</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {habits.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="text-xs font-medium text-[#d4d4d4] w-32 text-center select-none">
                  {MONTHS_PT[viewMonth]} {viewYear}
                </span>
                <button
                  onClick={handleNextMonth}
                  disabled={isCurrentMonth}
                  className="p-1.5 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}

            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#20b858]/90 text-sm text-white font-medium hover:bg-[#2e7a48] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Novo hábito
            </button>
          </div>
        </div>

        {habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#d4d4d4] font-medium mb-1">Nenhum hábito ainda</p>
              <p className="text-sm text-[#999999]">Crie hábitos e faça check-in diariamente</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-lg bg-[#20b858]/90 text-sm text-white font-medium hover:bg-[#2e7a48] transition-colors"
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
                  onEdit={() => setEditingHabit(habit)}
                  onDelete={() => setConfirm({ open: true, id: habit.id })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showModal && <HabitModal onSave={handleSave} onClose={() => setShowModal(false)} />}

      {editingHabit && (
        <HabitModal habit={editingHabit} onSave={handleEditSave} onClose={() => setEditingHabit(null)} />
      )}

      <ConfirmDialog
        open={confirm.open}
        title="Deletar hábito"
        message="Tem certeza? O histórico de conclusões será perdido."
        confirmLabel="Deletar"
        onConfirm={() => { if (confirm.id) deleteHabit(confirm.id); setConfirm({ open: false, id: null }) }}
        onCancel={() => setConfirm({ open: false, id: null })}
      />
    </>
  )
}
