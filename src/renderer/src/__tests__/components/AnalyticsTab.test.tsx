import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FinancialTable } from '../../types'
import { AnalyticsTab } from '../../components/financial/AnalyticsTab'

const list: FinancialTable = {
  id: 'financeiro',
  name: 'Pessoal',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2025-01-10T00:00:00.000Z',
  currency: 'BRL',
  items: [],
  goals: [],
  transactions: [
    {
      id: 'income-2024',
      description: 'Entrada antiga',
      amount: '100',
      type: 'income',
      date: '2024-01-10'
    },
    {
      id: 'expense-2025',
      description: 'Saída recente',
      amount: '25',
      type: 'expense',
      date: '2025-01-10'
    }
  ]
}

describe('AnalyticsTab', () => {
  it('mantém a evolução do saldo em todo o histórico ao filtrar um ano', () => {
    const { container } = render(
      <AnalyticsTab
        list={list}
        selectedYear="2025"
        onYearChange={vi.fn()}
        selectedMonth="all"
        onMonthChange={vi.fn()}
        catView="expense"
        onCatViewChange={vi.fn()}
      />
    )

    const balanceChart = container.querySelector('[aria-label="Evolução mensal do saldo"]')
    expect(balanceChart?.querySelectorAll('circle')).toHaveLength(2)
  })
})
