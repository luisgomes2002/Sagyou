import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionRecordPanel } from '../../components/financial/TransactionRecordPanel'
import type { FinancialTable, FinancialTransaction } from '../../types'

const transaction: FinancialTransaction = {
  id: 'tx-1',
  description: 'Transferência',
  amount: '10',
  type: 'expense',
  date: '2026-10-06'
}

function table(tx: FinancialTransaction): FinancialTable {
  return {
    id: 'brl',
    name: 'Brasil',
    currency: 'BRL',
    items: [],
    transactions: [tx],
    goals: [],
    createdAt: '2026-10-06',
    updatedAt: '2026-10-06'
  }
}

describe('TransactionRecordPanel bank details', () => {
  it('saves the three fields together only when Save is clicked', () => {
    const onUpdate = vi.fn()
    render(
      <TransactionRecordPanel
        transaction={transaction}
        currency="BRL"
        allLists={[table(transaction)]}
        onUpdate={onUpdate}
      />
    )

    fireEvent.change(screen.getByLabelText('Banco ou app de origem'), { target: { value: 'Wise' } })
    fireEvent.change(screen.getByLabelText('Quem recebeu'), { target: { value: 'Loja' } })
    fireEvent.change(screen.getByLabelText('ID bancário/Pix'), { target: { value: 'ABC-123' } })
    fireEvent.blur(screen.getByLabelText('ID bancário/Pix'))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Alterações não salvas')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledWith({
      source: 'Wise',
      counterparty: 'Loja',
      bankReference: 'ABC-123'
    })
    expect(screen.getByRole('status')).toHaveTextContent('Informações salvas')
  })

  it('labels the counterparty as the payer for income', () => {
    const income = { ...transaction, type: 'income' as const }
    render(
      <TransactionRecordPanel
        transaction={income}
        currency="BRL"
        allLists={[table(income)]}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Quem pagou')).toBeInTheDocument()
  })

  it('shows an old reconciliation without an action to change it', () => {
    const reconciled = { ...transaction, reconciledAt: '2026-10-06T13:00:00Z' }
    render(
      <TransactionRecordPanel
        transaction={reconciled}
        currency="BRL"
        allLists={[table(reconciled)]}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByText(/Conferido com extrato em/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conferido com extrato/i })).not.toBeInTheDocument()
  })
})
