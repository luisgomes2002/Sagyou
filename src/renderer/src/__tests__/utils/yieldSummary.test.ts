import { describe, expect, it } from 'vitest'
import type { FinancialTable } from '../../types'
import { migrateYieldSummaryDates, YIELD_SUMMARY_CATEGORY } from '../../utils/yieldSummary'

const table: FinancialTable = {
  id: 'account',
  name: 'Conta',
  currency: 'BRL',
  items: [],
  goals: [],
  transactions: [
    {
      id: 'generated',
      description: 'Rendimentos Outubro 2026',
      amount: '12.5',
      type: 'income',
      category: YIELD_SUMMARY_CATEGORY,
      date: '2026-10-31',
      reconciledAt: '2026-11-01T12:00:00.000Z'
    },
    {
      id: 'manual',
      description: 'Rendimentos Outubro 2026',
      amount: '8',
      type: 'income',
      category: 'Outros',
      date: '2026-10-31'
    },
    {
      id: 'moved',
      description: 'Rendimentos Setembro 2026',
      amount: '5',
      type: 'income',
      category: YIELD_SUMMARY_CATEGORY,
      date: '2026-09-15'
    }
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z'
}

describe('migrateYieldSummaryDates', () => {
  it('move apenas o resumo automático do último para o primeiro dia e registra a alteração', () => {
    const migrated = migrateYieldSummaryDates(table)
    const generated = migrated.transactions[0]

    expect(generated.date).toBe('2026-10-01')
    expect(generated.amount).toBe('12.5')
    expect(generated.reconciledAt).toBeUndefined()
    expect(generated.audit?.at(-1)?.changes).toEqual([
      { field: 'date', before: '2026-10-31', after: '2026-10-01' },
      { field: 'reconciledAt', before: '2026-11-01T12:00:00.000Z', after: undefined }
    ])
    expect(migrated.transactions[1]).toEqual(table.transactions[1])
    expect(migrated.transactions[2]).toEqual(table.transactions[2])
    expect(migrateYieldSummaryDates(migrated)).toBe(migrated)
  })
})
