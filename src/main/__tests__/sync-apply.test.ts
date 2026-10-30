// @vitest-environment node
//
// Received versions go back into the state the renderer keeps, without
// touching what belongs to this device only. A late renderer save must not
// undo a received change, and a debt edited on both sides never resolves on
// its own while the transactions around it still apply.
import { describe, expect, it } from 'vitest'
import type { WireRecord } from '../modules/sync/sync-batch'
import {
  applyRecordsToState,
  decodeIncoming,
  encodeIncoming,
  guardStaleSave,
  memoryFromPayload,
  planRemoteApply,
  type IncomingRecord,
  type StoredSyncVersion,
  type SyncableState
} from '../modules/sync/sync-apply'
import { extractDataRecords, hashPayload, type SyncRecord } from '../modules/sync/sync-records'
import type { AiMemory } from '../modules/ai/memory'

const T = '2026-10-30T12:00:00.000Z'
const OLD = '000000000001000-0000-a'
const MID = '000000000002000-0000-a'
const NEW = '000000000003000-0000-b'

type Row = Record<string, unknown>
type State = SyncableState &
  Row & {
    projects: Row[]
    tasks: Row[]
    lists: Row[]
    habits: Row[]
  }

/** The other device's data: one or more records of every kind. */
function remote(): State {
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
        codePaths: [{ id: 'cp-remote', path: '/outro/pc' }],
        activeCodePathIds: ['cp-remote'],
        activeCodePathId: 'cp-remote'
      }
    ],
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        columnId: 'c1',
        title: 'Tarefa',
        description: '',
        priority: 'medium',
        tags: ['b', 'a'],
        order: 0,
        createdAt: T,
        updatedAt: T
      }
    ],
    sprints: [{ id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: T }],
    tombstones: [],
    notes: [
      {
        id: 'n1',
        projectId: 'p1',
        content: '',
        color: '#fff',
        x: 0,
        y: 20,
        width: 200,
        height: 100,
        fontSize: 14,
        connections: [],
        createdAt: T,
        updatedAt: T
      }
    ],
    goals: [
      {
        id: 'g1',
        title: 'Ler',
        kind: 'quantity',
        target: 12,
        unit: 'livros',
        color: '#000',
        createdAt: T,
        updatedAt: T,
        entries: [{ id: 'ge1', date: '2026-10-01', value: 1, createdAt: T }]
      }
    ],
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
    financialProfiles: [{ id: 'personal', name: 'Minhas finanças', createdAt: T, updatedAt: T }],
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
          },
          { id: 'tx2', description: 'Salário', amount: '3000', type: 'income', date: '2026-10-05' }
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
    files: [{ id: 'f1', name: 'nota', ext: '', size: 3, createdAt: T, projectId: 'p1' }],
    timeBlocks: [
      {
        id: 'tb1',
        date: '2026-10-30',
        startTime: '09:00',
        endTime: '10:00',
        title: 'Foco',
        type: 'task',
        order: 0,
        createdAt: T,
        updatedAt: T
      }
    ],
    routines: [
      {
        id: 'r1',
        title: 'Manhã',
        startTime: '07:00',
        endTime: '08:00',
        daysOfWeek: [1, 2],
        active: false,
        createdAt: T,
        updatedAt: T
      }
    ],
    activeTimers: [{ taskId: 't1', startedAt: 99 }],
    uiPreferences: { theme: 'light' },
    activeFinancialProfileId: 'personal'
  }
}

/** This device: older versions of some of the same records, plus its own device fields. */
function local(): State {
  return {
    projects: [
      {
        id: 'p1',
        name: 'Nome antigo',
        color: '#000',
        createdAt: T,
        updatedAt: T,
        columns: [{ id: 'c1', name: 'Velha', order: 0 }],
        codePaths: [{ id: 'cp-local', path: '/home/luis/Sagyou' }],
        activeCodePathIds: ['cp-local'],
        activeCodePathId: 'cp-local'
      }
    ],
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        columnId: 'c1',
        title: 'Antiga',
        priority: 'low',
        tags: [],
        order: 0,
        createdAt: T,
        updatedAt: T
      }
    ],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [
      {
        id: 'ft1',
        name: 'Conta velha',
        currency: 'BRL',
        profileId: 'personal',
        createdAt: T,
        updatedAt: T,
        items: [],
        transactions: [
          { id: 'tx1', description: 'Antes', amount: '1', type: 'expense', date: '2026-10-01' }
        ],
        goals: []
      }
    ],
    files: [],
    activeTimers: [{ taskId: 't1', startedAt: 1 }],
    activeTimer: { taskId: 't1', startedAt: 1 },
    uiPreferences: { theme: 'dark', fontSize: 'large' },
    activeFinancialProfileId: 'outro',
    activeProjectId: 'p1'
  }
}

function wire(record: SyncRecord): WireRecord {
  return {
    kind: record.kind,
    id: record.id,
    hlc: NEW,
    baseHlc: null,
    deleted: false,
    payload: record.payload
  }
}

function hashesByKind(state: Row): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const r of extractDataRecords(state)) (out[r.kind] ??= {})[r.id] = r.hash
  return out
}

describe('applyRecordsToState', () => {
  it('is the inverse of extractDataRecords, kind by kind', () => {
    const b = remote()
    const result = applyRecordsToState(local(), extractDataRecords(b).map(wire))
    expect(hashesByKind(result)).toEqual(hashesByKind(b))
  })

  it('keeps every device-only field of this device', () => {
    const a = local()
    const result = applyRecordsToState(a, extractDataRecords(remote()).map(wire)) as State
    expect(result.activeTimers).toEqual(a.activeTimers)
    expect(result.activeTimer).toEqual(a.activeTimer)
    expect(result.uiPreferences).toEqual(a.uiPreferences)
    expect(result.activeFinancialProfileId).toBe('outro')
    expect(result.activeProjectId).toBe('p1')
    const project = result.projects[0]
    expect(project.name).toBe('Sagyou')
    expect(project.codePaths).toEqual([{ id: 'cp-local', path: '/home/luis/Sagyou' }])
    expect(project.activeCodePathIds).toEqual(['cp-local'])
    expect(project.activeCodePathId).toBe('cp-local')
  })

  it('does not change the state it was given', () => {
    const a = local()
    const before = JSON.stringify(a)
    applyRecordsToState(a, extractDataRecords(remote()).map(wire))
    expect(JSON.stringify(a)).toBe(before)
  })

  it('removes a deleted transaction only from its own table', () => {
    const state = remote()
    state.lists.push({
      id: 'ft2',
      name: 'Outra',
      currency: 'USD',
      createdAt: T,
      updatedAt: T,
      items: [],
      transactions: [
        { id: 'tx9', description: 'Fica', amount: '2', type: 'expense', date: '2026-10-02' }
      ],
      goals: []
    })
    const result = applyRecordsToState(state, [
      { kind: 'transaction', id: 'tx1', hlc: NEW, baseHlc: MID, deleted: true }
    ]) as State
    const ids = (table: Row): string[] => (table.transactions as Row[]).map((t) => String(t.id))
    expect(ids(result.lists[0])).toEqual(['tx2'])
    expect(ids(result.lists[1])).toEqual(['tx9'])
    expect(result.lists[0].debts).toEqual(state.lists[0].debts)
  })

  it('keeps a table children when only the table itself changed', () => {
    const state = remote()
    const result = applyRecordsToState(state, [
      {
        kind: 'financial_table',
        id: 'ft1',
        hlc: NEW,
        baseHlc: MID,
        deleted: false,
        payload: { id: 'ft1', name: 'Renomeada', currency: 'BRL', profileId: 'personal' }
      }
    ]) as State
    expect(result.lists[0].name).toBe('Renomeada')
    expect(result.lists[0].transactions).toEqual(state.lists[0].transactions)
    expect(result.lists[0].debts).toEqual(state.lists[0].debts)
  })

  it('adds and removes one habit day', () => {
    const state = remote()
    const result = applyRecordsToState(state, [
      {
        kind: 'habit_completion',
        id: 'h1:2026-10-31',
        hlc: NEW,
        baseHlc: null,
        deleted: false,
        payload: { habitId: 'h1', date: '2026-10-31' }
      },
      { kind: 'habit_completion', id: 'h1:2026-10-29', hlc: NEW, baseHlc: MID, deleted: true }
    ]) as State
    expect(result.habits[0].completions).toEqual(['2026-10-30', '2026-10-31'])
  })
})

describe('guardStaleSave', () => {
  it('keeps the database version of a record changed remotely and accepts the other edits', () => {
    const current = remote()
    current.tasks[0].title = 'Remota'
    const next = remote()
    next.tasks[0].title = 'Velha'
    next.tasks.push({ ...next.tasks[0], id: 't2', title: 'Editada aqui' })
    next.lists[0].name = 'Renomeada aqui'

    const result = guardStaleSave(next, current, new Set(['task:t1'])) as State
    expect((result.tasks as Row[]).find((t) => t.id === 't1')?.title).toBe('Remota')
    expect((result.tasks as Row[]).find((t) => t.id === 't2')?.title).toBe('Editada aqui')
    expect(result.lists[0].name).toBe('Renomeada aqui')
  })

  it('does not bring back a record deleted remotely', () => {
    const current = remote()
    current.lists[0].transactions = (current.lists[0].transactions as Row[]).filter(
      (t) => t.id !== 'tx1'
    )
    const result = guardStaleSave(remote(), current, new Set(['transaction:tx1'])) as State
    expect((result.lists[0].transactions as Row[]).map((t) => t.id)).toEqual(['tx2'])
  })

  it('returns the save untouched when nothing changed remotely', () => {
    const next = remote()
    expect(guardStaleSave(next, local(), new Set())).toBe(next)
  })
})

function stored(record: SyncRecord, hlc: string, deviceId = 'local'): [string, StoredSyncVersion] {
  return [
    `${record.kind}:${record.id}`,
    { hlc, hash: record.hash, deleted: false, deviceId, baseHlc: null }
  ]
}

function versionsOf(state: Row, hlc = MID): Map<string, StoredSyncVersion> {
  return new Map(extractDataRecords(state).map((r) => stored(r, hlc)))
}

function from(record: WireRecord, device = 'remote-device', serverSeq = 7): IncomingRecord {
  return { record, device, serverSeq }
}

describe('planRemoteApply', () => {
  it('applies a transaction linked to a debt in pending choice and leaves the local debt alone', () => {
    const state = remote()
    const debtEdit: WireRecord = {
      kind: 'financial_debt',
      id: 'd1',
      hlc: NEW,
      baseHlc: OLD,
      deleted: false,
      payload: {
        id: 'd1',
        tableId: 'ft1',
        name: 'Cartão',
        originalAmount: '300',
        remainingAmount: '50',
        createdAt: T,
        updatedAt: T
      }
    }
    const payment: WireRecord = {
      kind: 'transaction',
      id: 'tx-pay',
      hlc: NEW,
      baseHlc: null,
      deleted: false,
      payload: {
        id: 'tx-pay',
        tableId: 'ft1',
        description: 'Pagamento',
        amount: '150',
        type: 'expense',
        date: '2026-10-30',
        debtId: 'd1'
      }
    }

    const plan = planRemoteApply(state, [from(debtEdit), from(payment)], versionsOf(state))

    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toMatchObject({
      type: 'pending_choice',
      kind: 'financial_debt',
      recordId: 'd1',
      loserDevice: 'remote-device',
      winnerHlc: MID,
      loserHlc: NEW
    })
    expect(plan.conflicts[0].loser).toEqual(debtEdit)
    const table = (plan.state as State).lists[0]
    expect(table.debts).toEqual(state.lists[0].debts)
    expect((table.transactions as Row[]).find((t) => t.id === 'tx-pay')?.debtId).toBe('d1')
    expect(plan.versions.map((v) => `${v.kind}:${v.id}`)).toEqual(['transaction:tx-pay'])
    expect(plan.versions[0]).toMatchObject({
      hlc: NEW,
      deviceId: 'remote-device',
      serverSeq: 7,
      hash: hashPayload(payment.payload!)
    })
  })

  it('stores the local version as the loser when the incoming edit wins a conflict', () => {
    const state = remote()
    const edit: WireRecord = {
      kind: 'task',
      id: 't1',
      hlc: NEW,
      baseHlc: OLD,
      deleted: false,
      payload: { id: 't1', projectId: 'p1', columnId: 'c1', title: 'Remota', priority: 'high' }
    }
    const plan = planRemoteApply(state, [from(edit)], versionsOf(state))
    expect((plan.state as State).tasks[0].title).toBe('Remota')
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toMatchObject({ type: 'lww', loserDevice: 'local', loserHlc: MID })
    expect(plan.conflicts[0].loser.payload?.title).toBe('Tarefa')
  })

  it('applies a child before its parent when both come in the same pull', () => {
    const state = local()
    const column: WireRecord = {
      kind: 'project_column',
      id: 'c9',
      hlc: NEW,
      baseHlc: null,
      deleted: false,
      payload: { id: 'c9', projectId: 'p9', name: 'Nova', order: 0 }
    }
    const project: WireRecord = {
      kind: 'project',
      id: 'p9',
      hlc: NEW,
      baseHlc: null,
      deleted: false,
      payload: { id: 'p9', name: 'Novo', color: '#123', createdAt: T, updatedAt: T }
    }
    const plan = planRemoteApply(state, [from(column), from(project)], versionsOf(state))
    expect(plan.pending).toEqual([])
    const p9 = ((plan.state as State).projects as Row[]).find((p) => p.id === 'p9')
    expect(p9?.columns).toEqual([{ id: 'c9', name: 'Nova', order: 0 }])
  })

  it('holds a child whose parent has not arrived, and flags one whose parent was deleted', () => {
    const state = local()
    const waiting: WireRecord = {
      kind: 'transaction',
      id: 'tx-w',
      hlc: NEW,
      baseHlc: null,
      deleted: false,
      payload: { id: 'tx-w', tableId: 'ft-missing', description: 'x', amount: '1' }
    }
    const orphan: WireRecord = {
      ...waiting,
      id: 'tx-o',
      payload: { ...waiting.payload, id: 'tx-o', tableId: 'ft-gone' }
    }
    const versions = versionsOf(state)
    versions.set('financial_table:ft-gone', {
      hlc: MID,
      hash: 'h',
      deleted: true,
      deviceId: 'local',
      baseHlc: OLD
    })
    const plan = planRemoteApply(state, [from(waiting), from(orphan)], versions)
    expect(plan.pending.map((p) => p.record.id)).toEqual(['tx-w'])
    expect(plan.conflicts.map((c) => [c.type, c.recordId])).toEqual([['orphan', 'tx-o']])
    expect(plan.applied).toEqual([])
    expect(plan.state).toBe(state)
  })

  it('records the newer version of identical content without a conflict', () => {
    const state = remote()
    const same = extractDataRecords(state).find((r) => r.kind === 'task')!
    const plan = planRemoteApply(state, [from({ ...wire(same), baseHlc: OLD })], versionsOf(state))
    expect(plan.conflicts).toEqual([])
    expect(plan.applied).toEqual([])
    expect(plan.versions).toHaveLength(1)
    expect(plan.versions[0]).toMatchObject({ hlc: NEW, hash: same.hash })
  })
})

describe('memoryFromPayload', () => {
  it('keeps the access bookkeeping of the local copy', () => {
    const existing = {
      id: 'm1',
      lastAccessedAt: '2026-10-01T00:00:00.000Z',
      accessCount: 5
    } as AiMemory
    const memory = memoryFromPayload(
      {
        id: 'm1',
        type: 'decisao',
        title: 'Título',
        body: 'Corpo',
        source: 'usuario',
        createdAt: T,
        updatedAt: T
      },
      existing,
      T
    )
    expect(memory.accessCount).toBe(5)
    expect(memory.lastAccessedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(memory.title).toBe('Título')
    expect(memory.projectId).toBeNull()
    expect(memory.archivedAt).toBeNull()
    expect(memory.tags).toEqual([])
  })
})

describe('encodeIncoming', () => {
  it('round-trips a pending record with its sender and server seq', () => {
    const item = from({
      kind: 'task',
      id: 't1',
      hlc: NEW,
      baseHlc: MID,
      deleted: false,
      payload: { id: 't1', title: 'x' }
    })
    expect(decodeIncoming(encodeIncoming(item))).toEqual(item)
  })
})
