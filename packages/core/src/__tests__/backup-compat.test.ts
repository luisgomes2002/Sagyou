import { describe, expect, it } from 'vitest'
import { upgradeLegacyBackup } from '../backup-compat'
import { YIELD_SUMMARY_CATEGORY } from '../yieldSummary'
import type { AiMemory, Backup, FinancialTable, Project } from '../types'

// Everything an old backup file can carry that the current model no longer has lives in
// `upgradeLegacyBackup`, and only the import of a backup calls it.
const T = '2026-01-01T00:00:00.000Z'

const backup = (extra: Partial<Backup> = {}): Backup => ({
  version: 1,
  exportedAt: T,
  projects: [],
  tasks: [],
  ...extra
})

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'P',
  color: '#000000',
  columns: [],
  codePaths: [
    { id: 'a', path: '/a' },
    { id: 'b', path: '/b' }
  ],
  createdAt: T,
  updatedAt: T,
  ...extra
})

const table = (extra: Record<string, unknown> = {}): FinancialTable =>
  ({
    id: 'ft1',
    name: 'Conta',
    currency: 'BRL',
    items: [],
    goals: [],
    transactions: [],
    createdAt: T,
    updatedAt: T,
    ...extra
  }) as FinancialTable

const memory = (extra: Partial<AiMemory> = {}): AiMemory => ({
  id: 'm1',
  projectId: null,
  type: 'decision',
  title: 'T',
  body: 'corpo',
  tags: [],
  pinned: false,
  source: 'user',
  sourceConversationId: null,
  createdAt: T,
  updatedAt: T,
  lastAccessedAt: T,
  accessCount: 0,
  archivedAt: null,
  ...extra
})

describe('upgradeLegacyBackup', () => {
  it('turns the singular code path of a project into the list and drops the field', () => {
    const [p] = upgradeLegacyBackup(backup({ projects: [project({ activeCodePathId: 'b' })] }))
      .projects
    expect(p.activeCodePathIds).toEqual(['b'])
    expect(p).not.toHaveProperty('activeCodePathId')
  })

  it('keeps the list when both exist, and an empty list stays empty', () => {
    const out = upgradeLegacyBackup(
      backup({
        projects: [
          project({ id: 'p1', activeCodePathIds: ['a'], activeCodePathId: 'b' }),
          project({ id: 'p2', activeCodePathIds: [], activeCodePathId: 'b' })
        ]
      })
    )
    expect(out.projects[0].activeCodePathIds).toEqual(['a'])
    expect(out.projects[0]).not.toHaveProperty('activeCodePathId')
    expect(out.projects[1].activeCodePathIds).toEqual([])
    expect(out.projects[1]).not.toHaveProperty('activeCodePathId')
  })

  it('drops the retired budgets, recurring transactions and legacy metadata of a table', () => {
    const [t] =
      upgradeLegacyBackup(
        backup({
          lists: [
            table({
              budgets: [{ category: 'Casa', limit: 100 }],
              recurringTransactions: [{ id: 'monthly', amount: 50 }],
              legacyFinancialMetadata: { budgets: [] }
            })
          ]
        })
      ).lists ?? []
    for (const key of ['budgets', 'recurringTransactions', 'legacyFinancialMetadata']) {
      expect(t).not.toHaveProperty(key)
    }
    expect(t).toMatchObject({ id: 'ft1', name: 'Conta', currency: 'BRL' })
  })

  it('moves an old month-end yield summary to the first day and records the edit', () => {
    const [t] =
      upgradeLegacyBackup(
        backup({
          lists: [
            table({
              transactions: [
                {
                  id: 'gen',
                  description: 'Rendimentos Outubro 2026',
                  amount: '12.5',
                  type: 'income',
                  category: YIELD_SUMMARY_CATEGORY,
                  date: '2026-10-31'
                }
              ]
            })
          ]
        })
      ).lists ?? []
    expect(t.transactions[0].date).toBe('2026-10-01')
    expect(t.transactions[0].audit?.at(-1)?.changes).toEqual([
      { field: 'date', before: '2026-10-31', after: '2026-10-01' }
    ])
  })

  it('drops conversations and chatImages of an old backup', () => {
    const out = upgradeLegacyBackup(
      backup({ conversations: [{ id: 'c1' }], chatImages: [{ id: 'i', ext: '.png', base64: 'x' }] })
    )
    expect(out).not.toHaveProperty('conversations')
    expect(out).not.toHaveProperty('chatImages')
  })

  it('cuts the conversation link and the textual traces of a memory', () => {
    const handoff = memory({
      id: 'm2',
      type: 'handoff',
      body: 'Feito. (conversa completa: id=abc — use ler_conversa)',
      sourceConversationId: 'abc'
    })
    const out = upgradeLegacyBackup(backup({ memories: [memory(), handoff] })).memories ?? []
    expect(out[0]).toEqual(memory())
    expect(out[1].sourceConversationId).toBeNull()
    expect(out[1].body).toBe('Feito.')
  })

  it('is idempotent and leaves a current backup as it was', () => {
    const current = backup({
      version: 7,
      projects: [project({ activeCodePathIds: ['a'] })],
      lists: [table()],
      memories: [memory()]
    })
    expect(upgradeLegacyBackup(current)).toEqual(current)
    const old = backup({ projects: [project({ activeCodePathId: 'a' })], lists: [table({ budgets: [] })] })
    const once = upgradeLegacyBackup(old)
    expect(upgradeLegacyBackup(once)).toEqual(once)
  })

  it('keeps every key it does not know, and does not mutate its input', () => {
    const input = backup({ projects: [project({ activeCodePathId: 'a' })], files: [] })
    const snapshot = JSON.stringify(input)
    const out = upgradeLegacyBackup(input)
    expect(out.files).toEqual([])
    expect(out.version).toBe(1)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
