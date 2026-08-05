import { useState } from 'react'
import type { Goal, GoalEntry } from '../types'
import { todayLocalISO as todayISO } from '../utils/dates'

const fmtNum = (n: number) => parseFloat(n.toFixed(4)).toString()

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y?.slice(-2)}`
}

interface Props {
  goal: Goal
  projectName?: string
  onEdit: () => void
  onDelete: () => void
  onAddEntry: (data: { date: string; label?: string; value: number }) => void
  onDeleteEntry: (entryId: string) => void
}

export function GoalCard({
  goal,
  projectName,
  onEdit,
  onDelete,
  onAddEntry,
  onDeleteEntry
}: Props) {
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
  const ringColor = isComplete ? '#20b858' : goal.color

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

  const unitLabel = goal.unit ? goal.unit.charAt(0).toUpperCase() + goal.unit.slice(1) : 'Qtd'

  return (
    <div className="group rounded-xl border border-[#3b3b3b] bg-[#2a2a2a] overflow-hidden hover:border-[#555555] transition-all duration-200">
      <div
        className="h-[3px]"
        style={{ backgroundColor: ringColor, opacity: isComplete ? 1 : 0.55 }}
      />

      <div className="p-4">
        <div className="flex items-start gap-4 mb-4">
          <div className="relative shrink-0 w-20 h-20">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r={R} fill="none" stroke="#3b3b3b" strokeWidth="5.5" />
              <circle
                cx="40"
                cy="40"
                r={R}
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
              <span
                className="text-base font-bold tabular-nums leading-none"
                style={{ color: ringColor }}
              >
                {Math.round(percent)}%
              </span>
              {isComplete && (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="3.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#d4d4d4] leading-snug">{goal.title}</h3>
                {projectName && (
                  <p className="text-[10px] text-[#999999] mt-0.5 truncate">{projectName}</p>
                )}
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-1 rounded text-[#555555] hover:text-[#999999] hover:bg-[#3b3b3b] transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="5" r="1" fill="currentColor" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                    <circle cx="12" cy="19" r="1" fill="currentColor" />
                  </svg>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-7 z-20 w-28 rounded-lg border border-[#3b3b3b] bg-[#232323] shadow-xl py-1">
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
                        onClick={() => {
                          setMenuOpen(false)
                          onEdit()
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
                        onClick={() => {
                          setMenuOpen(false)
                          onDelete()
                        }}
                      >
                        Deletar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span
                className="text-2xl font-bold tabular-nums leading-none"
                style={{ color: ringColor }}
              >
                {fmtNum(current)}
              </span>
              {goal.unit && <span className="text-sm text-[#999999]">{goal.unit}</span>}
              <span className="text-xs text-[#555555] mx-0.5">/</span>
              <span className="text-sm font-medium text-[#999999] tabular-nums">
                {fmtNum(goal.target)}
                {unitSuffix}
              </span>
            </div>

            {isComplete ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#20b858]/15 text-[#20b858] text-[10px] font-semibold">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Concluída
              </span>
            ) : (
              <p className="text-[10px] text-[#999999]">
                Faltam{' '}
                <span className="text-[#d4d4d4] font-semibold tabular-nums">
                  {fmtNum(remaining)}
                  {unitSuffix}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-[#3b3b3b] pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
              Histórico
            </span>
            {addOpen ? (
              <button
                onClick={() => setAddOpen(false)}
                className="text-[10px] text-[#999999] hover:text-[#d4d4d4] transition-colors"
              >
                Cancelar
              </button>
            ) : (
              <button
                onClick={openAdd}
                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors"
                style={{ color: goal.color, backgroundColor: `${goal.color}15` }}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Registrar
              </button>
            )}
          </div>

          {addOpen && (
            <div className="mb-2 p-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-[#999999] mb-1">Data</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-[#3b3b3b] bg-[#2a2a2a] text-xs text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-[10px] text-[#999999] mb-1">{unitLabel}</label>
                  <input
                    type="number"
                    value={entryValue}
                    onChange={(e) => setEntryValue(e.target.value)}
                    min="0.01"
                    step="any"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddEntry()
                    }}
                    autoFocus
                    className="w-full px-2 py-1 rounded border border-[#3b3b3b] bg-[#2a2a2a] text-xs text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#999999] mb-1">
                  Descrição (opcional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={entryLabel}
                    onChange={(e) => setEntryLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddEntry()
                    }}
                    placeholder={
                      goal.unit === 'livros' || goal.unit === 'livro'
                        ? 'Nome do livro...'
                        : goal.unit === 'km'
                          ? 'Ex: Parque Ibirapuera...'
                          : 'Observação...'
                    }
                    className="flex-1 px-2 py-1 rounded border border-[#3b3b3b] bg-[#2a2a2a] text-xs text-[#d4d4d4] placeholder-[#555555] focus:outline-none focus:border-[#7c3aed] transition-colors"
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

          {sortedEntries.length === 0 ? (
            <p className="text-xs text-[#555555] text-center py-3">Nenhum registro ainda</p>
          ) : (
            <div className="space-y-0.5">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="group/entry flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#3b3b3b] transition-colors"
                >
                  <span className="text-[10px] text-[#999999] shrink-0 tabular-nums w-10">
                    {fmtDate(entry.date)}
                  </span>
                  {entry.label ? (
                    <span className="flex-1 text-xs text-[#d4d4d4] truncate">{entry.label}</span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span
                    className="text-xs font-semibold tabular-nums shrink-0"
                    style={{ color: ringColor }}
                  >
                    +{fmtNum(entry.value)}
                    {unitSuffix}
                  </span>
                  <button
                    onClick={() => onDeleteEntry(entry.id)}
                    title="Remover entrada"
                    className="opacity-0 group-hover/entry:opacity-100 p-0.5 rounded text-[#999999] hover:text-[#e04040] transition-all shrink-0"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}

              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full text-[10px] text-[#999999] hover:text-[#d4d4d4] text-center py-1 transition-colors"
                >
                  ver mais {hiddenCount} entrada{hiddenCount !== 1 ? 's' : ''}
                </button>
              )}
              {showAll && sortedEntries.length > COLLAPSED_LIMIT && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full text-[10px] text-[#999999] hover:text-[#d4d4d4] text-center py-1 transition-colors"
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
