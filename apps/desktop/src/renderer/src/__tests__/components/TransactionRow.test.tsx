import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionRow } from '../../components/financial/TransactionRow'
import type { FinancialTable, FinancialTransaction } from '../../types'

describe('TransactionRow', () => {
  it('keeps existing details closed until requested', () => {
    const tx: FinancialTransaction = {
      id: 'tx-1',
      description: 'Compra',
      amount: '20',
      type: 'expense',
      date: '2026-10-06',
      details: [{ id: 'detail-1', description: 'Item detalhado', amount: '5' }]
    }
    const list: FinancialTable = {
      id: 'table-1',
      name: 'Brasil',
      currency: 'BRL',
      items: [],
      transactions: [tx],
      goals: [],
      createdAt: '2026-10-06',
      updatedAt: '2026-10-06'
    }
    render(
      <table>
        <tbody>
          <TransactionRow
            tx={tx}
            receiptCount={0}
            currency="BRL"
            allLists={[list]}
            onUpdate={vi.fn()}
          />
        </tbody>
      </table>
    )

    expect(screen.getByRole('button', { name: '1 item(ns)' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Item detalhado')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 item(ns)' }))
    expect(screen.getByDisplayValue('Item detalhado')).toBeInTheDocument()
  })

  it('opens the exact transaction and its matching detail from search', () => {
    const tx: FinancialTransaction = {
      id: 'tx-1',
      description: 'Compra',
      amount: '20',
      type: 'expense',
      date: '2026-10-06',
      details: [{ id: 'detail-1', description: 'Item detalhado', amount: '5' }]
    }
    const list: FinancialTable = {
      id: 'table-1',
      name: 'Brasil',
      currency: 'BRL',
      items: [],
      transactions: [tx],
      goals: [],
      createdAt: '2026-10-06',
      updatedAt: '2026-10-06'
    }
    const { rerender } = render(
      <table>
        <tbody>
          <TransactionRow
            tx={tx}
            searchTargetId="tx-1"
            receiptCount={0}
            currency="BRL"
            allLists={[list]}
            onUpdate={vi.fn()}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('ID bancário/Pix')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Item detalhado')).not.toBeInTheDocument()

    rerender(
      <table>
        <tbody>
          <TransactionRow
            key="detail-1"
            tx={tx}
            searchTargetId="detail-1"
            receiptCount={0}
            currency="BRL"
            allLists={[list]}
            onUpdate={vi.fn()}
          />
        </tbody>
      </table>
    )
    expect(screen.getByDisplayValue('Item detalhado')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Item detalhado').closest('.ring-2')).toBeInTheDocument()
  })
})
