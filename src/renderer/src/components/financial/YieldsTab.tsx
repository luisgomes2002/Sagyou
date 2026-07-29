import { useState, useEffect, useRef } from 'react'
import Decimal from 'decimal.js'
import type { FinancialTable, FinancialTransaction, YieldEntry } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { MONTH_NAMES, formatCurrency, parseDecimalInput, YIELD_SUMMARY_CATEGORY } from './shared'
import { todayLocalISO } from '../../utils/dates'
import { ConfirmDialog } from '../ConfirmDialog'

interface YieldsTabProps {
  list: FinancialTable
  activeMonth: { year: number; month: number }
  onMonthChange: (month: { year: number; month: number }) => void
  onAddSource: (name: string) => void
  onUpdateSource: (sourceId: string, name: string) => void
  onDeleteSource: (sourceId: string) => void
  onAddEntry: (data: Omit<YieldEntry, 'id'>) => void
  onUpdateEntry: (entryId: string, updates: Partial<Omit<YieldEntry, 'id'>>) => void
  onDeleteEntry: (entryId: string) => void
  onAddTransaction: (data: Omit<FinancialTransaction, 'id'>) => void
  onUpdateTransaction: (txId: string, updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  onDeleteTransaction: (txId: string) => void
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function YieldsTab({
  list,
  activeMonth,
  onMonthChange,
  onAddSource,
  onUpdateSource,
  onDeleteSource,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction
}: YieldsTabProps) {
  const currency = list.currency
  const sources = list.yieldSources ?? []
  const entries = list.yieldEntries ?? []

  const [newSourceName, setNewSourceName] = useState('')
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [editSourceName, setEditSourceName] = useState('')
  const [entryDate, setEntryDate] = useState(todayLocalISO())
  const [entryAmounts, setEntryAmounts] = useState<Record<string, string>>({})
  const [duplicateDialog, setDuplicateDialog] = useState<FinancialTransaction[] | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; sourceId: string; name: string }>({
    open: false,
    sourceId: '',
    name: ''
  })

  const entryByKey = new Map<string, YieldEntry>()
  for (const e of entries) {
    entryByKey.set(`${e.sourceId}|${e.date}`, e)
  }

  const maxDay = daysInMonth(activeMonth.year, activeMonth.month)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  const monthTotals: Record<string, Decimal> = {}
  for (const e of entries) {
    const d = new Date(e.date + 'T12:00:00')
    if (d.getFullYear() === activeMonth.year && d.getMonth() + 1 === activeMonth.month) {
      monthTotals[e.sourceId] = (monthTotals[e.sourceId] ?? new Decimal(0)).plus(e.amount)
    }
  }

  const totalMonth = Object.values(monthTotals).reduce((s, v) => s.plus(v), new Decimal(0))
  const hasMonthEntries = !totalMonth.isZero()

  const summaryDescription = `Rendimentos ${MONTH_NAMES[activeMonth.month - 1]} ${activeMonth.year}`
  const summaryDate = (() => {
    const lastDay = daysInMonth(activeMonth.year, activeMonth.month)
    return `${activeMonth.year}-${String(activeMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  })()

  const amount = totalMonth.toDecimalPlaces(2).toString()
  const syncedRef = useRef<string | null>(null)

  useEffect(() => {
    const dedupeKey = `${summaryDescription}|${amount}`
    if (syncedRef.current === dedupeKey) return

    try {
      const existing = list.transactions.find(
        (t) => t.description === summaryDescription && t.type === 'income'
      )

      if (!hasMonthEntries) {
        if (existing) onDeleteTransaction(existing.id)
        syncedRef.current = dedupeKey
        return
      }

      if (existing) {
        if (existing.amount !== amount) {
          onUpdateTransaction(existing.id, { amount, date: summaryDate })
        }
      } else {
        onAddTransaction({
          description: summaryDescription,
          amount,
          type: 'income',
          date: summaryDate,
          category: YIELD_SUMMARY_CATEGORY
        })
      }
      syncedRef.current = dedupeKey
    } catch {
      // Summary transaction update failed silently — will retry on next render
    }
  }, [amount, summaryDescription, summaryDate])

  const duplicateSummaries = list.transactions.filter(
    (t) => t.description === summaryDescription && t.type === 'income'
  )

  useEffect(() => {
    if (duplicateSummaries.length > 1) {
      setDuplicateDialog(duplicateSummaries)
    }
  }, [duplicateSummaries.length])

  const handleKeepDuplicate = (keepId: string) => {
    if (!duplicateDialog) return
    for (const dup of duplicateDialog) {
      if (dup.id !== keepId) onDeleteTransaction(dup.id)
    }
    setDuplicateDialog(null)
  }

  const prevMonth = () => {
    const m = activeMonth.month === 1 ? 12 : activeMonth.month - 1
    const y = activeMonth.month === 1 ? activeMonth.year - 1 : activeMonth.year
    onMonthChange({ year: y, month: m })
  }

  const nextMonth = () => {
    const m = activeMonth.month === 12 ? 1 : activeMonth.month + 1
    const y = activeMonth.month === 12 ? activeMonth.year + 1 : activeMonth.year
    onMonthChange({ year: y, month: m })
  }

  const goToday = () => {
    const n = new Date()
    onMonthChange({ year: n.getFullYear(), month: n.getMonth() + 1 })
  }

  const handleAddSource = () => {
    const name = newSourceName.trim()
    if (!name) return
    onAddSource(name)
    setNewSourceName('')
  }

  const handleUpdateSource = (sourceId: string) => {
    const name = editSourceName.trim()
    if (!name) return
    onUpdateSource(sourceId, name)
    setEditingSourceId(null)
    setEditSourceName('')
  }

  const handleDeleteSource = () => {
    if (!deleteConfirm.sourceId) return
    onDeleteSource(deleteConfirm.sourceId)
    setDeleteConfirm({ open: false, sourceId: '', name: '' })
  }

  const handleSaveEntries = () => {
    for (const source of sources) {
      const raw = entryAmounts[source.id]
      if (raw === undefined || raw.trim() === '') {
        const existing = entryByKey.get(`${source.id}|${entryDate}`)
        if (existing) onDeleteEntry(existing.id)
        continue
      }
      const parsed = parseDecimalInput(raw)
      if (parsed === null || parsed.lessThanOrEqualTo(0)) continue

      const existing = entryByKey.get(`${source.id}|${entryDate}`)
      if (existing) {
        onUpdateEntry(existing.id, { amount: parsed.toDecimalPlaces(2).toString() })
      } else {
        onAddEntry({
          sourceId: source.id,
          date: entryDate,
          amount: parsed.toDecimalPlaces(2).toString(),
          createdAt: new Date().toISOString()
        })
      }
    }
    setEntryAmounts({})
  }

  const getCellEntry = (sourceId: string, day: number): YieldEntry | null => {
    const dateStr = `${activeMonth.year}-${String(activeMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return entryByKey.get(`${sourceId}|${dateStr}`) ?? null
  }

  const dayTotals: Record<number, Decimal> = {}
  for (const source of sources) {
    for (const day of days) {
      const entry = getCellEntry(source.id, day)
      if (entry) {
        dayTotals[day] = (dayTotals[day] ?? new Decimal(0)).plus(entry.amount)
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#3b3b3b] shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="p-1 rounded hover:bg-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-[#d4d4d4] min-w-[120px] text-center">
            {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1 rounded hover:bg-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </button>
          <button
            onClick={goToday}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] hover:border-[#555] transition-colors"
          >
            Hoje
          </button>
        </div>
        <span className="text-xs text-[#999999]">
          Total: <span className="text-[#46d478] font-medium">{formatCurrency(totalMonth, currency)}</span>
        </span>
      </div>

      {duplicateDialog && (
        <div className="px-5 py-3 border-b border-[#3b3b3b] bg-[#2a1a1a]">
          <p className="text-xs font-semibold text-[#e04040] mb-1">
            Duplicatas encontradas
          </p>
          <p className="text-xs text-[#999] mb-3">
            Há {duplicateDialog.length} transações &ldquo;{summaryDescription}&rdquo;.
            Escolha qual manter. As outras serão apagadas.
          </p>
          <div className="space-y-1.5">
            {duplicateDialog.map((dup) => (
              <button
                key={dup.id}
                onClick={() => handleKeepDuplicate(dup.id)}
                className="w-full flex items-center justify-between px-3 py-2 rounded bg-[#1e1e1e] border border-[#3b3b3b] hover:border-[#7c3aed] transition-colors group"
              >
                <span className="text-xs text-[#d4d4d4]">
                  {formatCurrency(dup.amount, currency)} — {dup.date.split('-').reverse().join('/')}
                </span>
                <span className="text-[10px] text-[#a080f0] opacity-0 group-hover:opacity-100 transition-opacity">
                  Manter esta →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Sources */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold text-[#d4d4d4] mb-3">
            Fontes de rendimento
            <span className="ml-2 text-[#999999] font-normal">({sources.length})</span>
          </p>
          <div className="space-y-1.5 mb-3">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center gap-2 group"
              >
                {editingSourceId === source.id ? (
                  <input
                    type="text"
                    value={editSourceName}
                    onChange={(e) => setEditSourceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdateSource(source.id)
                      if (e.key === 'Escape') setEditingSourceId(null)
                    }}
                    onBlur={() => handleUpdateSource(source.id)}
                    className="flex-1 bg-[#1e1e1e] border border-[#7c3aed] text-[#d4d4d4] rounded px-2 py-1 text-sm focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="flex-1 text-sm text-[#d4d4d4]">{source.name}</span>
                    <button
                      onClick={() => {
                        setEditingSourceId(source.id)
                        setEditSourceName(source.name)
                      }}
                      className="text-[10px] text-[#666] hover:text-[#999] transition-colors opacity-0 group-hover:opacity-100"
                    >
                      editar
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ open: true, sourceId: source.id, name: source.name })}
                      className="text-[10px] text-[#666] hover:text-[#e04040] transition-colors opacity-0 group-hover:opacity-100"
                    >
                      apagar
                    </button>
                  </>
                )}
              </div>
            ))}
            {sources.length === 0 && (
              <p className="text-xs text-[#666] italic">
                Nenhuma fonte cadastrada. Adicione fontes de rendimento para começar.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSource()
              }}
              placeholder="Nova fonte..."
              className="flex-1 bg-[#1e1e1e] border border-[#3b3b3b] text-[#d4d4d4] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#7c3aed] placeholder-[#666]"
            />
            <button
              onClick={handleAddSource}
              disabled={!newSourceName.trim()}
              className="px-3 py-1 rounded text-xs font-medium bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Adicionar
            </button>
          </div>
        </div>

        {/* Daily entry */}
        {sources.length > 0 && (
          <div className="px-5 py-3 border-t border-[#3b3b3b]">
            <div className="flex items-center gap-3 mb-3">
              <p className="text-xs font-semibold text-[#d4d4d4]">
                Registrar rendimento
              </p>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="bg-[#1e1e1e] border border-[#3b3b3b] text-[#d4d4d4] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#7c3aed] [color-scheme:dark]"
              />
            </div>
            <div className="space-y-2 mb-3">
              {sources.map((source) => {
                const existingKey = `${source.id}|${entryDate}`
                const existing = entryByKey.get(existingKey)
                return (
                  <div key={source.id} className="flex items-center gap-2">
                    <span className="text-sm text-[#999] w-32 shrink-0 truncate">
                      {source.name}
                    </span>
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-xs text-[#666]">{CURRENCY_CONFIG[currency].symbol}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={entryAmounts[source.id] ?? ''}
                        onChange={(e) =>
                          setEntryAmounts((prev) => ({ ...prev, [source.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEntries()
                        }}
                        placeholder={existing ? formatCurrency(existing.amount, currency) : '0,00'}
                        className="flex-1 bg-[#1e1e1e] border border-[#3b3b3b] text-[#d4d4d4] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#7c3aed] placeholder-[#555]"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              onClick={handleSaveEntries}
              className="px-4 py-1.5 rounded text-xs font-medium bg-[#20b858] text-white hover:bg-[#1a9a48] transition-colors"
            >
              Salvar rendimentos
            </button>
          </div>
        )}

        {/* Monthly grid */}
        {sources.length > 0 && (
          <div className="px-5 py-3 border-t border-[#3b3b3b]">
            <p className="text-xs font-semibold text-[#d4d4d4] mb-3">
              Rendimentos de {MONTH_NAMES[activeMonth.month - 1]}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-[#1e1e1e] text-left py-1 px-2 font-medium text-[#999] min-w-[120px]">
                      Fonte
                    </th>
                    {days.map((day) => (
                      <th
                        key={day}
                        className="py-1 px-1 text-center font-normal text-[#666] min-w-[44px]"
                      >
                        {day}
                      </th>
                    ))}
                    <th className="py-1 px-2 text-right font-medium text-[#999] min-w-[72px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id} className="border-t border-[#2a2a2a]">
                      <td className="sticky left-0 bg-[#1e1e1e] py-1.5 px-2 text-[#d4d4d4] font-medium">
                        {source.name}
                      </td>
                      {days.map((day) => {
                        const entry = getCellEntry(source.id, day)
                        return (
                          <td key={day} className="py-1.5 px-1 text-center">
                            {entry ? (
                              <button
                                onClick={() => onDeleteEntry(entry.id)}
                                title="Clique para apagar este rendimento"
                                className="text-[#46d478] tabular-nums hover:text-[#e06060] hover:line-through transition-colors cursor-pointer"
                              >
                                {formatCurrency(entry.amount, currency)
                                  .replace(/^R\$\s?/, '')
                                  .replace(/^\$\s?/, '')}
                              </button>
                            ) : (
                              <span className="text-[#3b3b3b]">-</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="py-1.5 px-2 text-right">
                        <span className="text-[#46d478] font-medium tabular-nums">
                          {monthTotals[source.id]
                            ? formatCurrency(monthTotals[source.id], currency)
                            : '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#3b3b3b]">
                    <td className="sticky left-0 bg-[#1e1e1e] py-1.5 px-2 text-[#999] font-medium">
                      TOTAL
                    </td>
                    {days.map((day) => {
                      const dt = dayTotals[day]
                      return (
                        <td key={day} className="py-1.5 px-1 text-center">
                          {dt ? (
                            <span className="text-[#d4d4d4] font-medium tabular-nums">
                              {formatCurrency(dt, currency)
                                .replace(/^R\$\s?/, '')
                                .replace(/^\$\s?/, '')}
                            </span>
                          ) : (
                            <span className="text-[#3b3b3b]">-</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="py-1.5 px-2 text-right">
                      <span className="text-[#d4d4d4] font-semibold tabular-nums">
                        {formatCurrency(totalMonth, currency)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Remover fonte de rendimento"
        message={`Remover "${deleteConfirm.name}"? Todos os rendimentos registrados desta fonte também serão apagados.`}
        confirmLabel="Deletar"
        onConfirm={handleDeleteSource}
        onCancel={() => setDeleteConfirm({ open: false, sourceId: '', name: '' })}
      />
    </div>
  )
}
