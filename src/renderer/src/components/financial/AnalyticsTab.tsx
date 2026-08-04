import { useMemo } from 'react'
import Decimal from 'decimal.js'
import type { FinancialTable, FinancialTransaction } from '../../types'
import { MONTH_NAMES, CAT_COLORS, formatCurrency } from './shared'
import { FinancialCharts } from './FinancialCharts'

const MONTH_ABBR = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez'
]

interface AnalyticsTabProps {
  list: FinancialTable
  selectedYear: string
  onYearChange: (year: string) => void
  selectedMonth: string
  onMonthChange: (month: string) => void
  catView: 'expense' | 'income'
  onCatViewChange: (view: 'expense' | 'income') => void
}

export function AnalyticsTab({
  list,
  selectedYear,
  onYearChange,
  selectedMonth,
  onMonthChange,
  catView,
  onCatViewChange
}: AnalyticsTabProps) {
  const { currency, transactions } = list
  const allYears = [...new Set(transactions.map((t) => t.date.slice(0, 4)))].sort().reverse()

  const handleYearSelect = (year: string) => {
    onYearChange(year)
  }

  const availableMonths = useMemo(() => {
    if (selectedYear === 'all') return []
    return [
      ...new Set(
        transactions.filter((t) => t.date.startsWith(selectedYear)).map((t) => t.date.slice(5, 7))
      )
    ].sort()
  }, [transactions, selectedYear])

  const filtered = useMemo(() => {
    if (selectedYear === 'all') return transactions
    const prefix = selectedMonth === 'all' ? selectedYear : `${selectedYear}-${selectedMonth}`
    return transactions.filter((t) => t.date.startsWith(prefix))
  }, [transactions, selectedYear, selectedMonth])
  const expenses = filtered.filter((t) => t.type === 'expense')
  const incomes = filtered.filter((t) => t.type === 'income')
  // Sums accumulated with Decimal for precision; converted to number only for display/geometry.
  const totalExpenseD = expenses.reduce((s, t) => s.plus(t.amount), new Decimal(0))
  const totalIncomeD = incomes.reduce((s, t) => s.plus(t.amount), new Decimal(0))
  const totalExpense = totalExpenseD.toNumber()
  const totalIncome = totalIncomeD.toNumber()
  const totalBalance = totalIncomeD.minus(totalExpenseD).toNumber()

  const buildCatEntries = (txs: FinancialTransaction[]): [string, number][] => {
    const map: Record<string, Decimal> = {}
    const add = (category: string | undefined, amount: Decimal) => {
      if (amount.lessThanOrEqualTo(0)) return
      const key = category || 'Sem categoria'
      map[key] = (map[key] ?? new Decimal(0)).plus(amount)
    }

    for (const t of txs) {
      // Details only allocate portions of the parent transaction. The parent amount
      // remains the single source of truth for totals, preventing double-counting.
      let remaining = new Decimal(t.amount)
      for (const detail of t.details ?? []) {
        if (remaining.lessThanOrEqualTo(0)) break
        const requested = new Decimal(detail.amount)
        if (requested.lessThanOrEqualTo(0)) continue
        const allocated = requested.lessThan(remaining) ? requested : remaining
        add(detail.category, allocated)
        remaining = remaining.minus(allocated)
      }
      // Details remain allocated to their own categories; only the undisclosed card balance
      // is kept under Cartão, avoiding a second category label for the same payment method.
      add(
        t.category,
        remaining
      )
    }
    return Object.entries(map)
      .map(([k, v]) => [k, v.toNumber()] as [string, number])
      .sort((a, b) => b[1] - a[1])
  }

  const expCatEntries = buildCatEntries(expenses)
  const incCatEntries = buildCatEntries(incomes)
  const activeCatEntries = catView === 'expense' ? expCatEntries : incCatEntries
  const activeTotal = catView === 'expense' ? totalExpense : totalIncome
  const activeMax = activeCatEntries[0]?.[1] ?? 1

  const byMonthD: Record<string, { income: Decimal; expense: Decimal }> = {}
  for (const t of filtered) {
    const key = t.date.slice(0, 7)
    if (!byMonthD[key]) byMonthD[key] = { income: new Decimal(0), expense: new Decimal(0) }
    if (t.type === 'income') byMonthD[key].income = byMonthD[key].income.plus(t.amount)
    else byMonthD[key].expense = byMonthD[key].expense.plus(t.amount)
  }
  const byMonth: Record<string, { income: number; expense: number; balance: number }> = {}
  for (const k of Object.keys(byMonthD)) {
    byMonth[k] = {
      income: byMonthD[k].income.toNumber(),
      expense: byMonthD[k].expense.toNumber(),
      balance: byMonthD[k].income.minus(byMonthD[k].expense).toNumber()
    }
  }
  const monthEntries = Object.entries(byMonth)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => a.key.localeCompare(b.key))

  const maxMonthBar = Math.max(...monthEntries.map((m) => Math.max(m.income, m.expense)), 1)
  const avgMonthlyExpense =
    monthEntries.length > 0 ? totalExpenseD.div(monthEntries.length).toNumber() : 0

  const bestMonth =
    monthEntries.length > 1
      ? monthEntries.reduce((best, m) => (m.balance > best.balance ? m : best))
      : null
  const worstMonth =
    monthEntries.length > 1
      ? monthEntries.reduce((worst, m) => (m.balance < worst.balance ? m : worst))
      : null

  const topExpCat = expCatEntries[0]
  const topIncCat = incCatEntries[0]

  const chartMonths = useMemo(() => {
    const allByMonth: Record<string, { income: Decimal; expense: Decimal }> = {}
    for (const t of transactions) {
      const key = t.date.slice(0, 7)
      if (!allByMonth[key]) allByMonth[key] = { income: new Decimal(0), expense: new Decimal(0) }
      if (t.type === 'income') allByMonth[key].income = allByMonth[key].income.plus(t.amount)
      else allByMonth[key].expense = allByMonth[key].expense.plus(t.amount)
    }
    let accumulated = new Decimal(0)
    const history = Object.entries(allByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => {
        const income = values.income.toNumber()
        const expense = values.expense.toNumber()
        accumulated = accumulated.plus(values.income).minus(values.expense)
        return { key, income, expense, accumulated: accumulated.toNumber() }
      })
    const cashflow =
      selectedYear === 'all'
        ? history
        : history.filter((month) => month.key.startsWith(selectedYear))
    return { cashflow, balance: history }
  }, [transactions, selectedYear])

  function monthLabel(key: string): string {
    const [y, m] = key.split('-')
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[#999999]">
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
              selectedYear === 'all'
                ? 'bg-[#7c3aed]/15 text-[#a080f0]'
                : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
            }`}
          >
            Todos
          </button>
          {allYears.map((y) => (
            <button
              key={y}
              onClick={() => handleYearSelect(y)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedYear === y
                  ? 'bg-[#7c3aed]/15 text-[#a080f0]'
                  : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
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
              onClick={() => onMonthChange('all')}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                selectedMonth === 'all'
                  ? 'bg-[#3b3b3b] text-[#d4d4d4]'
                  : 'text-[#666666] hover:text-[#999999] hover:bg-[#2a2a2a]'
              }`}
            >
              Todos os meses
            </button>
            {availableMonths.map((m) => (
              <button
                key={m}
                onClick={() => onMonthChange(m)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  selectedMonth === m
                    ? 'bg-[#3b3b3b] text-[#d4d4d4]'
                    : 'text-[#666666] hover:text-[#999999] hover:bg-[#2a2a2a]'
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
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
            Total Entradas
          </p>
          <p className="text-sm font-bold text-[#46d478] tabular-nums">
            {formatCurrency(totalIncome, currency)}
          </p>
        </div>
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
            Total Saídas
          </p>
          <p className="text-sm font-bold text-[#e04040] tabular-nums">
            {formatCurrency(totalExpense, currency)}
          </p>
        </div>
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
            Saldo Geral
          </p>
          <p
            className={`text-sm font-bold tabular-nums ${totalBalance >= 0 ? 'text-[#d4d4d4]' : 'text-[#e04040]'}`}
          >
            {totalBalance >= 0 ? '+' : ''}
            {formatCurrency(totalBalance, currency)}
          </p>
        </div>
        <div className="rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a080f0] mb-1">
            Média/Mês Gastos
          </p>
          <p className="text-sm font-bold text-[#a080f0] tabular-nums">
            {formatCurrency(avgMonthlyExpense, currency)}
          </p>
        </div>
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#20b858]/25 bg-[#20b858]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#20b858]/60 mb-1.5">
            Melhor Mês
          </p>
          {bestMonth ? (
            <>
              <p className="text-sm font-bold text-[#46d478]">{monthLabel(bestMonth.key)}</p>
              <p className="text-xs tabular-nums text-[#46d478]/70 mt-0.5">
                {bestMonth.balance >= 0 ? '+' : ''}
                {formatCurrency(bestMonth.balance, currency)}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#666666]">Dados insuficientes</p>
          )}
        </div>
        <div className="rounded-lg border border-[#7c3aed]/25 bg-[#7c3aed]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a080f0]/60 mb-1.5">
            Maior Gasto
          </p>
          {topExpCat ? (
            <>
              <p className="text-sm font-bold text-[#a080f0] truncate">{topExpCat[0]}</p>
              <p className="text-xs tabular-nums text-[#a080f0]/70 mt-0.5">
                {formatCurrency(topExpCat[1], currency)}
                {totalExpense > 0 ? ` · ${Math.round((topExpCat[1] / totalExpense) * 100)}%` : ''}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#666666]">-</p>
          )}
        </div>
        <div className="rounded-lg border border-[#e04040]/25 bg-[#e04040]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#e04040]/60 mb-1.5">
            Pior Mês
          </p>
          {worstMonth ? (
            <>
              <p className="text-sm font-bold text-[#e04040]">{monthLabel(worstMonth.key)}</p>
              <p className="text-xs tabular-nums text-[#e04040]/70 mt-0.5">
                {worstMonth.balance >= 0 ? '+' : ''}
                {formatCurrency(worstMonth.balance, currency)}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#666666]">Dados insuficientes</p>
          )}
        </div>
        <div className="rounded-lg border border-[#20b858]/25 bg-[#20b858]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#20b858]/60 mb-1.5">
            Maior Ganho
          </p>
          {topIncCat ? (
            <>
              <p className="text-sm font-bold text-[#46d478] truncate">{topIncCat[0]}</p>
              <p className="text-xs tabular-nums text-[#46d478]/70 mt-0.5">
                {formatCurrency(topIncCat[1], currency)}
                {totalIncome > 0 ? ` · ${Math.round((topIncCat[1] / totalIncome) * 100)}%` : ''}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#666666]">-</p>
          )}
        </div>
      </div>

      <FinancialCharts
        currency={currency}
        months={chartMonths.cashflow}
        balanceMonths={chartMonths.balance}
        categories={activeCatEntries}
        categoryLabel={catView === 'expense' ? 'gastos' : 'ganhos'}
      />

      {/* Category ranking */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#d4d4d4]">Ranking por Categoria</p>
          <div className="flex items-center p-0.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b]">
            <button
              onClick={() => onCatViewChange('expense')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'expense'
                  ? 'bg-[#3b3b3b] text-[#e04040]'
                  : 'text-[#999999] hover:text-[#d4d4d4]'
              }`}
            >
              ↓ Gastos
            </button>
            <button
              onClick={() => onCatViewChange('income')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'income'
                  ? 'bg-[#3b3b3b] text-[#46d478]'
                  : 'text-[#999999] hover:text-[#d4d4d4]'
              }`}
            >
              ↑ Ganhos
            </button>
          </div>
        </div>

        {activeCatEntries.length === 0 ? (
          <p className="text-xs text-[#666666] italic">
            Sem {catView === 'expense' ? 'gastos' : 'ganhos'} com categorias registradas
          </p>
        ) : (
          <div className="space-y-2.5">
            {activeCatEntries.map(([cat, amount], i) => {
              const color = CAT_COLORS[i % CAT_COLORS.length]
              const pct = activeTotal > 0 ? Math.round((amount / activeTotal) * 100) : 0
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-[#666666] w-5 shrink-0 text-right">
                    #{i + 1}
                  </span>
                  <span className="text-xs text-[#999999] w-28 truncate shrink-0">{cat}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#1b1b1b] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(amount / activeMax) * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-[#d4d4d4] w-24 text-right shrink-0 font-medium">
                    {formatCurrency(amount, currency)}
                  </span>
                  <span className="text-[10px] text-[#999999] w-8 text-right shrink-0">{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Monthly history */}
      {monthEntries.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#d4d4d4] mb-3">Histórico Mensal</p>
          <div className="space-y-2">
            {[...monthEntries].reverse().map((m) => {
              const isBest = bestMonth && m.key === bestMonth.key
              const isWorst = worstMonth && m.key === worstMonth.key
              return (
                <div
                  key={m.key}
                  className={`rounded-lg p-3 border transition-colors ${
                    isBest
                      ? 'border-[#20b858]/25 bg-[#20b858]/5'
                      : isWorst
                        ? 'border-[#e04040]/25 bg-[#e04040]/5'
                        : 'border-[#3b3b3b] bg-[#2a2a2a]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#d4d4d4]">
                        {monthLabel(m.key)}
                      </span>
                      {isBest && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#20b858]/15 text-[#46d478] font-semibold">
                          Melhor
                        </span>
                      )}
                      {isWorst && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#e04040]/15 text-[#e04040] font-semibold">
                          Pior
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold tabular-nums ${m.balance >= 0 ? 'text-[#46d478]' : 'text-[#e04040]'}`}
                    >
                      {m.balance >= 0 ? '+' : ''}
                      {formatCurrency(m.balance, currency)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[#46d478] w-12 shrink-0">Entradas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#1b1b1b] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#20b858]"
                          style={{ width: `${(m.income / maxMonthBar) * 100}%` }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums text-[#46d478] w-24 text-right shrink-0">
                        {formatCurrency(m.income, currency)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[#e04040] w-12 shrink-0">Saídas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#1b1b1b] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#e04040]"
                          style={{ width: `${(m.expense / maxMonthBar) * 100}%` }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums text-[#e04040] w-24 text-right shrink-0">
                        {formatCurrency(m.expense, currency)}
                      </span>
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
