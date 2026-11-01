import { emptyState, type MobileState } from '../../data/state'
import {
  LOCKED_TEXT,
  addTransaction,
  parseAmount,
  tablesOfProfile,
  updateTransaction
} from '../finance'

const T = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-10-31T12:00:00.000Z')

function state(): MobileState {
  const s = emptyState()
  s.lists = [
    {
      id: 'brl',
      name: 'Conta',
      currency: 'BRL',
      profileId: 'personal',
      legacyFinancialMetadata: { budget: 500 },
      items: [],
      goals: [],
      transactions: [
        {
          id: 'tx1',
          description: 'Mercado',
          amount: '100',
          type: 'expense',
          date: '2026-10-10',
          receiptFileIds: ['f1'],
          details: [{ id: 'd1', description: 'Arroz', amount: '20' }],
          reconciledAt: T,
          audit: [{ at: T, changes: [{ field: 'category', before: 'A', after: 'B' }] }]
        },
        {
          id: 'pay',
          description: 'Parcela',
          amount: '50',
          type: 'expense',
          date: '2026-10-11',
          debtId: 'debt1'
        }
      ],
      createdAt: T,
      updatedAt: T
    } as MobileState['lists'][number],
    {
      id: 'jpy',
      name: '円',
      currency: 'JPY',
      profileId: 'trabalho',
      items: [],
      goals: [],
      transactions: [],
      createdAt: T,
      updatedAt: T
    } as MobileState['lists'][number]
  ]
  return s
}

describe('lançamentos no celular', () => {
  it('lê o valor com a moeda da tabela e grava string decimal', () => {
    expect(parseAmount('1.234,56', 'BRL')).toBe('1234.56')
    expect(parseAmount('1.000', 'JPY')).toBe('1000')
    expect(parseAmount('0', 'BRL')).toBeNull()
    expect(parseAmount('abc', 'BRL')).toBeNull()
    const { state: next, id } = addTransaction(
      state(),
      'brl',
      {
        type: 'expense',
        amount: parseAmount('1.234,56', 'BRL')!,
        date: '2026-10-31',
        category: 'Alimentação',
        description: 'Almoço'
      },
      NOW
    )
    expect(next.lists[0].transactions.find((t) => t.id === id)).toMatchObject({
      amount: '1234.56',
      type: 'expense',
      createdAt: NOW.toISOString()
    })
  })

  it('editar o valor audita, limpa a conciliação e preserva o resto', () => {
    const result = updateTransaction(state(), 'brl', 'tx1', { amount: '120' }, NOW)
    if ('error' in result) throw new Error(result.error)
    const table = result.state.lists[0]
    const tx = table.transactions[0]
    expect(tx.amount).toBe('120')
    expect(tx.reconciledAt).toBeUndefined()
    expect(tx.audit).toHaveLength(2)
    expect(tx.audit?.[0]).toEqual(state().lists[0].transactions[0].audit?.[0])
    expect(tx.audit?.[1].changes.map((c) => c.field)).toEqual(['amount', 'reconciledAt'])
    expect(tx.receiptFileIds).toEqual(['f1'])
    expect(tx.details).toEqual([{ id: 'd1', description: 'Arroz', amount: '20' }])
    expect(table.legacyFinancialMetadata).toEqual({ budget: 500 })
  })

  it('pagamento de dívida não é editável no celular', () => {
    expect(updateTransaction(state(), 'brl', 'pay', { amount: '1' }, NOW)).toEqual({
      error: LOCKED_TEXT
    })
  })

  it('o seletor mostra só as tabelas do perfil ativo', () => {
    expect(tablesOfProfile(state(), 'personal').map((t) => t.id)).toEqual(['brl'])
    expect(tablesOfProfile(state(), 'trabalho').map((t) => t.id)).toEqual(['jpy'])
  })
})
