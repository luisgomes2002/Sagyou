import type { Currency } from '../../types'
import { formatCurrency } from './shared'

interface ChartMonth {
  key: string
  income: number
  expense: number
  accumulated: number
}

interface FinancialChartsProps {
  currency: Currency
  months: ChartMonth[]
  categories: [string, number][]
  categoryLabel: string
}

const COLORS = ['#a080f0', '#48c0d0', '#e8b848', '#e890ac', '#60c080']
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function label(key: string): string {
  return MONTHS[Number(key.slice(5, 7)) - 1]
}

function CashflowChart({ months, currency }: Pick<FinancialChartsProps, 'months' | 'currency'>) {
  const max = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1)
  const width = Math.max(600, months.length * 54)
  const height = 180
  const plotHeight = 135
  const graphWidth = width - 24
  const slot = graphWidth / months.length
  const bar = Math.min(14, (slot - 4) / 2)

  return (
    <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#d4d4d4]">Entradas e saídas por mês</p>
        <div className="flex gap-2 text-[9px] text-[#999999]">
          <span className="inline-flex items-center gap-1">
            <i className="w-1.5 h-1.5 rounded-full bg-[#20b858]" />
            Entradas
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="w-1.5 h-1.5 rounded-full bg-[#e04040]" />
            Saídas
          </span>
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={'0 0 ' + width + ' ' + height}
          className="h-44 min-w-full"
          style={{ width }}
          role="img"
          aria-label="Entradas e saídas mensais"
        >
          {[0, 0.5, 1].map((line) => (
            <line
              key={line}
              x1="12"
              x2={width - 12}
              y1={12 + plotHeight * line}
              y2={12 + plotHeight * line}
              stroke="#3b3b3b"
            />
          ))}
          {months.map((month, index) => {
            const x = 12 + slot * index + (slot - bar * 2 - 3) / 2
            const income = (month.income / max) * plotHeight
            const expense = (month.expense / max) * plotHeight
            return (
              <g key={month.key}>
                <title>
                  {label(month.key) +
                    ': entradas ' +
                    formatCurrency(month.income, currency) +
                    ', saídas ' +
                    formatCurrency(month.expense, currency)}
                </title>
                <rect
                  x={x}
                  y={12 + plotHeight - income}
                  width={bar}
                  height={income}
                  rx="2"
                  fill="#20b858"
                />
                <rect
                  x={x + bar + 3}
                  y={12 + plotHeight - expense}
                  width={bar}
                  height={expense}
                  rx="2"
                  fill="#e04040"
                />
                <text
                  x={12 + slot * index + slot / 2}
                  y="171"
                  textAnchor="middle"
                  fill="#999999"
                  fontSize="9"
                >
                  {label(month.key)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function BalanceChart({ months, currency }: Pick<FinancialChartsProps, 'months' | 'currency'>) {
  const values = months.map((m) => m.accumulated)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const range = max - min || 1
  const width = Math.max(600, months.length * 54)
  const height = 180
  const plotHeight = 135
  const left = 58
  const right = 12
  const graphWidth = width - left - right
  const x = (index: number) => left + (graphWidth * index) / Math.max(months.length - 1, 1)
  const y = (value: number) => 12 + ((max - value) / range) * plotHeight
  const ticks = [...new Set([max, 0, min])].sort((a, b) => b - a)
  const last = months[months.length - 1]

  return (
    <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#d4d4d4]">Evolução do saldo</p>
        <span
          className={
            'text-[10px] tabular-nums font-semibold ' +
            (last.accumulated >= 0 ? 'text-[#a080f0]' : 'text-[#e04040]')
          }
        >
          {formatCurrency(last.accumulated, currency)}
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={'0 0 ' + width + ' ' + height}
          className="h-44 min-w-full"
          style={{ width }}
          role="img"
          aria-label="Evolução mensal do saldo"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? '#666666' : '#3b3b3b'}
                strokeDasharray={tick === 0 ? '3 3' : undefined}
              />
              <text x={left - 6} y={y(tick) + 3} textAnchor="end" fill="#999999" fontSize="8">
                {formatCurrency(tick, currency)}
              </text>
            </g>
          ))}
          <polyline
            points={months.map((m, i) => x(i) + ',' + y(m.accumulated)).join(' ')}
            fill="none"
            stroke="#a080f0"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {months.map((month, index) => (
            <g key={month.key}>
              <title>
                {label(month.key) +
                  ': saldo acumulado ' +
                  formatCurrency(month.accumulated, currency)}
              </title>
              <circle cx={x(index)} cy={y(month.accumulated)} r="3" fill="#a080f0" />
              <text x={x(index)} y="171" textAnchor="middle" fill="#999999" fontSize="9">
                {label(month.key)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function CategoryChart({
  categories,
  currency,
  categoryLabel
}: Pick<FinancialChartsProps, 'categories' | 'currency' | 'categoryLabel'>) {
  const visible = categories.slice(0, 5)
  const total = categories.reduce((sum, [, amount]) => sum + amount, 0)
  const slices: string[] = []
  let cursor = 0
  for (const [, amount] of visible) {
    const end = cursor + (amount / total) * 100
    slices.push(COLORS[slices.length] + ' ' + cursor + '% ' + end + '%')
    cursor = end
  }
  if (cursor < 100) slices.push('#666666 ' + cursor + '% 100%')

  return (
    <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
      <p className="text-xs font-semibold text-[#d4d4d4] mb-3">
        Distribuição por categoria — {categoryLabel}
      </p>
      {total === 0 ? (
        <p className="py-8 text-center text-xs text-[#666666]">Sem lançamentos categorizados</p>
      ) : (
        <div className="flex items-center gap-5">
          <div
            className="relative shrink-0 w-28 h-28 rounded-full"
            style={{ background: 'conic-gradient(' + slices.join(', ') + ')' }}
          >
            <div className="absolute inset-5 rounded-full bg-[#2a2a2a] flex flex-col items-center justify-center">
              <span className="text-[9px] text-[#999999]">Total</span>
              <span className="text-[10px] font-semibold text-[#d4d4d4] tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {visible.map(([category, amount], index) => (
              <div key={category} className="flex items-center gap-2 text-[10px]">
                <i
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[index] }}
                />
                <span className="truncate text-[#999999] flex-1">{category}</span>
                <span className="tabular-nums text-[#d4d4d4]">
                  {Math.round((amount / total) * 100)}%
                </span>
              </div>
            ))}
            {categories.length > visible.length && (
              <p className="text-[9px] text-[#666666]">+ outras categorias</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function FinancialCharts({
  currency,
  months,
  categories,
  categoryLabel
}: FinancialChartsProps) {
  if (months.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-[#d4d4d4]">Gráficos</p>
        <span className="text-[10px] text-[#666666]">Todo o histórico · {currency}</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <CashflowChart months={months} currency={currency} />
        <BalanceChart months={months} currency={currency} />
      </div>
      <CategoryChart categories={categories} currency={currency} categoryLabel={categoryLabel} />
    </section>
  )
}
