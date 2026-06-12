import { useEffect, useState } from 'react'
import type { Goal, Project } from '../types'
import { PROJECT_COLORS } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  projects: Project[]
}

// ── GoalModal ─────────────────────────────────────────────────────────────────

interface ModalProps {
  goal?: Goal
  projects: Project[]
  onSave: (data: { title: string; target: number; current: number; unit: string; color: string; projectId?: string }) => void
  onClose: () => void
}

function GoalModal({ goal, projects, onSave, onClose }: ModalProps) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [target, setTarget] = useState(goal?.target.toString() ?? '10')
  const [current, setCurrent] = useState(goal?.current.toString() ?? '0')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [color, setColor] = useState(goal?.color ?? PROJECT_COLORS[0])
  const [projectId, setProjectId] = useState(goal?.projectId ?? '')

  const isValid = title.trim().length > 0 && parseFloat(target) > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    const targetNum = parseFloat(target)
    const currentNum = parseFloat(current)
    onSave({
      title: title.trim(),
      target: targetNum,
      current: isNaN(currentNum) ? 0 : Math.min(Math.max(0, currentNum), targetNum),
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
              placeholder="Ex: Correr 100km este mês"
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
                placeholder="km, livros..."
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
          </div>

          {goal && (
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Progresso atual</label>
              <input
                type="number"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                min="0"
                step="any"
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
          )}

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
  onIncrement: (amount: number) => void
  onSetCurrent: (value: number) => void
}

function GoalCard({ goal, projectName, onEdit, onDelete, onIncrement, onSetCurrent }: CardProps) {
  const [inputVal, setInputVal] = useState(goal.current.toString())
  const [inputFocused, setInputFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!inputFocused) setInputVal(goal.current.toString())
  }, [goal.current, inputFocused])

  const percent = goal.target > 0 ? Math.min((goal.current / goal.target) * 100, 100) : 0
  const isComplete = goal.current >= goal.target

  const handleInputBlur = () => {
    setInputFocused(false)
    const val = parseFloat(inputVal)
    if (!isNaN(val) && val >= 0) {
      onSetCurrent(Math.min(val, goal.target))
    } else {
      setInputVal(goal.current.toString())
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    if (e.key === 'Escape') { setInputVal(goal.current.toString()); (e.target as HTMLInputElement).blur() }
  }

  const unitLabel = goal.unit ? ` ${goal.unit}` : ''

  return (
    <div className="group rounded-xl border border-[#2a2d42] bg-[#1e2235] p-4 hover:border-[#3a3e58] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: goal.color }} />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[#e2e8f0] leading-snug truncate">{goal.title}</h3>
            {projectName && (
              <p className="text-[10px] text-[#8892a4] mt-0.5 truncate">{projectName}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isComplete && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#22c55e]/15 text-[#22c55e]">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Concluída
            </span>
          )}
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
                    className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                    onClick={() => { setMenuOpen(false); onEdit() }}
                  >
                    Editar
                  </button>
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
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#8892a4]">
            {goal.current}{unitLabel} / {goal.target}{unitLabel}
          </span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: isComplete ? '#22c55e' : goal.color }}>
            {Math.round(percent)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#2a2d42] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${percent}%`, backgroundColor: isComplete ? '#22c55e' : goal.color }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onIncrement(-1)}
          disabled={goal.current <= 0}
          className="p-1.5 rounded-lg border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:border-[#3a3e58] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <input
          type="number"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          min="0"
          max={goal.target}
          step="any"
          className="flex-1 px-2 py-1.5 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-xs text-center text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors tabular-nums"
        />

        <button
          onClick={() => onIncrement(1)}
          disabled={isComplete}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: isComplete ? '#2a2d42' : `${goal.color}60`,
            color: isComplete ? '#8892a4' : goal.color,
            backgroundColor: isComplete ? 'transparent' : `${goal.color}12`
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          1
        </button>
      </div>
    </div>
  )
}

// ── GoalView ──────────────────────────────────────────────────────────────────

interface ModalState {
  open: boolean
  goal?: Goal
}

export function GoalView({ projects }: Props) {
  const goals = useKanbanStore((s) => s.goals)
  const createGoal = useKanbanStore((s) => s.createGoal)
  const updateGoal = useKanbanStore((s) => s.updateGoal)
  const deleteGoal = useKanbanStore((s) => s.deleteGoal)
  const incrementGoal = useKanbanStore((s) => s.incrementGoal)

  const [modal, setModal] = useState<ModalState>({ open: false })
  const [confirm, setConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]))

  const handleSave = (data: { title: string; target: number; current: number; unit: string; color: string; projectId?: string }) => {
    if (modal.goal) {
      const { current: _c, ...rest } = data
      updateGoal(modal.goal.id, { ...rest, current: data.current })
    } else {
      const { current: _c, ...rest } = data
      createGoal(rest)
    }
    setModal({ open: false })
  }

  const completedCount = goals.filter((g) => g.current >= g.target).length

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
            {goals.length > 0 && (
              <span className="text-xs text-[#8892a4]">
                {completedCount}/{goals.length} concluída{goals.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova meta
          </button>
        </div>

        {/* Content */}
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#1e2235] border border-[#2a2d42] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#e2e8f0] font-medium mb-1">Nenhuma meta ainda</p>
              <p className="text-sm text-[#8892a4]">Crie metas para acompanhar seu progresso</p>
            </div>
            <button
              onClick={() => setModal({ open: true })}
              className="px-4 py-2 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] transition-colors"
            >
              Criar meta
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-4">
              {goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  projectName={goal.projectId ? projectMap[goal.projectId] : undefined}
                  onEdit={() => setModal({ open: true, goal })}
                  onDelete={() => setConfirm({ open: true, id: goal.id })}
                  onIncrement={(amount) => incrementGoal(goal.id, amount)}
                  onSetCurrent={(value) => updateGoal(goal.id, { current: value })}
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
        onConfirm={() => { if (confirm.id) deleteGoal(confirm.id); setConfirm({ open: false, id: null }) }}
        onCancel={() => setConfirm({ open: false, id: null })}
      />
    </>
  )
}
