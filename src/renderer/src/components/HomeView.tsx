import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useKanbanStore } from '../store/kanban'
import { useAiRunStore } from '../store/aiRun'
import type { Project, Priority, FinancialTransaction } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { isTaskDone } from '../utils/columns'
import { computeHabitSummary, todayISO } from '../utils/habits'
import { D } from './financial/shared'

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

  const openTasks = useMemo(
    () => tasks.filter((t) => !isTaskDone(t, projects)).length,
    [tasks, projects]
  )
  const projectCount = useMemo(
    () => new Set(tasks.filter((t) => !isTaskDone(t, projects)).map((t) => t.projectId)).size,
    [tasks, projects]
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

  const monthTransactions = useMemo(() => {
    const txs: FinancialTransaction[] = []
    for (const list of lists) {
      for (const tx of list.transactions) {
        if (tx.date.startsWith(monthKey)) txs.push(tx)
      }
    }
    return txs
  }, [lists, monthKey])

  const monthIncome = useMemo(
    () =>
      monthTransactions
        .filter((tx) => tx.type === 'income')
        .reduce((sum, tx) => sum.plus(D(tx.amount)), D('0')),
    [monthTransactions]
  )
  const monthExpense = useMemo(
    () =>
      monthTransactions
        .filter((tx) => tx.type === 'expense')
        .reduce((sum, tx) => sum.plus(D(tx.amount)), D('0')),
    [monthTransactions]
  )
  const monthBalance = useMemo(() => monthIncome.minus(monthExpense), [monthIncome, monthExpense])
  const balanceNonNegative = useMemo(() => monthBalance.gte('0'), [monthBalance])

  // ── Kanban priority bars ───────────────────────────────────────

  const priorityCounts = useMemo(() => {
    const counts: Record<Priority, number> = { low: 0, medium: 0, high: 0, urgent: 0 }
    for (const t of tasks) {
      if (!isTaskDone(t, projects)) {
        counts[t.priority] = (counts[t.priority] || 0) + 1
      }
    }
    const max = Math.max(...Object.values(counts), 1)
    return { counts, max }
  }, [tasks, projects])

  // ── Active sprints ─────────────────────────────────────────────

  const activeSprints = useMemo(() => {
    const mapped = sprints
      .filter((s) => !s.closedAt)
      .map((s) => ({
        ...s,
        openTasks: tasks.filter((t) => t.sprintId === s.id && !isTaskDone(t, projects)).length
      }))
      .filter((s) => s.openTasks > 0)
      .sort((a, b) => b.openTasks - a.openTasks)
    return mapped.slice(0, 5)
  }, [sprints, tasks, projects])

  // ── Top spending categories ────────────────────────────────────

  const topCategories = useMemo(() => {
    const byCat: Record<string, ReturnType<typeof D>> = {}
    for (const tx of monthTransactions) {
      if (tx.type !== 'expense') continue
      const cat = tx.category || 'Outros'
      byCat[cat] = (byCat[cat] || D('0')).plus(D(tx.amount))
    }
    return Object.entries(byCat)
      .sort(([, a], [, b]) => b.minus(a).toNumber())
      .slice(0, 3)
  }, [monthTransactions])

  const hasFinancialData = useMemo(() => lists.some((l) => l.transactions.length > 0), [lists])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#1b1b1b]">
      <h1 className="text-xl font-bold text-[#d4d4d4] mb-6">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {/* Tasks abertas */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5">Tasks abertas</p>
          <p className="text-2xl font-bold" style={{ color: '#7c3aed' }}>
            {openTasks}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">em {projectCount} projeto{projectCount !== 1 ? 's' : ''}</p>
        </div>

        {/* Hábitos hoje */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5">Hábitos hoje</p>
          <p className="text-2xl font-bold" style={{ color: '#20b858' }}>
            {habits.length > 0 ? `${habitsDoneToday}/${habits.length}` : '—'}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            {habits.length > 0 ? `${avgHabitRate}% no mês` : 'Nenhum hábito'}
          </p>
        </div>

        {/* Metas ativas */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5">Metas ativas</p>
          <p className="text-2xl font-bold" style={{ color: '#f0b820' }}>
            {goalsWithProgress.length}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            {completedGoals > 0 ? `${completedGoals} concluída${completedGoals !== 1 ? 's' : ''}` : 'Nenhuma meta'}
          </p>
        </div>

        {/* Saldo do mês */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <p className="text-[11px] text-[#999999] mb-1.5">Saldo do mês</p>
          <p
            className="text-2xl font-bold"
            style={{ color: balanceNonNegative ? '#20b858' : '#e04040' }}
          >
            {balanceNonNegative ? '+' : ''}R${' '}
            {monthBalance.abs().toFixed(2)}
          </p>
          <p className="text-[10px] text-[#666666] mt-0.5">
            Receitas R$ {monthIncome.toFixed(2)} / Despesas R$ {monthExpense.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Second row: Kanban + Hábitos */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Kanban */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-2">
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
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
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
                    <span className="text-xs">{doneToday ? 'Sim' : 'Nao'}</span>
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
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
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
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
            Financeiro
          </h2>
          {!hasFinancialData || monthTransactions.length === 0 ? (
            <p className="text-[#999999] text-sm">Nenhuma transação este mês</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#d4d4d4]">Receitas</span>
                <span className="text-xs font-medium text-[#20b858] tabular-nums">
                  R$ {monthIncome.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#d4d4d4]">Despesas</span>
                <span className="text-xs font-medium text-[#e04040] tabular-nums">
                  R$ {monthExpense.toFixed(2)}
                </span>
              </div>
              {topCategories.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-2 mt-4">
                    Top categorias
                  </p>
                  {topCategories.map(([cat, amount]) => (
                    <div key={cat} className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[#d4d4d4]">{cat}</span>
                      <span className="text-[#999999] tabular-nums">R$ {amount.toFixed(2)}</span>
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
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
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
