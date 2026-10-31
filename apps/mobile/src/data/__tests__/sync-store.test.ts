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
})
