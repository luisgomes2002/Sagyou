// @vitest-environment node
//
// The plan compares the records of a save against the stored versions and
// decides what gets a new version (upserts) and what becomes a tombstone
// (deletes). Its scope is what keeps a partial capture — one memory saved —
// from turning everything else into tombstones.
import { describe, expect, it } from 'vitest'
import {
  DATA_KINDS,
  MEMORY_KINDS,
  extractDataRecords,
  type SyncRecord
} from '../modules/sync/sync-records'
import { buildSyncRows, planSyncChanges, type StoredVersion } from '../modules/sync/sync-plan'

const T = '2026-10-30T12:00:00.000Z'
const ALL_DATA = { kinds: DATA_KINDS, complete: true }

function rec(kind: SyncRecord['kind'], id: string, hash = `h-${id}`): SyncRecord {
  return { kind, id, payload: { id }, hash }
}

function stored(r: SyncRecord, deleted = false): StoredVersion {
  return { kind: r.kind, id: r.id, hash: r.hash, deleted }
}

function keys(list: { kind: string; id: string }[]): string[] {
  return list.map((r) => `${r.kind}:${r.id}`).sort()
}

describe('planSyncChanges', () => {
  it('versions every record when nothing is stored yet', () => {
    const records = [rec('task', 't1'), rec('note', 'n1')]
    const plan = planSyncChanges(records, [], ALL_DATA)
    expect(keys(plan.upserts)).toEqual(['note:n1', 'task:t1'])
    expect(plan.deletes).toEqual([])
  })

  it('does nothing when every hash matches', () => {
    const records = [rec('task', 't1'), rec('note', 'n1')]
    expect(
      planSyncChanges(
        records,
        records.map((r) => stored(r)),
        ALL_DATA
      )
    ).toEqual({
      upserts: [],
      deletes: []
    })
  })

  it('versions only the new transaction', () => {
    const before = [rec('financial_table', 'ft1'), rec('transaction', 'tx1')]
    const after = [...before, rec('transaction', 'tx2')]
    const plan = planSyncChanges(
      after,
      before.map((r) => stored(r)),
      ALL_DATA
    )
    expect(keys(plan.upserts)).toEqual(['transaction:tx2'])
    expect(plan.deletes).toEqual([])
  })

  it('tombstones a removed table and each of its transactions with the stored hash', () => {
    const before = [
      rec('financial_table', 'ft1'),
      rec('transaction', 'tx1'),
      rec('transaction', 'tx2'),
      rec('transaction', 'tx3')
    ]
    const plan = planSyncChanges(
      [],
      before.map((r) => stored(r)),
      ALL_DATA
    )
    expect(plan.upserts).toEqual([])
    expect(keys(plan.deletes)).toEqual([
      'financial_table:ft1',
      'transaction:tx1',
      'transaction:tx2',
      'transaction:tx3'
    ])
    expect(plan.deletes.find((d) => d.id === 'tx2')?.hash).toBe('h-tx2')
  })

  it('versions a record that comes back after being deleted', () => {
    const task = rec('task', 't1')
    const plan = planSyncChanges([task], [stored(task, true)], ALL_DATA)
    expect(keys(plan.upserts)).toEqual(['task:t1'])
  })

  it('never tombstones a memory from a data capture', () => {
    const memory = rec('memory', 'm1')
    const plan = planSyncChanges([], [stored(memory)], ALL_DATA)
    expect(plan.deletes).toEqual([])
  })

  it('leaves other memories alone on a partial capture', () => {
    const m1 = rec('memory', 'm1', 'new')
    const m2 = rec('memory', 'm2')
    const old = [stored(rec('memory', 'm1')), stored(m2)]

    const partial = planSyncChanges([m1], old, { kinds: MEMORY_KINDS, complete: false })
    expect(keys(partial.upserts)).toEqual(['memory:m1'])
    expect(partial.deletes).toEqual([])

    const removal = planSyncChanges([], old, {
      kinds: MEMORY_KINDS,
      complete: false,
      removedIds: [{ kind: 'memory', id: 'm2' }]
    })
    expect(keys(removal.deletes)).toEqual(['memory:m2'])
  })

  it('does not tombstone what is already a tombstone', () => {
    const task = rec('task', 't1')
    expect(planSyncChanges([], [stored(task, true)], ALL_DATA).deletes).toEqual([])
  })

  it('ignores timers, theme, active profile, code paths and the parent updatedAt', () => {
    const base = {
      projects: [
        {
          id: 'p1',
          name: 'P',
          color: '#000',
          createdAt: T,
          updatedAt: T,
          columns: [{ id: 'c1', name: 'A', order: 0 }],
          codePaths: [{ id: 'cp1', path: '/a' }],
          activeCodePathIds: ['cp1']
        }
      ],
      tasks: [],
      lists: [],
      activeTimers: [],
      uiPreferences: { theme: 'light' },
      activeFinancialProfileId: 'personal'
    }
    const changed = {
      ...base,
      projects: [
        {
          ...base.projects[0],
          updatedAt: '2026-10-31T00:00:00.000Z',
          codePaths: [{ id: 'cp2', path: 'E:\\b' }],
          activeCodePathIds: ['cp2']
        }
      ],
      activeTimers: [{ taskId: 't1', startedAt: 1 }],
      uiPreferences: { theme: 'dark' },
      activeFinancialProfileId: 'work'
    }
    const versions = extractDataRecords(base).map((r) => stored(r))
    expect(planSyncChanges(extractDataRecords(changed), versions, ALL_DATA)).toEqual({
      upserts: [],
      deletes: []
    })
  })
})

describe('buildSyncRows', () => {
  const plan = {
    upserts: [rec('task', 't1'), rec('task', 't2')],
    deletes: [stored(rec('note', 'n1'))]
  }

  it('numbers rows and orders their versions', () => {
    const rows = buildSyncRows(plan, { maxHlc: null, maxSeq: 0 }, 'dev', 1000)
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(rows[0].hlc < rows[1].hlc && rows[1].hlc < rows[2].hlc).toBe(true)
    expect(rows.every((r) => r.deviceId === 'dev')).toBe(true)
    expect(rows[2]).toMatchObject({ kind: 'note', id: 'n1', deleted: true, hash: 'h-n1' })
    expect(rows[0]).toMatchObject({ kind: 'task', id: 't1', deleted: false, hash: 'h-t1' })
  })

  it('continues after what is already stored', () => {
    const future = '000009999999999-0000-other'
    const rows = buildSyncRows(plan, { maxHlc: future, maxSeq: 10 }, 'dev', 1000)
    expect(rows[0].seq).toBe(11)
    expect(rows[0].hlc > future).toBe(true)
  })
})
