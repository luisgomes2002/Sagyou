import { useState, useMemo } from 'react'
import type { FinancialTable, FinancialTransaction } from '../../types'
import { MONTH_NAMES, CAT_COLORS, formatCurrency } from './shared'

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function AnalyticsTab({ list }: { list: FinancialTable }) {
  const { currency, transactions } = list
  const allYears = [...new Set(transactions.map((t) => t.date.slice(0, 4)))].sort().reverse()
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [catView, setCatView] = useState<'expense' | 'income'>('expense')

  const handleYearSelect = (year: string) => {
    setSelectedYear(year)
    setSelectedMonth('all')
  }

  const availableMonths = useMemo(() => {
    if (selectedYear === 'all') return []
    return [...new Set(
      transactions
        .filter((t) => t.date.startsWith(selectedYear))
        .map((t) => t.date.slice(5, 7))
    )].sort()
  }, [transactions, selectedYear])

  const filtered = useMemo(() => {
    if (selectedYear === 'all') return transactions
    const prefix = selectedMonth === 'all' ? selectedYear : `${selectedYear}-${selectedMonth}`
    return transactions.filter((t) => t.date.startsWith(prefix))
  }, [transactions, selectedYear, selectedMonth])
  const expenses = filtered.filter((t) => t.type === 'expense')
  const incomes = filtered.filter((t) => t.type === 'income')
  const totalExpense = expenses.reduce((s, t) => s + t.amount, 0)
  const totalIncome = incomes.reduce((s, t) => s + t.amount, 0)
  const totalBalance = totalIncome - totalExpense

  const buildCatEntries = (txs: FinancialTransaction[]) => {
    const map: Record<string, number> = {}
    for (const t of txs) {
      const cat = t.category || 'Sem categoria'
      map[cat] = (map[cat] ?? 0) + t.amount
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }

  const expCatEntries = buildCatEntries(expenses)
  const incCatEntries = buildCatEntries(incomes)
  const activeCatEntries = catView === 'expense' ? expCatEntries : incCatEntries
  const activeTotal = catView === 'expense' ? totalExpense : totalIncome
  const activeMax = activeCatEntries[0]?.[1] ?? 1

  const byMonth: Record<string, { income: number; expense: number; balance: number }> = {}
  for (const t of filtered) {
    const key = t.date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0, balance: 0 }
    if (t.type === 'income') byMonth[key].income += t.amount
    else byMonth[key].expense += t.amount
  }
  for (const k of Object.keys(byMonth)) {
    byMonth[k].balance = byMonth[k].income - byMonth[k].expense
  }
  const monthEntries = Object.entries(byMonth)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => a.key.localeCompare(b.key))

  const maxMonthBar = Math.max(...monthEntries.map((m) => Math.max(m.income, m.expense)), 1)
  const avgMonthlyExpense = monthEntries.length > 0 ? totalExpense / monthEntries.length : 0

  const bestMonth = monthEntries.length > 1 ? monthEntries.reduce((best, m) => (m.balance > best.balance ? m : best)) : null
  const worstMonth = monthEntries.length > 1 ? monthEntries.reduce((worst, m) => (m.balance < worst.balance ? m : worst)) : null

  const topExpCat = expCatEntries[0]
  const topIncCat = incCatEntries[0]

  function monthLabel(key: string): string {
    const [y, m] = key.split('-')
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[#8892a4]">
        <p className="text-sm">Sem transações para analisar</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
      {/* Year filter */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleYearSelect('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedYear === 'all' ? 'bg-[#6366f1]/15 text-[#a5b4fc]' : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
            }`}
          >
            Todos
          </button>
          {allYears.map((y) => (
            <button
              key={y}
              onClick={() => handleYearSelect(y)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedYear === y ? 'bg-[#6366f1]/15 text-[#a5b4fc]' : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* Month filter — visible only when a year is selected */}
        {selectedYear !== 'all' && availableMonths.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
            <button
              onClick={() => setSelectedMonth('all')}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                selectedMonth === 'all' ? 'bg-[#2a2d42] text-[#e2e8f0]' : 'text-[#4a5068] hover:text-[#8892a4] hover:bg-[#1e2235]'
              }`}
            >
              Todos os meses
            </button>
            {availableMonths.map((m) => (
              <button
                key={m}
                onClick={() => setSelectedMonth(m)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  selectedMonth === m ? 'bg-[#2a2d42] text-[#e2e8f0]' : 'text-[#4a5068] hover:text-[#8892a4] hover:bg-[#1e2235]'
                }`}
              >
                {MONTH_ABBR[Number(m) - 1]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Total Entradas</p>
          <p className="text-sm font-bold text-[#4ade80] tabular-nums">{formatCurrency(totalIncome, currency)}</p>
        </div>
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Total Saídas</p>
          <p className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(totalExpense, currency)}</p>
        </div>
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saldo Geral</p>
          <p className={`text-sm font-bold tabular-nums ${totalBalance >= 0 ? 'text-[#e2e8f0]' : 'text-red-400'}`}>
            {totalBalance >= 0 ? '+' : ''}{formatCurrency(totalBalance, currency)}
          </p>
        </div>
        <div className="rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc] mb-1">Média/Mês Gastos</p>
          <p className="text-sm font-bold text-[#a5b4fc] tabular-nums">{formatCurrency(avgMonthlyExpense, currency)}</p>
        </div>
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#22c55e]/25 bg-[#22c55e]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#22c55e]/60 mb-1.5">Melhor Mês</p>
          {bestMonth ? (
            <>
              <p className="text-sm font-bold text-[#4ade80]">{monthLabel(bestMonth.key)}</p>
              <p className="text-xs tabular-nums text-[#4ade80]/70 mt-0.5">
                {bestMonth.balance >= 0 ? '+' : ''}{formatCurrency(bestMonth.balance, currency)}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#4a5068]">Dados insuficientes</p>
          )}
        </div>
        <div className="rounded-lg border border-[#6366f1]/25 bg-[#6366f1]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc]/60 mb-1.5">Maior Gasto</p>
          {topExpCat ? (
            <>
              <p className="text-sm font-bold text-[#a5b4fc] truncate">{topExpCat[0]}</p>
              <p className="text-xs tabular-nums text-[#a5b4fc]/70 mt-0.5">
                {formatCurrency(topExpCat[1], currency)}{totalExpense > 0 ? ` · ${Math.round((topExpCat[1] / totalExpense) * 100)}%` : ''}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">—</p>}
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1.5">Pior Mês</p>
          {worstMonth ? (
            <>
              <p className="text-sm font-bold text-red-400">{monthLabel(worstMonth.key)}</p>
              <p className="text-xs tabular-nums text-red-400/70 mt-0.5">
                {worstMonth.balance >= 0 ? '+' : ''}{formatCurrency(worstMonth.balance, currency)}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#4a5068]">Dados insuficientes</p>
          )}
        </div>
        <div className="rounded-lg border border-[#22c55e]/25 bg-[#22c55e]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#22c55e]/60 mb-1.5">Maior Ganho</p>
          {topIncCat ? (
            <>
              <p className="text-sm font-bold text-[#4ade80] truncate">{topIncCat[0]}</p>
              <p className="text-xs tabular-nums text-[#4ade80]/70 mt-0.5">
                {formatCurrency(topIncCat[1], currency)}{totalIncome > 0 ? ` · ${Math.round((topIncCat[1] / totalIncome) * 100)}%` : ''}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">—</p>}
        </div>
      </div>

      {/* Category ranking */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#e2e8f0]">Ranking por Categoria</p>
          <div className="flex items-center p-0.5 rounded-lg bg-[#1e2235] border border-[#2a2d42]">
            <button
              onClick={() => setCatView('expense')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'expense' ? 'bg-[#2a2d42] text-red-400' : 'text-[#8892a4] hover:text-[#e2e8f0]'
              }`}
            >
              ↓ Gastos
            </button>
            <button
              onClick={() => setCatView('income')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'income' ? 'bg-[#2a2d42] text-[#4ade80]' : 'text-[#8892a4] hover:text-[#e2e8f0]'
              }`}
            >
              ↑ Ganhos
            </button>
          </div>
        </div>

        {activeCatEntries.length === 0 ? (
          <p className="text-xs text-[#4a5068] italic">
            Sem {catView === 'expense' ? 'gastos' : 'ganhos'} com categorias registradas
          </p>
        ) : (
          <div className="space-y-2.5">
            {activeCatEntries.map(([cat, amount], i) => {
              const color = CAT_COLORS[i % CAT_COLORS.length]
              const pct = activeTotal > 0 ? Math.round((amount / activeTotal) * 100) : 0
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-[#4a5068] w-5 shrink-0 text-right">#{i + 1}</span>
                  <span className="text-xs text-[#8892a4] w-28 truncate shrink-0">{cat}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#0d0f18] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(amount / activeMax) * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-[#e2e8f0] w-24 text-right shrink-0 font-medium">
                    {formatCurrency(amount, currency)}
                  </span>
                  <span className="text-[10px] text-[#8892a4] w-8 text-right shrink-0">{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Monthly history */}
      {monthEntries.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#e2e8f0] mb-3">Histórico Mensal</p>
          <div className="space-y-2">
            {[...monthEntries].reverse().map((m) => {
              const isBest = bestMonth && m.key === bestMonth.key
              const isWorst = worstMonth && m.key === worstMonth.key
              return (
                <div
                  key={m.key}
                  className={`rounded-lg p-3 border transition-colors ${
                    isBest ? 'border-[#22c55e]/25 bg-[#22c55e]/5' : isWorst ? 'border-red-500/25 bg-red-500/5' : 'border-[#2a2d42] bg-[#1e2235]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#e2e8f0]">{monthLabel(m.key)}</span>
                      {isBest && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#4ade80] font-semibold">Melhor</span>}
                      {isWorst && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">Pior</span>}
                    </div>
                    <span className={`text-xs font-bold tabular-nums ${m.balance >= 0 ? 'text-[#4ade80]' : 'text-red-400'}`}>
                      {m.balance >= 0 ? '+' : ''}{formatCurrency(m.balance, currency)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[#4ade80] w-12 shrink-0">Entradas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0d0f18] overflow-hidden">
                        <div className="h-full rounded-full bg-[#22c55e]" style={{ width: `${(m.income / maxMonthBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums text-[#4ade80] w-24 text-right shrink-0">{formatCurrency(m.income, currency)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-red-400 w-12 shrink-0">Saídas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0d0f18] overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${(m.expense / maxMonthBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums text-red-400 w-24 text-right shrink-0">{formatCurrency(m.expense, currency)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
