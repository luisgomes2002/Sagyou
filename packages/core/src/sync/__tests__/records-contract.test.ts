import { describe, expect, it } from 'vitest'
import { extractDataRecords, type SyncRecord } from '../records'

// The sync contract the legacy cleanup must not move: what a record carries and how it hashes.
const T = '2026-10-30T12:00:00.000Z'

const project = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  name: 'Sagyou',
  color: '#6366f1',
  order: 0,
  createdAt: T,
  updatedAt: T,
  columns: [],
  links: [],
  codePaths: [{ id: 'cp1', path: '/home/luis/Sagyou' }],
  activeCodePathIds: ['cp1'],
  ...extra
})

const table = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ft1',
  name: 'Conta',
  currency: 'BRL',
  profileId: 'personal',
  createdAt: T,
  updatedAt: T,
  items: [],
  transactions: [],
  goals: [],
  debts: [],
  yieldSources: [],
  yieldEntries: [],
  ...extra
})

const records = (data: Record<string, unknown>): SyncRecord[] =>
  extractDataRecords({ tasks: [], sprints: [], notes: [], goals: [], habits: [], ...data } as never)

const find = (data: Record<string, unknown>, kind: string, id: string): SyncRecord => {
  const found = records(data).find((r) => r.kind === kind && r.id === id)
  if (!found) throw new Error(`no ${kind} ${id}`)
  return found
}

describe('project record', () => {
  it('has the same payload and hash with or without the retired singular code path field', () => {
    const a = find({ projects: [project({ activeCodePathId: 'cp1' })] }, 'project', 'p1')
    const b = find({ projects: [project()] }, 'project', 'p1')
    expect(a.payload).toEqual(b.payload)
    expect(a.hash).toBe(b.hash)
    expect(a.payload).not.toHaveProperty('activeCodePathId')
    expect(a.payload).not.toHaveProperty('activeCodePathIds')
  })
})

describe('financial_table record', () => {
  it('no longer carries legacyFinancialMetadata, even when the source still has it', () => {
    const plain = find({ lists: [table()] }, 'financial_table', 'ft1')
    const withLegacy = find(
      { lists: [table({ legacyFinancialMetadata: { budget: 500 } })] },
      'financial_table',
      'ft1'
    )
    expect(plain.payload).toMatchObject({ id: 'ft1', name: 'Conta', currency: 'BRL' })
    expect(withLegacy.payload).not.toHaveProperty('legacyFinancialMetadata')
    expect(withLegacy.hash).toBe(plain.hash)
  })
})
