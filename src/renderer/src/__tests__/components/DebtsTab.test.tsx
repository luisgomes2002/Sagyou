import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DebtsTab } from '../../components/financial/DebtsTab'
import type { FinancialTable } from '../../types'

const list: FinancialTable = {
  id: 'account',
  name: 'Conta',
  currency: 'BRL',
  items: [],
  goals: [],
  transactions: [],
  debts: [
    {
      id: 'notebook',
      name: 'Notebook',
      originalAmount: '5000',
      remainingAmount: '4000',
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z'
    },
    {
      id: 'course',
      name: 'Curso',
      originalAmount: '800',
      remainingAmount: '800',
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z'
    }
  ],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z'
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DebtsTab', () => {
  it('mantém uma data de pagamento independente em cada dívida', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T15:00:00-03:00'))
    const onPay = vi.fn(() => true)
    render(<DebtsTab list={list} onAdd={vi.fn()} onPay={onPay} onDelete={vi.fn()} />)

    expect(screen.queryByText('Data dos pagamentos')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Data do pagamento de Notebook')).toHaveValue('2026-10-21')
    expect(screen.getByLabelText('Data do pagamento de Curso')).toHaveValue('2026-10-21')

    fireEvent.change(screen.getByLabelText('Valor do pagamento de Notebook'), {
      target: { value: '200' }
    })
    fireEvent.change(screen.getByLabelText('Data do pagamento de Notebook'), {
      target: { value: '2026-10-10' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento de Notebook' }))

    fireEvent.change(screen.getByLabelText('Valor do pagamento de Curso'), {
      target: { value: '100' }
    })
    fireEvent.change(screen.getByLabelText('Data do pagamento de Curso'), {
      target: { value: '2026-10-15' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento de Curso' }))

    expect(onPay).toHaveBeenNthCalledWith(1, 'notebook', '200', '2026-10-10')
    expect(onPay).toHaveBeenNthCalledWith(2, 'course', '100', '2026-10-15')
  })

  it('explica quando o pagamento ultrapassa o saldo restante', () => {
    const onPay = vi.fn(() => true)
    render(<DebtsTab list={list} onAdd={vi.fn()} onPay={onPay} onDelete={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Valor do pagamento de Curso'), {
      target: { value: '900' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento de Curso' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O pagamento não pode ultrapassar R$ 800,00.'
    )
    expect(onPay).not.toHaveBeenCalled()
  })
})
