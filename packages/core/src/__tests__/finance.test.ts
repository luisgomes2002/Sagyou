import { describe, expect, it } from 'vitest'
import { newTransaction, parseDecimalInput, tableBalance } from '../finance'
import type { FinancialTransaction } from '../types'

const tx = (amount: string, type: 'income' | 'expense', date: string): FinancialTransaction => ({
  id: `${type}-${date}`,
  description: '',
  amount,
  type,
  date
})

describe('tableBalance', () => {
  const list = [tx('1500.50', 'income', '2026-10-01'), tx('0.5', 'expense', '2026-10-02')]

  it('conta só o que vence até o corte', () => {
    expect(tableBalance(list, '2026-10-01').toString()).toBe('1500.5')
    expect(tableBalance(list, '2026-10-31').toString()).toBe('1500')
  })

  it('é zero sem transações', () => {
    expect(tableBalance([], '2026-10-31').toString()).toBe('0')
  })
})

describe('newTransaction', () => {
  it('grava dinheiro como string decimal canônica e createdAt', () => {
    const t = newTransaction(
      {
        type: 'expense',
        amount: '10.10',
        date: '2026-10-31',
        category: 'Mercado',
        description: ' Pão '
      },
      new Date('2026-10-31T12:00:00.000Z')
    )
    expect(t.amount).toBe('10.1')
    expect(t.description).toBe('Pão')
    expect(t.createdAt).toBe('2026-10-31T12:00:00.000Z')
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('parseDecimalInput', () => {
  it('lê 1.000 em iene como mil', () => {
    expect(parseDecimalInput('1.000', 'JPY')?.toString()).toBe('1000')
  })

  it('lê 1.234,56 em real', () => {
    expect(parseDecimalInput('1.234,56', 'BRL')?.toString()).toBe('1234.56')
  })
})
