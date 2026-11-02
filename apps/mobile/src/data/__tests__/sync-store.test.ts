import type { IncomingRecord } from '@sagyou/core/sync/apply'
import type { WireRecord } from '@sagyou/core/sync/batch'
import { deriveKeys, newSyncKey } from '@sagyou/core/sync/crypto'
import type { SyncApplyCtx } from '@sagyou/core/sync/engine'
import { nextHlc } from '@sagyou/core/sync/hlc'
import { extractDataRecords } from '@sagyou/core/sync/records'
import { createRecordRepo, type RecordRepo } from '../records'
import { migrate } from '../schema'
import type { SqlDb } from '../sql'
import { emptyState, type MobileState } from '../state'
import { createMobileSyncStore, type MobileSyncStore } from '../sync-store'
import { openNodeDb } from './node-db'

const T = '2026-10-30T12:00:00.000Z'
const NOW = Date.parse('2026-10-31T12:00:00.000Z')
const REMOTE = 'b'.repeat(32)

interface Harness {
  db: SqlDb
  repo: RecordRepo
  store: MobileSyncStore
  ctx: SyncApplyCtx
  state: () => MobileState
  apply: (records: WireRecord[]) => ReturnType<MobileSyncStore['applyRemoteRecords']>
  save: (next: MobileState, at?: number) => void
}

function harness(): Harness {
  const db = openNodeDb()
  migrate(db)
  const repo = createRecordRepo(db)
  let state = emptyState()
  const store = createMobileSyncStore(db, repo, () => state)
  const ctx: SyncApplyCtx = { enc: deriveKeys(newSyncKey()).enc, opaqueId: 'celular', now: NOW }
  let serverSeq = 0
  return {
    db,
    repo,
    store,
    ctx,
    state: () => state,
    apply: (records) => {
      const incoming: IncomingRecord[] = records.map((record) => ({
        record,
        device: 'opaco-do-pc',
        serverSeq: ++serverSeq
      }))
      const result = store.applyRemoteRecords(incoming, ctx)
      if (result.state) state = result.state as MobileState
      return result
    },
    save: (next, at = NOW) => {
      repo.save(next, at)
      state = next
    }
  }
}

function sample(): MobileState {
  const state = emptyState()
  state.projects = [
    {
      id: 'p1',
      name: 'Sagyou',
      color: '#000',
      order: 0,
      createdAt: T,
      updatedAt: T,
      columns: [{ id: 'c1', name: 'A fazer', order: 0 }]
    } as unknown as MobileState['projects'][number]
  ]
  state.tasks = [
    {
      id: 't1',
      projectId: 'p1',
      columnId: 'c1',
      title: 'Local',
      priority: 'medium',
      tags: [],
      order: 0,
      createdAt: T,
      updatedAt: T
    }
  ]
  state.lists = [
    {
      id: 'ft1',
      name: 'Conta',
      currency: 'BRL',
      profileId: 'personal',
      items: [],
      transactions: [],
      goals: [],
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
      createdAt: T,
      updatedAt: T
    } as unknown as MobileState['lists'][number]
  ]
  return state
}

/** The sample's records as another device would send them, with `patch` applied to one. */
function remote(
  kind: string,
  id: string,
  at: number,
  patch: Record<string, unknown> = {}
): WireRecord {
  const record = extractDataRecords(sample()).find((r) => r.kind === kind && r.id === id)
  if (!record) throw new Error(`${kind}:${id}`)
  return {
    kind: record.kind,
    id,
    hlc: nextHlc(at, null, REMOTE),
    baseHlc: null,
    deleted: false,
    payload: { ...record.payload, ...patch }
  }
}

/** A version another device made on top of `base`. */
function onTop(base: string, at: number, title: string): WireRecord {
  return { ...remote('task', 't1', at, { title }), baseHlc: base }
}

const count = (db: SqlDb, table: string): number =>
  db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0

describe('SyncStoreLike do celular', () => {
  it('uma tarefa que chega antes do projeto espera e entra quando o projeto chega', () => {
    const h = harness()
    const first = h.apply([remote('task', 't1', NOW)])
    expect(first.pending).toBe(1)
    expect(first.applied).toBe(0)
    expect(count(h.db, 'sync_pending')).toBe(1)

    const second = h.apply([remote('project', 'p1', NOW), remote('project_column', 'c1', NOW)])
    expect(second.applied).toBe(3)
    expect(h.state().tasks.map((t) => t.id)).toEqual(['t1'])
    expect(count(h.db, 'sync_pending')).toBe(0)
  })

  it('edição local mais antiga perde para a recebida e fica guardada como conflito lww', () => {
    const h = harness()
    h.save(sample(), NOW)
    const result = h.apply([remote('task', 't1', NOW + 60000, { title: 'Do PC' })])
    expect(result.conflicts).toBe(1)
    expect(h.state().tasks[0].title).toBe('Do PC')
    expect(h.store.listSyncConflicts(NOW).map((c) => [c.kind, c.recordId, c.type])).toEqual([
      ['task', 't1', 'lww']
    ])
    expect(h.store.openSyncConflictCount(NOW)).toBe(1)
  })

  it('dívida mudada nos dois aparelhos fica para escolher e mantém o valor local', () => {
    const h = harness()
    h.save(sample(), NOW)
    h.apply([remote('financial_debt', 'd1', NOW + 60000, { remainingAmount: '50' })])
    expect(h.state().lists[0].debts?.[0].remainingAmount).toBe('200')
    expect(h.store.listSyncConflicts(NOW).map((c) => c.type)).toEqual(['pending_choice'])
    expect(h.store.openSyncConflictCount(NOW)).toBe(1)
  })

  it('lista o que foi editado aqui para enviar e esquece depois do envio', () => {
    const h = harness()
    h.save(sample(), NOW)
    const pending = h.store.pendingOutgoing()
    expect(pending.length).toBe(extractDataRecords(sample()).length)
    expect(h.store.pendingOutgoingCount()).toBe(pending.length)
    h.store.markPushed(Math.max(...pending.map((p) => p.seq)), [])
    expect(h.store.pendingOutgoing()).toEqual([])
  })

  it('versões recebidas nunca voltam na fila de envio', () => {
    const h = harness()
    h.apply([remote('project', 'p1', NOW), remote('project_column', 'c1', NOW)])
    expect(h.store.pendingOutgoing()).toEqual([])
    expect(h.store.syncRecordVersion('project', 'p1')?.deviceId).toBe('opaco-do-pc')
  })

  it('fecha sozinho o conflito quando chega uma versão feita por cima da vencedora', () => {
    const h = harness()
    h.save(sample(), NOW)
    const winner = remote('task', 't1', NOW + 60000, { title: 'Do PC' })
    h.apply([winner])
    expect(h.store.openSyncConflictCount(NOW)).toBe(1)
    h.apply([onTop(winner.hlc, NOW + 120000, 'Decidida')])
    expect(h.store.openSyncConflictCount(NOW)).toBe(0)
    expect(h.store.listSyncConflicts(NOW)).toEqual([])
    expect(h.state().tasks[0].title).toBe('Decidida')
  })

  it('conflito criado e assentado na mesma busca já sai fechado', () => {
    const h = harness()
    h.save(sample(), NOW)
    const winner = remote('task', 't1', NOW + 60000, { title: 'Do PC' })
    const result = h.apply([winner, onTop(winner.hlc, NOW + 120000, 'Decidida')])
    expect(result.conflicts).toBe(1)
    expect(h.store.openSyncConflictCount(NOW)).toBe(0)
  })

  it('uma versão que gera conflito novo não fecha o antigo', () => {
    const h = harness()
    h.save(sample(), NOW)
    h.apply([remote('task', 't1', NOW + 60000, { title: 'Do PC' })])
    h.apply([remote('task', 't1', NOW + 120000, { title: 'Sem ver a anterior' })])
    expect(h.store.openSyncConflictCount(NOW)).toBe(2)
  })

  it('conflito órfão e conflito com versão guardada mais nova continuam abertos', () => {
    const h = harness()
    h.save(sample(), NOW)
    const current = h.store.syncRecordVersion('task', 't1')!.hlc
    const later = nextHlc(NOW + 600000, null, REMOTE)
    const insert = (id: string, type: string, loserHlc: string): void =>
      h.db.run(
        'INSERT INTO sync_conflicts (id, kind, record_id, type, loser_cipher, winner_hlc, ' +
          'loser_hlc, loser_device, created_at, resolved_at) ' +
          "VALUES (?, 'task', 't1', ?, 'x', ?, ?, 'outro', ?, NULL)",
        [id, type, current, loserHlc, NOW]
      )
    insert('orfao', 'orphan', current)
    insert('mais-novo', 'lww', later)
    h.apply([onTop(current, NOW + 120000, 'Decidida')])
    expect(h.store.listSyncConflicts(NOW).map((c) => c.id).sort()).toEqual(['mais-novo', 'orfao'])
  })

  it('fecha sozinho o conflito de uma memória', () => {
    const h = harness()
    const first: WireRecord = {
      kind: 'memory',
      id: 'm1',
      hlc: nextHlc(NOW, null, REMOTE),
      baseHlc: null,
      deleted: false,
      payload: { id: 'm1', title: 'Decisão', body: 'antes' }
    }
    h.apply([first])
    h.db.run(
      'INSERT INTO sync_conflicts (id, kind, record_id, type, loser_cipher, winner_hlc, ' +
        'loser_hlc, loser_device, created_at, resolved_at) ' +
        "VALUES ('c1', 'memory', 'm1', 'lww', 'x', ?, ?, 'outro', ?, NULL)",
      [first.hlc, nextHlc(NOW - 1000, null, 'c'.repeat(32)), NOW]
    )
    expect(h.store.openSyncConflictCount(NOW)).toBe(1)
    h.apply([
      {
        ...first,
        hlc: nextHlc(NOW + 60000, null, REMOTE),
        baseHlc: first.hlc,
        payload: { id: 'm1', title: 'Decisão', body: 'depois' }
      }
    ])
    expect(h.store.openSyncConflictCount(NOW)).toBe(0)
  })
})
