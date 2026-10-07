import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FinancialTable, FinancialTransaction } from '../../types'
import { YieldsTab } from '../../components/financial/YieldsTab'
import { YIELD_SUMMARY_CATEGORY } from '../../utils/yieldSummary'

const list: FinancialTable = {
  id: 'account',
  name: 'Conta',
  currency: 'BRL',
  items: [],
  goals: [],
  transactions: [],
  yieldSources: [{ id: 'source', name: 'Poupança', createdAt: '2026-10-01T00:00:00.000Z' }],
  yieldEntries: [
    {
      id: 'entry',
      sourceId: 'source',
      date: '2026-10-05',
      amount: '12.5',
      createdAt: '2026-10-05T12:00:00.000Z'
    }
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z'
}

function renderYields(
  financialList: FinancialTable,
  onAddTransaction: (data: Omit<FinancialTransaction, 'id'>) => void,
  onUpdateTransaction: (txId: string, updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
): void {
  render(
    <YieldsTab
      list={financialList}
      activeMonth={{ year: 2026, month: 10 }}
      onMonthChange={vi.fn()}
      onAddSource={vi.fn()}
      onUpdateSource={vi.fn()}
      onDeleteSource={vi.fn()}
      onAddEntry={vi.fn()}
      onUpdateEntry={vi.fn()}
      onDeleteEntry={vi.fn()}
      onAddTransaction={onAddTransaction}
      onUpdateTransaction={onUpdateTransaction}
      onDeleteTransaction={vi.fn()}
    />
  )
}

describe('YieldsTab', () => {
  it('registra o resumo mensal no primeiro dia', () => {
    const onAddTransaction = vi.fn()
    renderYields(list, onAddTransaction, vi.fn())

    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Rendimentos Outubro 2026',
        date: '2026-10-01',
        amount: '12.5',
        category: YIELD_SUMMARY_CATEGORY
      })
    )
  })

  it('corrige a data de um resumo antigo mesmo quando o valor já coincide', () => {
    const onUpdateTransaction = vi.fn()
    renderYields(
      {
        ...list,
        transactions: [
          {
            id: 'old-summary',
            description: 'Rendimentos Outubro 2026',
            amount: '12.5',
            type: 'income',
            category: YIELD_SUMMARY_CATEGORY,
            date: '2026-10-31'
          }
        ]
      },
      vi.fn(),
      onUpdateTransaction
    )

    expect(onUpdateTransaction).toHaveBeenCalledWith('old-summary', {
      amount: '12.5',
      date: '2026-10-01'
    })
  })
})
