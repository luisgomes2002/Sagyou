import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionRecordPanel } from '../../components/financial/TransactionRecordPanel'
import type { FinancialTable, FinancialTransaction } from '../../types'
import { useKanbanStore } from '../../store/kanban'

// addFiles schedules a debounced store save; keep it off window.electronAPI.store.
vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
}))

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

  it('fills and removes saved banks without changing the transaction', () => {
    useKanbanStore.setState({
      financialProfiles: [
        {
          id: 'personal',
          name: 'Minhas finanças',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          savedSources: ['Wise'],
          savedCounterparties: ['Loja Central']
        }
      ],
      activeFinancialProfileId: 'personal'
    })
    render(
      <TransactionRecordPanel
        transaction={transaction}
        currency="BRL"
        allLists={[table(transaction)]}
        onUpdate={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Wise' }))
    expect(screen.getByLabelText('Banco ou app de origem')).toHaveValue('Wise')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir banco ou app Wise' }))
    expect(screen.queryByRole('button', { name: 'Wise' })).not.toBeInTheDocument()
    expect(useKanbanStore.getState().financialProfiles[0].savedSources).toEqual([])
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

  it('links a receipt saved as a copy of an existing general file', async () => {
    useKanbanStore.setState({
      files: [
        {
          id: 'old',
          name: 'nota.pdf',
          ext: '.pdf',
          size: 1,
          createdAt: '2026-10-01T00:00:00.000Z'
        }
      ]
    })
    const importFiles = vi.fn(async (items: { token: string; name: string }[]) =>
      items.map((item) => ({
        id: 'receipt-1',
        name: item.name,
        ext: '.pdf',
        size: 1,
        createdAt: '2026-10-27T00:00:00.000Z'
      }))
    )
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      files: {
        pick: vi.fn(async () => ({
          staged: [{ token: 't1', name: 'nota.pdf', size: 1 }],
          skipped: 0,
          overLimit: 0
        })),
        import: importFiles,
        discard: vi.fn(async () => {})
      }
    }
    const onUpdate = vi.fn()
    render(
      <TransactionRecordPanel
        transaction={transaction}
        currency="BRL"
        allLists={[table(transaction)]}
        onUpdate={onUpdate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Anexar arquivo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar cópia' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ receiptFileIds: ['receipt-1'] }))
    expect(importFiles).toHaveBeenCalledWith([{ token: 't1', name: 'nota (2).pdf' }])
  })
})
