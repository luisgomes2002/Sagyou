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
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d42]">
          <h2 className="text-base font-semibold text-[#e2e8f0]">
            {column ? 'Editar coluna' : 'Nova coluna'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
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
              placeholder="Ex: Em andamento"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8892a4] mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setColor(undefined)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110 border border-dashed border-[#3a3e58] flex items-center justify-center"
                style={{
                  outline: color === undefined ? '2px solid #8892a4' : 'none',
                  outlineOffset: '2px'
                }}
                title="Padrão (cor do projeto)"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2.5">
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
              className="px-4 py-2 text-sm rounded-lg border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#6366f1] text-white font-medium hover:bg-[#5254c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {column ? 'Salvar' : 'Criar coluna'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
