import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useKanbanStore } from '../store/kanban'
import { useAiRunStore } from '../store/aiRun'
import type { Project, Priority, FinancialTransaction, Currency } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { isTaskDone } from '../utils/columns'
import { computeHabitSummary, todayISO } from '../utils/habits'
import { D, formatCurrency } from './financial/shared'

interface Props {
  projects: Project[]
  onNavigate: (view: string) => void
}

export function HomeView({ projects, onNavigate }: Props) {
  const { tasks, sprints, habits, goals, lists } = useKanbanStore(
    useShallow((s) => ({
      tasks: s.tasks,
      sprints: s.sprints,
      habits: s.habits,
      goals: s.goals,
      lists: s.lists
    }))
  )

  const runningAgentCount = useAiRunStore((s) => s.running.size)

  // ── Summary stats ──────────────────────────────────────────────

  const archivedIds = useMemo(() => new Set(projects.filter((p) => p.archivedAt).map((p) => p.id)), [projects])

  const openTasks = useMemo(
    () => tasks.filter((t) => !isTaskDone(t, projects) && !archivedIds.has(t.projectId)).length,
    [tasks, projects, archivedIds]
  )
  const projectCount = useMemo(
    () => new Set(tasks.filter((t) => !isTaskDone(t, projects) && !archivedIds.has(t.projectId)).map((t) => t.projectId)).size,
    [tasks, projects, archivedIds]
  )

  const habitSummary = useMemo(() => computeHabitSummary(habits, new Date()), [habits])
  const habitsDoneToday = useMemo(
    () => habitSummary.filter((h) => h.habit.completions.includes(todayISO())).length,
    [habitSummary]
  )
  const avgHabitRate = useMemo(() => {
    if (habitSummary.length === 0) return 0
    return Math.round(habitSummary.reduce((s, h) => s + h.rate, 0) / habitSummary.length)
  }, [habitSummary])

  const goalsWithProgress = useMemo(
    () =>
      goals
        .map((g) => {
          const current = g.entries.reduce((sum, e) => sum + e.value, 0)
          const percent = Math.min(Math.round((current / g.target) * 100), 100)
          return { ...g, current, percent }
        })
        .filter((g) => g.percent > 0)
        .sort((a, b) => b.percent - a.percent),
    [goals]
  )
  const completedGoals = useMemo(() => goalsWithProgress.filter((g) => g.percent >= 100).length, [goalsWithProgress])

  // ── Financial month summary ────────────────────────────────────

  const monthKey = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])

  // Exchange rates for multi-currency display
  const [rates, setRates] = useState<Record<string, { rate: string; loaded: boolean; error?: string }>>({})

  useEffect(() => {
    let cancelled = false
    const tableCurrencies = [...new Set(lists.map((l) => l.currency))]
    const nonBrl = tableCurrencies.filter((c) => c !== 'BRL')
    if (nonBrl.length === 0) return

    async function fetchRates() {
      const result: Record<string, { rate: string; loaded: boolean; error?: string }> = {}
      for (const cur of nonBrl) {
        try {
          if (!window.electronAPI?.financial?.fetchExchangeRate) continue
          const pair = `${cur}-BRL`
          const res = await window.electronAPI.financial.fetchExchangeRate(pair)
          if (cancelled) return
          if ('error' in res) {
            result[pair] = { rate: '0', loaded: true, error: res.error }
          } else {
            result[pair] = { rate: res.rate, loaded: true }
          }
        } catch {
          if (cancelled) return
        }
      }
      setRates(result)
    }

    fetchRates()
    return () => { cancelled = true }
  }, [lists])

  const [financialTableId, setFinancialTableId] = useState<string>('__consolidated__')

  const allTransactions = useMemo(() => {
    const txs: (FinancialTransaction & { tableCurrency: Currency; tableId: string })[] = []
    for (const list of lists) {
      for (const tx of list.transactions) {
        txs.push({ ...tx, tableCurrency: list.currency, tableId: list.id })
      }
    }
    return txs
  }, [lists])

  const monthTransactions = useMemo(() => {
    const linkedIds = new Set(allTransactions.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
    return allTransactions.filter((t) => {
      if (!t.date.startsWith(monthKey)) return false
      if (linkedIds.has(t.id)) return false
      return true
    })
  }, [allTransactions, monthKey])

  const filteredMonthTxs = useMemo(() => {
    if (financialTableId === '__consolidated__') return monthTransactions
    return monthTransactions.filter((tx) => tx.tableId === financialTableId)
  }, [monthTransactions, financialTableId])

  const monthIncome = useMemo(
    () =>
      filteredMonthTxs
        .filter((tx) => tx.type === 'income')
        .reduce((sum, tx) => sum.plus(D(tx.amount)), D('0')),
    [filteredMonthTxs]
  )
  const monthExpense = useMemo(
    () =>
      filteredMonthTxs
        .filter((tx) => tx.type === 'expense')
        .reduce((sum, tx) => sum.plus(D(tx.amount)), D('0')),
    [filteredMonthTxs]
  )

  // Accumulated balance (all time, same filter)
  const allFilteredTxs = useMemo(() => {
    if (financialTableId === '__consolidated__') {
      const linkedIds = new Set(allTransactions.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
      return allTransactions.filter((t) => !linkedIds.has(t.id))
    }
    return allTransactions.filter((t) => t.tableId === financialTableId)
  }, [allTransactions, financialTableId])

  const accIncome = useMemo(
    () => allFilteredTxs.filter((t) => t.type === 'income').reduce((s, t) => s.plus(D(t.amount)), D('0')),
    [allFilteredTxs]
  )
  const accExpense = useMemo(
    () => allFilteredTxs.filter((t) => t.type === 'expense').reduce((s, t) => s.plus(D(t.amount)), D('0')),
    [allFilteredTxs]
  )
  const accBalance = useMemo(() => accIncome.minus(accExpense), [accIncome, accExpense])

  // Multi-currency: convert totals to BRL for a unified display
  const tableCurrencies = useMemo(() => [...new Set(lists.map((l) => l.currency))], [lists])
  const multiCurrency = tableCurrencies.length > 1
  const ratesLoaded = useMemo(() => {
    const nonBrl = tableCurrencies.filter((c) => c !== 'BRL')
    if (nonBrl.length === 0) return false
    return nonBrl.every((c) => rates[`${c}-BRL`]?.loaded)
  }, [tableCurrencies, rates])

  const convertedIncome = useMemo(() => {
    if (!multiCurrency || !ratesLoaded) return monthIncome
    let total = D('0')
    for (const tx of filteredMonthTxs.filter((t) => t.type === 'income')) {
      if (tx.tableCurrency === 'BRL') total = total.plus(D(tx.amount))
      else {
        const r = rates[`${tx.tableCurrency}-BRL`]
        if (r?.loaded && !r.error) total = total.plus(D(tx.amount).times(r.rate))
      }
    }
    return total
  }, [filteredMonthTxs, multiCurrency, ratesLoaded, rates])

  const convertedExpense = useMemo(() => {
    if (!multiCurrency || !ratesLoaded) return monthExpense
    let total = D('0')
    for (const tx of filteredMonthTxs.filter((t) => t.type === 'expense')) {
      if (tx.tableCurrency === 'BRL') total = total.plus(D(tx.amount))
      else {
        const r = rates[`${tx.tableCurrency}-BRL`]
        if (r?.loaded && !r.error) total = total.plus(D(tx.amount).times(r.rate))
      }
    }
    return total
  }, [filteredMonthTxs, multiCurrency, ratesLoaded, rates])

  const displayIncome = multiCurrency && ratesLoaded ? convertedIncome : monthIncome
  const displayExpense = multiCurrency && ratesLoaded ? convertedExpense : monthExpense
  const displayAccBalance = useMemo(() => {
    if (!multiCurrency || !ratesLoaded) return accBalance
    let total = D('0')
    for (const tx of allFilteredTxs) {
      if (tx.tableCurrency === 'BRL') {
        total = tx.type === 'income' ? total.plus(D(tx.amount)) : total.minus(D(tx.amount))
      } else {
        const r = rates[`${tx.tableCurrency}-BRL`]
        if (r?.loaded && !r.error) {
          total = tx.type === 'income' ? total.plus(D(tx.amount).times(r.rate)) : total.minus(D(tx.amount).times(r.rate))
        }
      }
    }
    return total
  }, [allFilteredTxs, multiCurrency, ratesLoaded, rates])

  // ── Kanban priority bars ───────────────────────────────────────

  const priorityCounts = useMemo(() => {
    const counts: Record<Priority, number> = { low: 0, medium: 0, high: 0, urgent: 0 }
    for (const t of tasks) {
      if (!isTaskDone(t, projects) && !archivedIds.has(t.projectId)) {
        counts[t.priority] = (counts[t.priority] || 0) + 1
      }
    }
    const max = Math.max(...Object.values(counts), 1)
    return { counts, max }
  }, [tasks, projects, archivedIds])

  // ── Active sprints ─────────────────────────────────────────────

  const activeSprints = useMemo(() => {
    const mapped = sprints
      .filter((s) => !s.closedAt)
      .map((s) => ({
        ...s,
        openTasks: tasks.filter((t) => t.sprintId === s.id && !isTaskDone(t, projects) && !archivedIds.has(t.projectId)).length
      }))
      .filter((s) => s.openTasks > 0)
      .sort((a, b) => b.openTasks - a.openTasks)
    return mapped.slice(0, 5)
  }, [sprints, tasks, projects, archivedIds])

  // ── Top spending categories ────────────────────────────────────

  const topCategories = useMemo(() => {
    const byCat: Record<string, ReturnType<typeof D>> = {}
    for (const tx of filteredMonthTxs) {
      if (tx.type !== 'expense') continue
      const cat = tx.category || 'Outros'
      byCat[cat] = (byCat[cat] || D('0')).plus(D(tx.amount))
    }
    return Object.entries(byCat)
      .sort(([, a], [, b]) => b.minus(a).toNumber())
      .slice(0, 3)
  }, [filteredMonthTxs])

  const selectedTableCurrency = useMemo(() => {
    if (financialTableId === '__consolidated__') return null
    return lists.find((l) => l.id === financialTableId)?.currency
  }, [financialTableId, lists])

  const displayCurrency: Currency = useMemo(() => {
    if (selectedTableCurrency) return selectedTableCurrency
    if (multiCurrency && ratesLoaded) return 'BRL'
    return tableCurrencies[0] ?? 'BRL'
  }, [selectedTableCurrency, multiCurrency, ratesLoaded, tableCurrencies])
  const hasFinancialData = useMemo(() => lists.some((l) => l.transactions.length > 0), [lists])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#1b1b1b]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-[#d4d4d4]">Dashboard</h1>
        {lists.length > 0 && (
          <select
            value={financialTableId}
            onChange={(e) => setFinancialTableId(e.target.value)}
            className="bg-[#2a2a2a] border border-[#3b3b3b] text-[#d4d4d4] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#7c3aed]"
          >
            <option value="__consolidated__">Consolidado</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {/* Tasks abertas */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="11" rx="1" />
              <rect x="14" y="18" width="7" height="3" rx="1" />
            </svg>
            Tasks abertas
          </p>
          <p className="text-2xl font-bold" style={{ color: '#7c3aed' }}>
            {openTasks}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">em {projectCount} projeto{projectCount !== 1 ? 's' : ''}</p>
        </div>

        {/* Hábitos hoje */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Hábitos hoje
          </p>
          <p className="text-2xl font-bold" style={{ color: '#20b858' }}>
            {habits.length > 0 ? `${habitsDoneToday}/${habits.length}` : '—'}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            {habits.length > 0 ? `${avgHabitRate}% no mês` : 'Nenhum hábito'}
          </p>
        </div>

        {/* Metas ativas */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            Metas ativas
          </p>
          <p className="text-2xl font-bold" style={{ color: '#f0b820' }}>
            {goalsWithProgress.length}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            {completedGoals > 0 ? `${completedGoals} concluída${completedGoals !== 1 ? 's' : ''}` : 'Nenhuma meta'}
          </p>
        </div>

        {/* Saldo */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Saldo
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: displayAccBalance.gte('0') ? '#20b858' : '#e04040' }}
          >
            {formatCurrency(displayAccBalance, displayCurrency)}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline-block mr-0.5 align-[-1px]">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
            Receitas {formatCurrency(displayIncome, displayCurrency)} /{' '}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline-block mr-0.5 align-[-1px]">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
            Despesas{' '}
            {formatCurrency(displayExpense.negated(), displayCurrency)}
          </p>
        </div>
      </div>

      {/* Second row: Kanban + Hábitos */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Kanban */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="11" rx="1" />
              <rect x="14" y="18" width="7" height="3" rx="1" />
            </svg>
            Kanban
          </h2>
          {openTasks === 0 ? (
            <p className="text-[#999999] text-sm">Nenhuma task aberta</p>
          ) : (
            <div className="space-y-2">
              {(Object.entries(priorityCounts.counts) as [Priority, number][]).map(([p, count]) => (
                <div key={p} className="flex items-center gap-2">
                  <span
                    className={`text-[11px] w-12 font-medium ${PRIORITY_CONFIG[p].color}`}
                  >
                    {PRIORITY_CONFIG[p].label}
                  </span>
                  <span className="text-[11px] text-[#d4d4d4] w-5 tabular-nums">{count}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#3b3b3b] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((count / priorityCounts.max) * 100)}%`,
                        backgroundColor:
                          p === 'urgent'
                            ? '#e04040'
                            : p === 'high'
                              ? '#f06c10'
                              : p === 'medium'
                                ? '#e8b810'
                                : '#04acca'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeSprints.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-2 flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Sprints ativas
              </p>
              <div className="space-y-1.5">
                {activeSprints.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-[#d4d4d4] truncate">{s.name}</span>
                    <span className="text-[#999999] ml-2 shrink-0">
                      {s.openTasks} task{s.openTasks !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Hábitos */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Hábitos
          </h2>
          {habits.length === 0 ? (
            <p className="text-[#999999] text-sm">Nenhum hábito cadastrado</p>
          ) : (
            <div className="space-y-2">
              {habitSummary.slice(0, 5).map(({ habit, streak, rate }) => {
                const doneToday = habit.completions.includes(todayISO())
                return (
                  <div key={habit.id} className="flex items-center gap-2 text-sm">
                    {doneToday ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#46d478" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    )}
                    <span className="text-[#d4d4d4] truncate flex-1">{habit.name}</span>
                    {streak > 0 && (
                      <span className="text-[11px] text-[#f0b820] shrink-0">
                        seq. {streak}d
                      </span>
                    )}
                    <span className="text-[11px] text-[#999999] w-9 text-right tabular-nums">
                      {rate}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Third row: Metas + Financeiro */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Metas */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            Metas
          </h2>
          {goals.length === 0 ? (
            <p className="text-[#999999] text-sm">Nenhuma meta cadastrada</p>
          ) : (
            <div className="space-y-3">
              {goalsWithProgress.slice(0, 5).map((g) => (
                <div key={g.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#d4d4d4] truncate flex-1">{g.title}</span>
                    <span className="text-[#999999] ml-2 tabular-nums">{g.percent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#3b3b3b] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${g.percent}%`,
                        backgroundColor: g.color || '#7c3aed'
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-[#666666] mt-0.5">
                    {g.current} / {g.target} {g.unit}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Financeiro */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Financeiro
          </h2>
          {!hasFinancialData || monthTransactions.length === 0 ? (
            <p className="text-[#999999] text-sm">Nenhuma transação este mês</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#d4d4d4] flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#46d478" strokeWidth="2.5">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                  Receitas
                </span>
                <span className="text-xs font-medium text-[#20b858] tabular-nums">
                  {formatCurrency(displayIncome, displayCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#d4d4d4] flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e04040" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                  Despesas
                </span>
                <span className="text-xs font-medium text-[#e04040] tabular-nums">
                  {formatCurrency(displayExpense.negated(), displayCurrency)}
                </span>
              </div>
              {topCategories.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-2 mt-4">
                    Top categorias
                  </p>
                  {topCategories.map(([cat, amount]) => (
                    <div key={cat} className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[#d4d4d4] flex items-center gap-1">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        {cat}
                      </span>
                      <span className="text-[#999999] tabular-nums">{formatCurrency(amount.negated(), displayCurrency)}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Agents row (conditional) */}
      {runningAgentCount > 0 && (
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
            </svg>
            Agentes
          </h2>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#d4d4d4]">
              {runningAgentCount} agente{runningAgentCount !== 1 ? 's' : ''} em execução — ver FleetView
            </p>
            <button
              onClick={() => onNavigate('agents')}
              className="px-4 py-2 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] transition-colors"
            >
              Ver FleetView
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
