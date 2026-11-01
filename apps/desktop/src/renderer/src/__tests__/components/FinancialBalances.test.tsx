import type { ReactElement } from 'react'
import { render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinancialTable, FinancialTransaction } from '../../types'
import { FinanceTab } from '../../components/financial/FinanceTab'
import { ConsolidatedTab } from '../../components/financial/ConsolidatedTab'

const transactions: FinancialTransaction[] = [
  { id: 'income', description: 'Entrada', amount: '100.01', type: 'income', date: '2025-01-01' },
  {
    id: 'today',
    description: 'Gasto de hoje',
    amount: '9.01',
    type: 'expense',
    date: '2025-01-15'
  },
  { id: 'future', description: 'Fatura futura', amount: '20', type: 'expense', date: '2025-02-10' },
  {
    id: 'future-income',
    description: 'Entrada futura',
    amount: '5',
    type: 'income',
    date: '2025-03-10'
  }
]

const list: FinancialTable = {
  id: 'personal',
  name: 'Conta',
  currency: 'BRL',
  profileId: 'personal',
  items: [],
  transactions,
  goals: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
}

afterEach(() => vi.useRealTimers())

describe('saldos financeiros', () => {
  it('recorta o saldo projetado no mês selecionado', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00-03:00'))

    const callbacks = {
      onMonthChange: vi.fn(),
      onCategoryFilterChange: vi.fn(),
      onAddTransaction: vi.fn(),
      onUpdateTransaction: vi.fn(),
      onDeleteTransaction: vi.fn(),
      onAddGoal: vi.fn(),
      onUpdateGoal: vi.fn(),
      onDeleteGoal: vi.fn()
    }
    const { getByText, rerender } = render(
      <FinanceTab
        list={list}
        allLists={[list]}
        activeMonth={{ year: 2025, month: 3 }}
        categoryFilter={null}
        {...callbacks}
      />
    )

    expect(within(getByText('Saldo até hoje').parentElement!).getByText('R$ 91,00')).toBeTruthy()
    expect(within(getByText('Saldo projetado').parentElement!).getByText('R$ 76,00')).toBeTruthy()

    rerender(
      <FinanceTab
        list={list}
        allLists={[list]}
        activeMonth={{ year: 2025, month: 2 }}
        categoryFilter={null}
        {...callbacks}
      />
    )
    expect(within(getByText('Saldo projetado').parentElement!).getByText('R$ 71,00')).toBeTruthy()
  })

  it('mantém lançamentos espelho fora dos dois saldos no Consolidado', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00-03:00'))

    const mirror: FinancialTable = {
      ...list,
      id: 'mirror',
      name: 'Cartão',
      transactions: [
        {
          id: 'mirror-future',
          description: 'Espelho da fatura',
          amount: '20',
          type: 'expense',
          date: '2025-02-10',
          linkedTransactionId: 'future'
        }
      ]
    }
    const { getByText } = render(
      <ConsolidatedTab
        lists={[list, mirror]}
        activeMonth={{ year: 2025, month: 3 }}
        onMonthChange={vi.fn()}
        categoryFilter={null}
        onCategoryFilterChange={vi.fn()}
        onLinkTransaction={vi.fn()}
        onLinkDetail={vi.fn()}
      />
    )

    expect(within(getByText('Saldo até hoje').parentElement!).getByText('R$ 91,00')).toBeTruthy()
    expect(within(getByText('Saldo projetado').parentElement!).getByText('R$ 76,00')).toBeTruthy()
  })

  it('mostra se a meta foi alcançada ou apenas prevista no mês selecionado', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00-03:00'))

    const goalsList: FinancialTable = {
      ...list,
      transactions: [...transactions.slice(0, 3), { ...transactions[3], amount: '30' }],
      goals: [
        { id: 'first', name: 'Meta menor', targetAmount: '85', targetMonth: 4, targetYear: 2025 },
        { id: 'second', name: 'Meta maior', targetAmount: '95', targetMonth: 4, targetYear: 2025 }
      ]
    }
    const callbacks = {
      onMonthChange: vi.fn(),
      onCategoryFilterChange: vi.fn(),
      onAddTransaction: vi.fn(),
      onUpdateTransaction: vi.fn(),
      onDeleteTransaction: vi.fn(),
      onAddGoal: vi.fn(),
      onUpdateGoal: vi.fn(),
      onDeleteGoal: vi.fn()
    }
    const renderMonth = (month: number): ReactElement => (
      <FinanceTab
        list={goalsList}
        allLists={[goalsList]}
        activeMonth={{ year: 2025, month }}
        categoryFilter={null}
        {...callbacks}
      />
    )
    const { getByText, getAllByText, queryByText, rerender } = render(renderMonth(1))

    expect(getByText('Alcançado')).toBeTruthy()
    expect(queryByText('Previsto atingir')).toBeNull()

    rerender(renderMonth(2))
    expect(queryByText('Alcançado')).toBeNull()
    expect(queryByText('Previsto atingir')).toBeNull()

    rerender(renderMonth(3))
    expect(getAllByText('Previsto atingir')).toHaveLength(1)
    expect(getByText('Alcançado')).toBeTruthy()
  })
})
