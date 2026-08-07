import { useState } from 'react'
import type { FinancialTable, FinancialProfile, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'

interface SidebarProps {
  lists: FinancialTable[]
  profiles: FinancialProfile[]
  activeProfileId: string
  onSelectProfile: (id: string) => void
  onCreateProfile: (name: string) => void
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, currency: Currency) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function TableSidebar({
  lists,
  profiles,
  activeProfileId,
  onSelectProfile,
  onCreateProfile,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: SidebarProps) {
  const [showNewProfile, setShowNewProfile] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState<Currency>('BRL')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleCreateProfile = () => {
    if (!newProfileName.trim()) return
    onCreateProfile(newProfileName.trim())
    setNewProfileName('')
    setShowNewProfile(false)
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newCurrency)
    setNewName('')
    setNewCurrency('BRL')
    setShowNew(false)
  }

  const startEdit = (list: FinancialTable, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(list.id)
    setEditName(list.name)
  }

  const commitEdit = () => {
    if (editingId && editName.trim()) onRename(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full border-r border-[#3b3b3b] bg-[#232323]">
      <div className="px-3 py-3 border-b border-[#3b3b3b] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
            Perfil financeiro
          </p>
          <button
            type="button"
            onClick={() => setShowNewProfile(true)}
            className="text-[10px] text-[#a080f0] hover:text-white"
          >
            + Perfil
          </button>
        </div>
        <select
          aria-label="Perfil financeiro ativo"
          value={activeProfileId}
          onChange={(e) => onSelectProfile(e.target.value)}
          className="w-full bg-[#1b1b1b] border border-[#3b3b3b] rounded px-2 py-1.5 text-xs text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        {showNewProfile && (
          <div className="space-y-1.5">
            <label className="sr-only" htmlFor="new-financial-profile">
              Nome do novo perfil
            </label>
            <input
              id="new-financial-profile"
              autoFocus
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProfile()
                if (e.key === 'Escape') {
                  setShowNewProfile(false)
                  setNewProfileName('')
                }
              }}
              placeholder="Ex.: Finanças dos meus pais"
              className="w-full bg-[#1b1b1b] border border-[#3b3b3b] rounded px-2 py-1.5 text-xs text-[#d4d4d4] placeholder-[#777] focus:outline-none focus:border-[#7c3aed]"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleCreateProfile}
                disabled={!newProfileName.trim()}
                className="flex-1 rounded bg-[#7c3aed] px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
              >
                Criar perfil
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewProfile(false)
                  setNewProfileName('')
                }}
                className="rounded border border-[#3b3b3b] px-2 py-1 text-[10px] text-[#999999] hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] pt-1">
          Tabelas
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {lists.length === 0 && (
          <p className="px-3 py-2 text-xs text-[#999999] italic">Nenhuma tabela</p>
        )}
        {lists.map((list) => {
          const done = list.items.filter((i) => i.done).length
          return (
            <div
              key={list.id}
              className={`group relative flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                activeId === list.id ? 'bg-[#7c3aed]/10' : 'hover:bg-[#2a2a2a]'
              }`}
              onClick={() => onSelect(list.id)}
            >
              {editingId === list.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 text-xs bg-[#1b1b1b] border border-[#7c3aed] rounded px-1.5 py-0.5 text-[#d4d4d4] focus:outline-none"
                />
              ) : (
                <>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={activeId === list.id ? '#a080f0' : '#999999'}
                    strokeWidth="2"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span
                    className={`flex-1 text-xs truncate ${activeId === list.id ? 'text-[#a080f0] font-medium' : 'text-[#999999]'}`}
                  >
                    {list.name}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-[#999999]">
                      {done}/{list.items.length}
                    </span>
                    <button
                      onClick={(e) => startEdit(list, e)}
                      className="p-0.5 rounded text-[#999999] hover:text-[#d4d4d4] transition-colors"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(list.id)
                      }}
                      className="p-0.5 rounded text-[#999999] hover:text-[#e04040] transition-colors"
                    >
                      <svg
                        width="9"
                        height="9"
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
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-[#3b3b3b] bg-[#232323]">
        {showNew ? (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') {
                  setShowNew(false)
                  setNewName('')
                  setNewCurrency('BRL')
                }
              }}
              placeholder="Nome da tabela..."
              className="w-full text-xs px-2.5 py-2 rounded bg-[#1b1b1b] border border-[#3b3b3b] text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
            <div className="flex items-center p-0.5 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b]">
              {(['BRL', 'USD', 'JPY'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewCurrency(c)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    newCurrency === c
                      ? 'bg-[#7c3aed] text-white'
                      : 'text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  {CURRENCY_CONFIG[c].symbol} {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="flex-1 px-3 py-2 rounded bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Criar
              </button>
              <button
                onClick={() => {
                  setShowNew(false)
                  setNewName('')
                  setNewCurrency('BRL')
                }}
                className="flex-1 px-3 py-2 rounded border border-[#3b3b3b] text-[#999999] text-xs font-medium hover:bg-[#2a2a2a] transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-[#7c3aed] border border-[#7c3aed]/30 hover:bg-[#7c3aed]/10 transition-colors"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova tabela
          </button>
        )}
      </div>
    </div>
  )
}
