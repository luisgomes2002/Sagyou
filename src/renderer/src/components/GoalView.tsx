import { useState } from 'react'
import type { Goal, GoalEntry, Project } from '../types'
import { PROJECT_COLORS } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  projects: Project[]
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString()

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y?.slice(-2)}`
}

// ── GoalModal ─────────────────────────────────────────────────────────────────

interface ModalProps {
  goal?: Goal
  projects: Project[]
  onSave: (data: { title: string; target: number; unit: string; color: string; projectId?: string }) => void
  onClose: () => void
}

function GoalModal({ goal, projects, onSave, onClose }: ModalProps) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [target, setTarget] = useState(goal?.target.toString() ?? '10')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [color, setColor] = useState(goal?.color ?? PROJECT_COLORS[0])
  const [projectId, setProjectId] = useState(goal?.projectId ?? '')

  const isValid = title.trim().length > 0 && parseFloat(target) > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    onSave({
      title: title.trim(),
      target: parseFloat(target),
      unit: unit.trim(),
      color,
      projectId: projectId || undefined
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42]">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">{goal ? 'Editar meta' : 'Nova meta'}</h2>
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
            <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ler 10 livros, Correr 100km..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Meta *</label>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                min="0.01"
                step="any"
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Unidade</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="km, livros, horas..."
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
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
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px #13151f, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Projeto (opcional)</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors"
              >
                <option value="">Global</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

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
              disabled={!isValid}
              className="px-4 py-2 text-sm rounded-lg bg-[#6366f1] text-white font-medium hover:bg-[#5254c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {goal ? 'Salvar' : 'Criar meta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── GoalCard ──────────────────────────────────────────────────────────────────

interface CardProps {
  goal: Goal
  projectName?: string
  onEdit: () => void
  onDelete: () => void
  onAddEntry: (data: { date: string; label?: string; value: number }) => void
  onDeleteEntry: (entryId: string) => void
}

function GoalCard({ goal, projectName, onEdit, onDelete, onAddEntry, onDeleteEntry }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(todayISO)
  const [entryLabel, setEntryLabel] = useState('')
  const [entryValue, setEntryValue] = useState('1')
  const [showAll, setShowAll] = useState(false)

  const current = goal.entries.reduce((sum, e) => sum + e.value, 0)
  const percent = goal.target > 0 ? Math.min((current / goal.target) * 100, 100) : 0
  const isComplete = current >= goal.target
  const remaining = Math.max(goal.target - current, 0)
  const unitSuffix = goal.unit ? ` ${goal.unit}` : ''
  const ringColor = isComplete ? '#22c55e' : goal.color

  const R = 32
  const circ = 2 * Math.PI * R

  const sortedEntries: GoalEntry[] = [...goal.entries].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date)
    return b.createdAt.localeCompare(a.createdAt)
  })
  const COLLAPSED_LIMIT = 4
  const visibleEntries = showAll ? sortedEntries : sortedEntries.slice(0, COLLAPSED_LIMIT)
  const hiddenCount = sortedEntries.length - visibleEntries.length

  const handleAddEntry = () => {
    const val = parseFloat(entryValue)
    if (isNaN(val) || val <= 0) return
    onAddEntry({ date: entryDate, label: entryLabel.trim() || undefined, value: val })
    setEntryLabel('')
    setEntryValue('1')
    setAddOpen(false)
  }

  const openAdd = () => {
    setEntryDate(todayISO())
    setEntryLabel('')
    setEntryValue('1')
    setAddOpen(true)
  }

  const unitLabel = goal.unit
    ? goal.unit.charAt(0).toUpperCase() + goal.unit.slice(1)
    : 'Qtd'

  return (
    <div className="group rounded-xl border border-[#2a2d42] bg-[#1e2235] overflow-hidden hover:border-[#3a3e58] transition-all duration-200">
      <div className="h-[3px]" style={{ backgroundColor: ringColor, opacity: isComplete ? 1 : 0.55 }} />

      <div className="p-4">
        {/* Ring + title */}
        <div className="flex items-start gap-4 mb-4">
          <div className="relative shrink-0 w-20 h-20">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r={R} fill="none" stroke="#2a2d42" strokeWidth="5.5" />
              <circle
                cx="40" cy="40" r={R}
                fill="none"
                stroke={ringColor}
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeDasharray={`${(percent / 100) * circ} ${circ}`}
                transform="rotate(-90 40 40)"
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
              <span className="text-base font-bold tabular-nums leading-none" style={{ color: ringColor }}>
                {Math.round(percent)}%
              </span>
              {isComplete && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ringColor} strokeWidth="3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#e2e8f0] leading-snug">{goal.title}</h3>
                {projectName && <p className="text-[10px] text-[#8892a4] mt-0.5 truncate">{projectName}</p>}
              </div>
              <div className="relative shrink-0">
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
                    <div className="absolute right-0 top-7 z-20 w-28 rounded-lg border border-[#2a2d42] bg-[#13151f] shadow-xl py-1">
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                        onClick={() => { setMenuOpen(false); onEdit() }}
                      >Editar</button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                        onClick={() => { setMenuOpen(false); onDelete() }}
                      >Deletar</button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: ringColor }}>
                {fmtNum(current)}
              </span>
              {goal.unit && <span className="text-sm text-[#8892a4]">{goal.unit}</span>}
              <span className="text-xs text-[#3a3e58] mx-0.5">/</span>
              <span className="text-sm font-medium text-[#8892a4] tabular-nums">{fmtNum(goal.target)}{unitSuffix}</span>
            </div>

            {isComplete ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] text-[10px] font-semibold">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Concluída
              </span>
            ) : (
              <p className="text-[10px] text-[#8892a4]">
                Faltam <span className="text-[#e2e8f0] font-semibold tabular-nums">{fmtNum(remaining)}{unitSuffix}</span>
              </p>
            )}
          </div>
        </div>

        {/* History section */}
        <div className="border-t border-[#2a2d42] pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Histórico</span>
            {addOpen ? (
              <button
                onClick={() => setAddOpen(false)}
                className="text-[10px] text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
              >
                Cancelar
              </button>
            ) : (
              <button
                onClick={openAdd}
                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors"
                style={{ color: goal.color, backgroundColor: `${goal.color}15` }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Registrar
              </button>
            )}
          </div>

          {/* Add entry form */}
          {addOpen && (
            <div className="mb-2 p-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-[#8892a4] mb-1">Data</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-[#2a2d42] bg-[#1e2235] text-xs text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-[10px] text-[#8892a4] mb-1">{unitLabel}</label>
                  <input
                    type="number"
                    value={entryValue}
                    onChange={(e) => setEntryValue(e.target.value)}
                    min="0.01"
                    step="any"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddEntry() }}
                    autoFocus
                    className="w-full px-2 py-1 rounded border border-[#2a2d42] bg-[#1e2235] text-xs text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#8892a4] mb-1">Descrição (opcional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={entryLabel}
                    onChange={(e) => setEntryLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddEntry() }}
                    placeholder={
                      goal.unit === 'livros' || goal.unit === 'livro'
                        ? 'Nome do livro...'
                        : goal.unit === 'km'
                          ? 'Ex: Parque Ibirapuera...'
                          : 'Observação...'
                    }
                    className="flex-1 px-2 py-1 rounded border border-[#2a2d42] bg-[#1e2235] text-xs text-[#e2e8f0] placeholder-[#3a3e58] focus:outline-none focus:border-[#6366f1] transition-colors"
                  />
                  <button
                    onClick={handleAddEntry}
                    disabled={!entryValue || parseFloat(entryValue) <= 0}
                    className="px-3 py-1 rounded text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ backgroundColor: goal.color }}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Entry list */}
          {sortedEntries.length === 0 ? (
            <p className="text-xs text-[#3a3e58] text-center py-3">Nenhum registro ainda</p>
          ) : (
            <div className="space-y-0.5">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="group/entry flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#2a2d42] transition-colors"
                >
                  <span className="text-[10px] text-[#8892a4] shrink-0 tabular-nums w-10">{fmtDate(entry.date)}</span>
                  {entry.label ? (
                    <span className="flex-1 text-xs text-[#c8cdd8] truncate">{entry.label}</span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: ringColor }}>
                    +{fmtNum(entry.value)}{unitSuffix}
                  </span>
                  <button
                    onClick={() => onDeleteEntry(entry.id)}
                    title="Remover entrada"
                    className="opacity-0 group-hover/entry:opacity-100 p-0.5 rounded text-[#8892a4] hover:text-red-400 transition-all shrink-0"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}

              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full text-[10px] text-[#8892a4] hover:text-[#e2e8f0] text-center py-1 transition-colors"
                >
                  ver mais {hiddenCount} entrada{hiddenCount !== 1 ? 's' : ''}
                </button>
              )}
              {showAll && sortedEntries.length > COLLAPSED_LIMIT && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full text-[10px] text-[#8892a4] hover:text-[#e2e8f0] text-center py-1 transition-colors"
                >
                  mostrar menos
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── GoalView ──────────────────────────────────────────────────────────────────

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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <h1 className="text-base font-semibold text-[#e2e8f0]">Metas</h1>
          </div>
          <button
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova meta
          </button>
        </div>

        {/* Stats strip */}
        {goals.length > 0 && (
          <div className="px-6 py-3 border-b border-[#2a2d42] bg-[#0f1120] shrink-0">
            <div className="flex items-center gap-4 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                <span className="text-[11px] text-[#8892a4]">{completedCount} concluída{completedCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#6366f1]" />
                <span className="text-[11px] text-[#8892a4]">{activeCount} em progresso</span>
              </div>
              <span className="text-[11px] font-semibold text-[#a5b4fc] ml-auto tabular-nums">{overallPct}% médio</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#2a2d42] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${overallPct}%`, backgroundColor: overallPct === 100 ? '#22c55e' : '#6366f1' }}
              />
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {goals.length > 0 && (
          <div className="flex items-center gap-1 px-6 py-2 border-b border-[#2a2d42] bg-[#0f1120] shrink-0">
            {(['all', 'active', 'done'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-[#2a2d42] text-[#e2e8f0]'
                    : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
                }`}
              >
                {filterLabels[f]}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-[#1e2235] border border-[#2a2d42] flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3a3e58" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <svg className="absolute inset-0 -m-2 opacity-20" width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="40" fill="none" stroke="#6366f1" strokeWidth="1" strokeDasharray="4 6" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#e2e8f0] font-semibold mb-1.5">Nenhuma meta criada</p>
              <p className="text-sm text-[#8892a4] max-w-xs leading-relaxed">
                Crie metas e registre cada progresso com data e descrição — livros lidos, km corridos, horas estudadas.
              </p>
            </div>
            <button
              onClick={() => setModal({ open: true })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Criar primeira meta
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2">
            <p className="text-sm text-[#8892a4]">
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
