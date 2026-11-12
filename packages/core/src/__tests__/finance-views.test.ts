import { describe, expect, it } from 'vitest'
import {
  categoryBreakdown,
  consolidatedByCurrency,
  goalProgress,
  monthBounds
} from '../finance-views'
import type { Currency, FinancialGoal, FinancialTable, FinancialTransaction } from '../types'

// Every expected value below was worked out by hand from the rules the desktop's tabs applied inline
// (ConsolidatedTab, FinanceTab, FinancialGoalCard) before they moved to the core.

const TODAY = '2026-11-10'

function tx(
  id: string,
  type: 'income' | 'expense',
  amount: string,
  date: string,
  extra: Partial<FinancialTransaction> = {}
): FinancialTransaction {
  return { id, description: id, amount, type, date, ...extra }
}

function table(
  id: string,
  currency: Currency,
  transactions: FinancialTransaction[]
): FinancialTable {
  return {
    id,
    name: id,
    currency,
    profileId: 'personal',
    items: [],
    transactions,
    goals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('monthBounds', () => {
  it('no mês atual o corte é hoje', () => {
    expect(monthBounds('2026-11', TODAY)).toEqual({
      currentCutoff: '2026-11-10',
      monthEnd: '2026-11-31'
    })
  })

  it('num mês passado o corte é o fim do mês', () => {
    expect(monthBounds('2026-10', TODAY)).toEqual({
      currentCutoff: '2026-10-31',
      monthEnd: '2026-10-31'
    })
  })

  it('num mês futuro o corte continua sendo hoje', () => {
    expect(monthBounds('2027-01', TODAY)).toEqual({
      currentCutoff: '2026-11-10',
      monthEnd: '2027-01-31'
    })
  })
})

describe('consolidatedByCurrency', () => {
  const tableA = table('A', 'BRL', [
    tx('a1', 'income', '1000', '2026-11-02'),
    tx('a2', 'expense', '200', '2026-11-05', { category: 'Mercado' }),
    tx('a3', 'income', '500', '2026-11-20'),
    tx('a4', 'expense', '100', '2026-10-15'),
    // Legacy link: the child (in B) points at this parent, so the parent is the one left out.
    tx('parent', 'expense', '300', '2026-11-06'),
    // Invoice whose detail is mirrored in B: the invoice counts, the mirror does not.
    tx('invoice', 'expense', '400', '2026-11-08', {
      details: [{ id: 'd1', description: 'item', amount: '400', linkedTransactionId: 'mirror' }]
    })
  ])
  const tableB = table('B', 'BRL', [
    tx('child', 'expense', '300', '2026-11-06', { linkedTransactionId: 'parent' }),
    tx('mirror', 'expense', '400', '2026-11-08')
  ])
  const tableJpy = table('J', 'JPY', [
    tx('j1', 'income', '100000', '2026-11-03'),
    tx('j2', 'expense', '30000', '2026-12-01')
  ])
  const tableUsd = table('U', 'USD', [])

  it('nunca soma moedas, deixa os espelhos de fora e inclui moeda de tabela vazia', () => {
    const result = consolidatedByCurrency([tableJpy, tableA, tableUsd, tableB], '2026-11', TODAY)
    expect(result).toEqual([
      // income 1000 + 500; expense 200 + 400 (invoice) + 300 (child). Parent and mirror are out.
      // current (<= 11-10): +1000 -200 -100 -400 -300 = 0; projected adds the 500 on 11-20.
      { currency: 'BRL', income: '1500', expense: '900', current: '0', projected: '500' },
      { currency: 'JPY', income: '100000', expense: '0', current: '100000', projected: '100000' },
      { currency: 'USD', income: '0', expense: '0', current: '0', projected: '0' }
    ])
  })

  it('o filtro de categoria muda só o mês, não os saldos', () => {
    const result = consolidatedByCurrency([tableA, tableB], '2026-11', TODAY, 'Mercado')
    expect(result).toEqual([
      { currency: 'BRL', income: '0', expense: '200', current: '0', projected: '500' }
    ])
  })

  it('num mês passado o saldo atual para no fim do mês', () => {
    const [brl] = consolidatedByCurrency([tableA, tableB], '2026-10', TODAY)
    // Only a4 (-100) is dated up to 10-31; current and projected agree.
    expect(brl).toEqual({
      currency: 'BRL',
      income: '0',
      expense: '100',
      current: '-100',
      projected: '-100'
    })
  })

  it('mantém decimais exatos', () => {
    const [brl] = consolidatedByCurrency(
      [
        table('A', 'BRL', [
          tx('x', 'expense', '0.1', '2026-11-01'),
          tx('y', 'expense', '0.2', '2026-11-02')
        ])
      ],
      '2026-11',
      TODAY
    )
    expect(brl.expense).toBe('0.3')
    expect(brl.current).toBe('-0.3')
  })
})

describe('categoryBreakdown', () => {
  it('soma só os gastos do mês, do maior para o menor, e usa "" sem categoria', () => {
    const result = categoryBreakdown(
      [
        tx('1', 'expense', '30', '2026-11-01', { category: 'Mercado' }),
        tx('2', 'expense', '70', '2026-11-02', { category: 'Lazer' }),
        tx('3', 'expense', '20', '2026-11-03', { category: 'Mercado' }),
        tx('4', 'expense', '5', '2026-11-04'),
        tx('5', 'income', '1000', '2026-11-05', { category: 'Salário' }),
        tx('6', 'expense', '99', '2026-10-31', { category: 'Mercado' }),
        tx('7', 'expense', '0.1', '2026-11-06', { category: 'Pet' }),
        tx('8', 'expense', '0.2', '2026-11-07', { category: 'Pet' })
      ],
      '2026-11'
    )
    expect(result).toEqual([
      { category: 'Lazer', amount: '70' },
      { category: 'Mercado', amount: '50' },
      { category: '', amount: '5' },
      { category: 'Pet', amount: '0.3' }
    ])
  })

  it('é vazio sem gastos no mês', () => {
    expect(categoryBreakdown([tx('1', 'income', '10', '2026-11-01')], '2026-11')).toEqual([])
  })
})

describe('goalProgress', () => {
  const goal: FinancialGoal = {
    id: 'g',
    name: 'Reserva',
    targetAmount: '1000',
    targetMonth: 12,
    targetYear: 2026
  }

  it('abaixo do alvo', () => {
    const result = goalProgress(goal, [tx('a', 'income', '400', '2026-11-02')], '2026-11', TODAY)
    expect(result).toEqual({
      effectiveBalance: '400',
      actualBalance: '400',
      progress: 0.4,
      percent: 40,
      manuallyCompleted: false,
      achieved: false,
      projected: false,
      overdue: false
    })
  })

  it('alcançado no mês', () => {
    const result = goalProgress(goal, [tx('a', 'income', '1200', '2026-11-02')], '2026-11', TODAY)
    expect(result).toMatchObject({
      effectiveBalance: '1200',
      actualBalance: '1200',
      percent: 100,
      achieved: true,
      projected: false,
      overdue: false
    })
    expect(result.progress).toBe(1)
  })

  it('alcançado só com lançamentos futuros é projetado', () => {
    const txs = [tx('a', 'income', '600', '2026-11-02'), tx('b', 'income', '500', '2026-11-20')]
    const result = goalProgress(goal, txs, '2026-12', TODAY)
    // Dec view counts both (1100); what already happened (up to today) is 600.
    expect(result).toMatchObject({
      effectiveBalance: '1100',
      actualBalance: '600',
      percent: 100,
      achieved: true,
      projected: true,
      overdue: false
    })
  })

  it('no mês atual o futuro não conta', () => {
    const txs = [tx('a', 'income', '600', '2026-11-02'), tx('b', 'income', '500', '2026-11-20')]
    expect(goalProgress(goal, txs, '2026-11', TODAY)).toMatchObject({
      effectiveBalance: '600',
      percent: 60,
      achieved: false,
      projected: false
    })
  })

  it('prazo passado sem alcançar fica atrasada e ignora o que veio depois do prazo', () => {
    const txs = [tx('a', 'income', '300', '2026-11-02'), tx('b', 'income', '900', '2027-01-05')]
    const result = goalProgress(goal, txs, '2027-01', TODAY)
    expect(result).toMatchObject({
      effectiveBalance: '300',
      percent: 30,
      achieved: false,
      projected: false,
      overdue: true
    })
  })

  it('concluída à mão antes do mês escolhido conta como alcançada, mesmo sem saldo', () => {
    const done = { ...goal, completedAt: '2026-10-20' }
    const result = goalProgress(done, [tx('a', 'income', '100', '2026-11-02')], '2026-11', TODAY)
    expect(result).toMatchObject({
      manuallyCompleted: true,
      percent: 100,
      achieved: true,
      projected: false,
      overdue: false
    })
    expect(result.progress).toBe(1)
  })

  it('a conclusão à mão só vale a partir do mês em que foi feita', () => {
    const done = { ...goal, completedAt: '2026-10-20' }
    const result = goalProgress(done, [tx('a', 'income', '100', '2026-08-02')], '2026-09', TODAY)
    expect(result).toMatchObject({ manuallyCompleted: false, percent: 10, achieved: false })
  })

  it('meta com alvo zero não tem progresso', () => {
    const zero = { ...goal, targetAmount: '0' }
    expect(goalProgress(zero, [], '2026-11', TODAY).percent).toBe(0)
  })
})
