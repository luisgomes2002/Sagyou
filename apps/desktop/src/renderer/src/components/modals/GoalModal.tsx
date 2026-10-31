import { useState } from 'react'
import type { Goal, Project } from '../../types'
import { PROJECT_COLORS } from '../../types'
import type { GoalKind } from '../../utils/goals'
import { goalKind } from '../../utils/goals'
import { ModalBase } from '../ModalBase'
import { CancelButton } from '../CancelButton'

interface Props {
  goal?: Goal
  projects: Project[]
  onSave: (data: {
    title: string
    kind: GoalKind
    target: number
    unit: string
    color: string
    projectId?: string
  }) => void
  onClose: () => void
}

export function GoalModal({ goal, projects, onSave, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [kind, setKind] = useState<GoalKind>(goal ? goalKind(goal) : 'completion')
  const [target, setTarget] = useState(goal?.target.toString() ?? '10')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [color, setColor] = useState(goal?.color ?? PROJECT_COLORS[0])
  const [projectId, setProjectId] = useState(goal?.projectId ?? '')

  const isValid = title.trim().length > 0 && (kind === 'completion' || parseFloat(target) > 0)

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!isValid) return
    onSave({
      title: title.trim(),
      kind,
      target: kind === 'completion' ? 1 : parseFloat(target),
      unit: kind === 'completion' ? '' : unit.trim(),
      color,
      projectId: projectId || undefined
    })
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#2b2b31] bg-[#16161a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2b2b31]">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">
            {goal ? 'Editar meta' : 'Nova meta'}
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="goal-title" className="block text-xs font-medium text-[#999999] mb-1.5">
              Título *
            </label>
            <input
              id="goal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'completion' ? 'Ex.: Ler DDD' : 'Ex.: Correr 100 km'}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#2b2b31] bg-[#101014] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-[#999999]">Como medir esta meta?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={kind === 'completion'}
                onClick={() => setKind('completion')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  kind === 'completion'
                    ? 'border-[#7c3aed] bg-[#2a2a30]'
                    : 'border-[#2b2b31] bg-[#101014] hover:bg-[#222227]'
                }`}
              >
                <span className="block text-xs font-semibold text-[#d4d4d4]">Concluir uma vez</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-[#999999]">
                  Para objetivos como “Ler DDD”.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={kind === 'quantity'}
                onClick={() => setKind('quantity')}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  kind === 'quantity'
                    ? 'border-[#7c3aed] bg-[#2a2a30]'
                    : 'border-[#2b2b31] bg-[#101014] hover:bg-[#222227]'
                }`}
              >
                <span className="block text-xs font-semibold text-[#d4d4d4]">
                  Acompanhar quantidade
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-[#999999]">
                  Para livros, quilômetros ou horas.
                </span>
              </button>
            </div>
          </div>

          {kind === 'quantity' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="goal-target"
                  className="block text-xs font-medium text-[#999999] mb-1.5"
                >
                  Quantidade desejada *
                </label>
                <input
                  id="goal-target"
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  min="0.01"
                  step="any"
                  className="w-full px-3 py-2 rounded-lg border border-[#2b2b31] bg-[#101014] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
                />
              </div>
              <div>
                <label
                  htmlFor="goal-unit"
                  className="block text-xs font-medium text-[#999999] mb-1.5"
                >
                  Unidade
                </label>
                <input
                  id="goal-unit"
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="km, livros, horas..."
                  className="w-full px-3 py-2 rounded-lg border border-[#2b2b31] bg-[#101014] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px #16161a, 0 0 0 4px ${c}` : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label
                htmlFor="goal-project"
                className="block text-xs font-medium text-[#999999] mb-1.5"
              >
                Projeto (opcional)
              </label>
              <select
                id="goal-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#2b2b31] bg-[#101014] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                <option value="">Global</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <CancelButton onClick={onClose}>Cancelar</CancelButton>
            <button
              type="submit"
              disabled={!isValid}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {goal ? 'Salvar' : 'Criar meta'}
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  )
}
