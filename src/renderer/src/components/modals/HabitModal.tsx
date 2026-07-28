import { useState } from 'react'
import type { Habit } from '../../types'
import { PROJECT_COLORS } from '../../types'
import { ModalBase } from '../ModalBase'
import { CancelButton } from '../CancelButton'

interface Props {
  habit?: Habit
  onSave: (data: { name: string; color: string }) => void
  onClose: () => void
}

export function HabitModal({ habit, onSave, onClose }: Props) {
  const [name, setName] = useState(habit?.name ?? '')
  const [color, setColor] = useState<string>(habit?.color ?? PROJECT_COLORS[0])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), color })
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-full max-w-xs mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b]">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">{habit ? 'Editar hábito' : 'Novo hábito'}</h2>
          <button onClick={onClose} className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Nome *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Exercitar-se, Leitura..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
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

          <div className="flex justify-end gap-3 pt-1">
            <CancelButton onClick={onClose}>Cancelar</CancelButton>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {habit ? 'Salvar' : 'Criar hábito'}
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  )
}
