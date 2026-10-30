// @vitest-environment node
//
// A sync record is one small unit (a transaction, a habit day, a column), hashed
// in the form SQLite stores it. Two shapes of the same data — the renderer's
// object and what loadData() reads back — must hash alike, or every session
// would re-version everything on its first save.
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  extractDataRecords,
  extractMemoryRecords,
  type SyncRecord
} from '../modules/sync/sync-records'
import type { AiMemory } from '../modules/ai/memory'

const T = '2026-10-30T12:00:00.000Z'

function sample(): Record<string, unknown> {
  return {
    projects: [
      {
        id: 'p1',
        name: 'Sagyou',
        color: '#6366f1',
        order: 0,
        createdAt: T,
        updatedAt: T,
        columns: [
          { id: 'c1', name: 'Backlog', order: 0 },
          { id: 'c2', name: 'Done', order: 1 }
        ],
        links: [{ id: 'l1', label: 'GitHub', url: 'https://github.com' }],
        codePaths: [{ id: 'cp1', path: '/home/luis/Sagyou' }],
        activeCodePathIds: ['cp1'],
        activeCodePathId: 'cp1'
      }
    ],
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        columnId: 'c1',
        title: 'Tarefa',
        priority: 'medium',
        tags: ['b', 'a'],
        order: 0,
        createdAt: T,
        updatedAt: T
      }
    ],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [
      {
        id: 'h1',
        name: 'Água',
        color: '#000',
        completions: ['2026-10-29', '2026-10-30'],
        createdAt: T,
        updatedAt: T
      }
    ],
    lists: [
      {
        id: 'ft1',
        name: 'Conta',
        currency: 'BRL',
        profileId: 'personal',
        createdAt: T,
        updatedAt: T,
        items: [{ id: 'i1', name: 'Pão', qty: 1, price: '5', done: false }],
        transactions: [
          {
            id: 'tx1',
            description: 'Mercado',
            amount: '1500.5',
            type: 'expense',
            date: '2026-10-30'
          }
        ],
        goals: [
          { id: 'fg1', name: 'Reserva', targetAmount: '1000', targetMonth: 12, targetYear: 2026 }
        ],
        debts: [
          {
            id: 'd1',
            name: 'Cartão',
            originalAmount: '300',
            remainingAmount: '200',
            createdAt: T,
            updatedAt: T
          }
        ],
        yieldSources: [{ id: 'ys1', name: 'CDB', createdAt: T }],
        yieldEntries: [
          { id: 'ye1', sourceId: 'ys1', date: '2026-10-01', amount: '10', createdAt: T }
        ]
      }
    ],
    files: [],
    activeTimers: [{ taskId: 't1', startedAt: 1 }],
    uiPreferences: { theme: 'dark' }
  }
}

type Sample = ReturnType<typeof sample> & {
  projects: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  habits: Record<string, unknown>[]
  lists: Record<string, unknown>[]
}

function data(): Sample {
  return sample() as Sample
}

function find(records: SyncRecord[], kind: string, id: string): SyncRecord {
  const record = records.find((r) => r.kind === kind && r.id === id)
  if (!record) throw new Error(`missing ${kind}:${id}`)
  return record
}

function hashOf(source: Record<string, unknown>, kind: string, id: string): string {
  return find(extractDataRecords(source), kind, id).hash
}

describe('extractDataRecords', () => {
  it('splits the state into one record per syncable unit', () => {
    const counts: Record<string, number> = {}
    for (const r of extractDataRecords(data())) counts[r.kind] = (counts[r.kind] ?? 0) + 1
    expect(counts).toEqual({
      project: 1,
      project_column: 2,
      project_link: 1,
      task: 1,
      habit: 1,
      habit_completion: 2,
      financial_table: 1,
      transaction: 1,
      shopping_item: 1,
      financial_goal: 1,
      financial_debt: 1,
      yield_source: 1,
      yield_entry: 1
    })
  })

  it('keeps device-only project fields out of the project record', () => {
    const project = find(extractDataRecords(data()), 'project', 'p1')
    for (const key of ['columns', 'links', 'codePaths', 'activeCodePathIds', 'activeCodePathId'])
      expect(project.payload).not.toHaveProperty(key)

    const changed = data()
    changed.projects[0].codePaths = [{ id: 'cp2', path: 'E:\\Sagyou' }]
    changed.projects[0].activeCodePathIds = ['cp2']
    changed.projects[0].updatedAt = '2026-10-31T00:00:00.000Z'
    expect(hashOf(changed, 'project', 'p1')).toBe(hashOf(data(), 'project', 'p1'))
  })

  it('ignores updatedAt but not real edits', () => {
    const touched = data()
    touched.tasks[0].updatedAt = '2026-10-31T00:00:00.000Z'
    touched.habits[0].updatedAt = '2026-10-31T00:00:00.000Z'
    touched.lists[0].updatedAt = '2026-10-31T00:00:00.000Z'
    expect(hashOf(touched, 'task', 't1')).toBe(hashOf(data(), 'task', 't1'))
    expect(hashOf(touched, 'habit', 'h1')).toBe(hashOf(data(), 'habit', 'h1'))
    expect(hashOf(touched, 'financial_table', 'ft1')).toBe(hashOf(data(), 'financial_table', 'ft1'))

    const renamed = data()
    renamed.tasks[0].title = 'Outra'
    expect(hashOf(renamed, 'task', 't1')).not.toBe(hashOf(data(), 'task', 't1'))
  })

  it('hashes an absent, undefined and null optional field alike', () => {
    const withUndefined = data()
    withUndefined.tasks[0].description = undefined
    const withNull = data()
    withNull.tasks[0].description = null
    const base = hashOf(data(), 'task', 't1')
    expect(hashOf(withUndefined, 'task', 't1')).toBe(base)
    expect(hashOf(withNull, 'task', 't1')).toBe(base)
  })

  it('hashes a legacy numeric amount like its decimal string', () => {
    const legacy = data()
    ;(legacy.lists[0].transactions as Record<string, unknown>[])[0].amount = 1500.5
    expect(hashOf(legacy, 'transaction', 'tx1')).toBe(hashOf(data(), 'transaction', 'tx1'))
  })

  it('hashes a note font size like loadData reads it back from its TEXT column', () => {
    const note = {
      id: 'n1',
      projectId: 'p1',
      content: 'Texto',
      color: '#fff',
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      type: 'text',
      createdAt: T,
      updatedAt: T
    }
    const fromRenderer = { ...data(), notes: [{ ...note, fontSize: 20, connections: [] }] }
    const fromLoadData = { ...data(), notes: [{ ...note, fontSize: '20' }] }
    expect(hashOf(fromLoadData, 'note', 'n1')).toBe(hashOf(fromRenderer, 'note', 'n1'))

    const resized = { ...data(), notes: [{ ...note, fontSize: 24 }] }
    expect(hashOf(resized, 'note', 'n1')).not.toBe(hashOf(fromRenderer, 'note', 'n1'))
  })

  it('ignores fields SQLite does not store', () => {
    const extra = data()
    extra.tasks[0].foo = 1
    expect(hashOf(extra, 'task', 't1')).toBe(hashOf(data(), 'task', 't1'))
  })

  it('treats tags as a set', () => {
    const reordered = data()
    reordered.tasks[0].tags = ['a', 'b']
    expect(hashOf(reordered, 'task', 't1')).toBe(hashOf(data(), 'task', 't1'))
  })

  it('versions a transaction edit on the transaction alone', () => {
    const before = extractDataRecords(data())
    const edited = data()
    ;(edited.lists[0].transactions as Record<string, unknown>[])[0].amount = '99'
    const after = extractDataRecords(edited)

    const changed = after.filter((r) => find(before, r.kind, r.id).hash !== r.hash)
    expect(changed.map((r) => `${r.kind}:${r.id}`)).toEqual(['transaction:tx1'])
  })

  it('carries the parent ids on child records', () => {
    const records = extractDataRecords(data())
    expect(find(records, 'project_column', 'c1').payload.projectId).toBe('p1')
    expect(find(records, 'transaction', 'tx1').payload.tableId).toBe('ft1')
    expect(find(records, 'yield_entry', 'ye1').payload).toMatchObject({
      tableId: 'ft1',
      sourceId: 'ys1'
    })
    expect(find(records, 'habit_completion', 'h1:2026-10-30').payload).toEqual({
      habitId: 'h1',
      date: '2026-10-30'
    })
  })
})

describe('extractMemoryRecords', () => {
  const memory: AiMemory = {
    id: 'm1',
    projectId: null,
    type: 'decisao',
    title: 'Título',
    body: 'Corpo',
    tags: [],
    pinned: false,
    source: 'modelo',
    sourceConversationId: null,
    createdAt: T,
    updatedAt: T,
    lastAccessedAt: T,
    accessCount: 0,
    archivedAt: null
  }

  it('ignores access bookkeeping', () => {
    const [base] = extractMemoryRecords([memory])
    const [touched] = extractMemoryRecords([
      { ...memory, accessCount: 3, lastAccessedAt: '2026-10-31T00:00:00.000Z' }
    ])
    expect(touched.hash).toBe(base.hash)
  })

  it('versions archiving', () => {
    const [base] = extractMemoryRecords([memory])
    const [archived] = extractMemoryRecords([{ ...memory, archivedAt: T }])
    expect(archived.kind).toBe('memory')
    expect(archived.hash).not.toBe(base.hash)
  })
})

describe('canonicalJson', () => {
  it('sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})
