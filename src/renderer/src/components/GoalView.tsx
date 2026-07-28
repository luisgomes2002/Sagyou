import { useState } from 'react'
import type { Goal, Project } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'
import { GoalModal } from './GoalModal'
import { GoalCard } from './GoalCard'

interface Props {
  projects: Project[]
}

type FilterType = 'all' | 'active' | 'done'

interface ModalState {
  open: boolean
  goal?: Goal
}

export function GoalView({ projects }: Props) {
  const goals = useKanbanStore((s) => s.goals)
  const createGoal = useKanbanStore((s) => s.createGoal)
  const updateGoal = useKanbanStore((s) => s.updateGoal)
  const deleteGoal = useKanbanStore((s) => s.deleteGoal)
  const addGoalEntry = useKanbanStore((s) => s.addGoalEntry)
  const deleteGoalEntry = useKanbanStore((s) => s.deleteGoalEntry)

  const [modal, setModal] = useState<ModalState>({ open: false })
  const [confirm, setConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [filter, setFilter] = useState<FilterType>('all')

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]))

  const goalCurrent = (g: Goal) => g.entries.reduce((sum, e) => sum + e.value, 0)

  const handleSave = (data: { title: string; target: number; unit: string; color: string; projectId?: string }) => {
    if (modal.goal) {
      updateGoal(modal.goal.id, data)
    } else {
      createGoal(data)
    }
    setModal({ open: false })
  }

  const completedCount = goals.filter((g) => goalCurrent(g) >= g.target).length
  const activeCount = goals.length - completedCount
  const overallPct = goals.length > 0
    ? Math.round(goals.reduce((sum, g) => sum + Math.min(goalCurrent(g) / Math.max(g.target, 1), 1), 0) / goals.length * 100)
    : 0

  const filtered = goals
    .filter((g) => {
      const done = goalCurrent(g) >= g.target
      if (filter === 'active') return !done
      if (filter === 'done') return done
      return true
    })
    .sort((a, b) => {
      const aDone = goalCurrent(a) >= a.target ? 1 : 0
      const bDone = goalCurrent(b) >= b.target ? 1 : 0
      if (aDone !== bDone) return aDone - bDone
      const aPct = a.target > 0 ? goalCurrent(a) / a.target : 0
      const bPct = b.target > 0 ? goalCurrent(b) / b.target : 0
      return bPct - aPct
    })

  const filterLabels: Record<FilterType, string> = {
    all: `Todas (${goals.length})`,
    active: `Em progresso (${activeCount})`,
    done: `Concluídas (${completedCount})`,
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3b3b3b] shrink-0">
          <div className="flex items-center gap-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <h1 className="text-base font-semibold text-[#d4d4d4]">Metas</h1>
          </div>
          <button
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova meta
          </button>
        </div>

        {goals.length > 0 && (
          <div className="px-6 py-3 border-b border-[#3b3b3b] bg-[#232323] shrink-0">
            <div className="flex items-center gap-4 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#20b858]" />
                <span className="text-[11px] text-[#999999]">{completedCount} concluída{completedCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#7c3aed]" />
                <span className="text-[11px] text-[#999999]">{activeCount} em progresso</span>
              </div>
              <span className="text-[11px] font-semibold text-[#a080f0] ml-auto tabular-nums">{overallPct}% médio</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#3b3b3b] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${overallPct}%`, backgroundColor: overallPct === 100 ? '#20b858' : '#7c3aed' }}
              />
            </div>
          </div>
        )}

        {goals.length > 0 && (
          <div className="flex items-center gap-1 px-6 py-2 border-b border-[#3b3b3b] bg-[#232323] shrink-0">
            {(['all', 'active', 'done'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  filter === f ? 'bg-[#3b3b3b] text-[#d4d4d4]' : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
                }`}
              >
                {filterLabels[f]}
              </button>
            ))}
          </div>
        )}

        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <svg className="absolute inset-0 -m-2 opacity-20" width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="40" fill="none" stroke="#7c3aed" strokeWidth="1" strokeDasharray="4 6" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#d4d4d4] font-semibold mb-1.5">Você ainda não criou nenhuma meta</p>
              <p className="text-sm text-[#999999] max-w-xs leading-relaxed">
                Crie metas e registre cada progresso com data e descrição — livros lidos, km corridos, horas estudadas.
              </p>
            </div>
            <button
              onClick={() => setModal({ open: true })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Criar primeira meta
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2">
            <p className="text-sm text-[#999999]">
              Nenhuma meta {filter === 'active' ? 'em progresso' : 'concluída'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-4">
              {filtered.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  projectName={goal.projectId ? projectMap[goal.projectId] : undefined}
                  onEdit={() => setModal({ open: true, goal })}
                  onDelete={() => setConfirm({ open: true, id: goal.id })}
                  onAddEntry={(data) => addGoalEntry(goal.id, data)}
                  onDeleteEntry={(entryId) => deleteGoalEntry(goal.id, entryId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {modal.open && (
        <GoalModal
          goal={modal.goal}
          projects={projects}
          onSave={handleSave}
          onClose={() => setModal({ open: false })}
        />
      )}

      <ConfirmDialog
        open={confirm.open}
        title="Deletar meta"
        message="Tem certeza que deseja deletar esta meta?"
        confirmLabel="Deletar"
        onConfirm={() => {
          if (confirm.id) deleteGoal(confirm.id)
          setConfirm({ open: false, id: null })
        }}
        onCancel={() => setConfirm({ open: false, id: null })}
      />
    </>
  )
}
