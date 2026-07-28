import { useState, useEffect } from 'react'
import type { Column } from '../types'
import { PROJECT_COLORS } from '../types'

interface Props {
  open: boolean
  column?: Column
  onSave: (name: string, color: string | undefined) => void
  onClose: () => void
}

export function ColumnModal({ open, column, onSave, onClose }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setName(column?.name ?? '')
      setColor(column?.color)
    }
  }, [open, column])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), color)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#3b3b3b]">
          <h2 className="text-base font-semibold text-[#d4d4d4]">
            {column ? 'Editar coluna' : 'Nova coluna'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
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
              placeholder="Ex: Em andamento"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setColor(undefined)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110 border border-dashed border-[#555555] flex items-center justify-center"
                style={{
                  outline: color === undefined ? '2px solid #999999' : 'none',
                  outlineOffset: '2px'
                }}
                title="Padrão (cor do projeto)"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: '2px'
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {column ? 'Salvar' : 'Criar coluna'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
