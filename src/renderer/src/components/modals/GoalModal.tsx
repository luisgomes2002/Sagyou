import { useState } from 'react'
import type { Goal, Project } from '../../types'
import { PROJECT_COLORS } from '../../types'
import { ModalBase } from '../ModalBase'
import { CancelButton } from '../CancelButton'

interface Props {
  goal?: Goal
  projects: Project[]
  onSave: (data: { title: string; target: number; unit: string; color: string; projectId?: string }) => void
  onClose: () => void
}

export function GoalModal({ goal, projects, onSave, onClose }: Props) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [target, setTarget] = useState(goal?.target.toString() ?? '10')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [color, setColor] = useState(goal?.color ?? PROJECT_COLORS[0])
  const [projectId, setProjectId] = useState(goal?.projectId ?? '')

  const isValid = title.trim().length > 0 && parseFloat(target) > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    onSave({ title: title.trim(), target: parseFloat(target), unit: unit.trim(), color, projectId: projectId || undefined })
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b]">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">{goal ? 'Editar meta' : 'Nova meta'}</h2>
          <button onClick={onClose} className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ler 10 livros, Correr 100km..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Meta *</label>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                min="0.01"
                step="any"
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Unidade</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="km, livros, horas..."
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px #232323, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Projeto (opcional)</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                <option value="">Global</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
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
