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

  it('distribui os detalhes nas categorias sem contar o lançamento duas vezes', () => {
    const detailedList: FinancialTable = {
      ...list,
      transactions: [
        {
          id: 'card-2025',
          description: 'Fatura do cartão',
          amount: '1200',
          type: 'expense',
          date: '2025-01-10',
          category: 'Cartão',
          details: [
            { id: 'food', description: 'Mercado', amount: '700', category: 'Alimentação' },
            { id: 'fun', description: 'Cinema', amount: '500', category: 'Lazer' }
          ]
        }
      ]
    }
    const { getAllByText, queryByText } = render(
      <AnalyticsTab
        list={detailedList}
        selectedYear="2025"
        onYearChange={vi.fn()}
        selectedMonth="all"
        onMonthChange={vi.fn()}
        catView="expense"
        onCatViewChange={vi.fn()}
      />
    )

    expect(getAllByText('Alimentação').length).toBeGreaterThan(0)
    expect(getAllByText('Lazer').length).toBeGreaterThan(0)
    expect(queryByText('Cartão')).toBeNull()
    expect(getAllByText('R$ 700,00').length).toBeGreaterThan(0)
    expect(getAllByText('R$ 500,00').length).toBeGreaterThan(0)
    expect(getAllByText('R$ 1.200,00').length).toBeGreaterThan(0)
  })

  it('separa a parte não detalhada de uma fatura de cartão', () => {
    const detailedList: FinancialTable = {
      ...list,
      transactions: [
        {
          id: 'partial-card-2025',
          description: 'Fatura do cartão',
          amount: '1200',
          type: 'expense',
          date: '2025-01-10',
          category: 'Cartão',
          details: [{ id: 'food', description: 'Mercado', amount: '700', category: 'Alimentação' }]
        }
      ]
    }
    const { getAllByText, queryByText } = render(
      <AnalyticsTab
        list={detailedList}
        selectedYear="2025"
        onYearChange={vi.fn()}
        selectedMonth="all"
        onMonthChange={vi.fn()}
        catView="expense"
        onCatViewChange={vi.fn()}
      />
    )

    expect(getAllByText('Alimentação').length).toBeGreaterThan(0)
    expect(getAllByText('Cartão não detalhado').length).toBeGreaterThan(0)
    expect(queryByText('Cartão')).toBeNull()
    expect(getAllByText('R$ 500,00').length).toBeGreaterThan(0)
  })
})
