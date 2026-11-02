// The engine's view of the phone's database (SyncStoreLike), with the same
// semantics as the desktop's store.ts: received versions keep the sender's id
// and HLC and are never pushed back; losers are sealed into sync_conflicts;
// children wait in sync_pending for their parent. The phone is single-threaded,
// so there is no stale-save guard: every action reads the latest state.
import {
  CLOSE_SETTLED_CONFLICTS_SQL,
  PENDING_TTL_MS,
  applyRecordsToState,
  decodeIncoming,
  encodeIncoming,
  planMemoryApply,
  planRemoteApply,
  type ConflictWrite,
  settledConflictParams,
  type IncomingRecord,
  type SettledVersion,
  type StoredSyncVersion,
  type VersionWrite
} from '@sagyou/core/sync/apply'
import {
  buildOutgoing,
  encodeBatch,
  recordKey,
  type OutgoingRow,
  type WireRecord
} from '@sagyou/core/sync/batch'
import { randomUUID } from '@sagyou/core/sync/bytes'
import { openBatch, sealBatch } from '@sagyou/core/sync/crypto'
import type {
  SyncApplyCtx,
  SyncConflictRow,
  SyncStateChange,
  SyncStoreLike
} from '@sagyou/core/sync/engine'
import { parseHlc } from '@sagyou/core/sync/hlc'
import { buildRebasedRow } from '@sagyou/core/sync/plan'
import {
  DATA_KINDS,
  MEMORY_KINDS,
  extractDataRecords,
  hashPayload,
  type SyncKind,
  type SyncRecord
} from '@sagyou/core/sync/records'
import { latestVersions, replaceSyncableState } from '@sagyou/core/sync/replace'
import { captureVersions, syncStateNumber, writeSyncState, type RecordRepo } from './records'
import type { SqlDb } from './sql'
import { emptyState, type MobileState } from './state'

/** A conflict's losing version stays listed for 30 days (desktop's CONFLICT_TTL_MS). */
export const CONFLICT_TTL_MS = 30 * 86400000
const TOMBSTONE_MIN_AGE_MS = 90 * 86400000

const DATA_KIND_SET = new Set<string>(DATA_KINDS)

export interface MobileSyncStore extends SyncStoreLike {
  /** The current state the UI holds; the engine's results replace it. */
  readonly state: () => MobileState
}

export function createMobileSyncStore(
  db: SqlDb,
  repo: RecordRepo,
  getState: () => MobileState
): MobileSyncStore {
  const me = (): string => repo.deviceId()

  const storedVersions = (kinds: readonly string[]): Map<string, StoredSyncVersion> => {
    const placeholders = kinds.map(() => '?').join(',')
    const rows = db.all<{
      kind: string
      id: string
      hlc: string
      hash: string
      deleted: number
      device_id: string
      base_hlc: string | null
    }>(
      'SELECT kind, id, hlc, hash, deleted, device_id, base_hlc FROM sync_records ' +
        `WHERE kind IN (${placeholders})`,
      [...kinds]
    )
    return new Map(
      rows.map((r) => [
        recordKey(r.kind, r.id),
        {
          hlc: r.hlc,
          hash: r.hash,
          deleted: r.deleted === 1,
          deviceId: r.device_id,
          baseHlc: r.base_hlc
        }
      ])
    )
  }

  const writeReceivedVersions = (versions: VersionWrite[]): void => {
    if (!versions.length) return
    let maxSeq =
      db.get<{ maxSeq: number }>('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM sync_records')
        ?.maxSeq ?? 0
    for (const v of versions) {
      maxSeq += 1
      db.run(
        'INSERT INTO sync_records (kind, id, hlc, device_id, hash, deleted, seq, base_hlc, server_seq) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(kind, id) DO UPDATE SET hlc=excluded.hlc, device_id=excluded.device_id, ' +
          'hash=excluded.hash, deleted=excluded.deleted, seq=excluded.seq, ' +
          'base_hlc=excluded.base_hlc, server_seq=excluded.server_seq',
        [v.kind, v.id, v.hlc, v.deviceId, v.hash, v.deleted ? 1 : 0, maxSeq, v.baseHlc, v.serverSeq]
      )
    }
  }

  const writeConflicts = (conflicts: ConflictWrite[], ctx: SyncApplyCtx, now: number): void => {
    for (const c of conflicts) {
      const id = randomUUID()
      const cipher = sealBatch(ctx.enc, ctx.opaqueId, `conflict:${id}`, encodeBatch([c.loser]))
      db.run(
        'INSERT INTO sync_conflicts (id, kind, record_id, type, loser_cipher, winner_hlc, ' +
          'loser_hlc, loser_device, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        [id, c.kind, c.recordId, c.type, cipher, c.winnerHlc, c.loserHlc, c.loserDevice, now]
      )
    }
  }

  /** After writeConflicts: a conflict made and settled in the same pull closes too. */
  const closeSettled = (settled: SettledVersion[], now: number): void => {
    for (const item of settled) db.run(CLOSE_SETTLED_CONFLICTS_SQL, settledConflictParams(item, now))
  }

  const pendingBatchId = (kind: string, id: string): string => `pending:${kind}:${id}`

  const writePending = (pending: IncomingRecord[], ctx: SyncApplyCtx, now: number): void => {
    for (const item of pending) {
      const { kind, id } = item.record
      const cipher = sealBatch(
        ctx.enc,
        ctx.opaqueId,
        pendingBatchId(kind, id),
        encodeIncoming(item)
      )
      db.run(
        'INSERT OR REPLACE INTO sync_pending (kind, id, record_cipher, received_at) VALUES (?, ?, ?, ?)',
        [kind, id, cipher, item.receivedAt ?? now]
      )
    }
  }

  /** Take every waiting child out of sync_pending to plan it again; drop expired and unreadable. */
  const takePending = (ctx: SyncApplyCtx, now: number): IncomingRecord[] => {
    const rows = db.all<{ kind: string; id: string; record_cipher: string; received_at: number }>(
      'SELECT kind, id, record_cipher, received_at FROM sync_pending'
    )
    if (!rows.length) return []
    db.run('DELETE FROM sync_pending')
    const out: IncomingRecord[] = []
    for (const row of rows) {
      if (now - row.received_at > PENDING_TTL_MS) continue
      try {
        const item = decodeIncoming(
          openBatch(ctx.enc, ctx.opaqueId, pendingBatchId(row.kind, row.id), row.record_cipher)
        )
        out.push({ ...item, receivedAt: row.received_at })
      } catch {
        // Unreadable (key changed): dropped, like the desktop.
      }
    }
    return out
  }

  const applyMemories = (
    items: IncomingRecord[],
    ctx: SyncApplyCtx,
    now: number
  ): { applied: number; conflicts: number } => {
    if (!items.length) return { applied: 0, conflicts: 0 }
    const plan = planMemoryApply(items, storedVersions(MEMORY_KINDS), (id) =>
      repo.memoryPayload(id)
    )
    for (const record of plan.applied) repo.writeMemory(record)
    writeReceivedVersions(plan.versions)
    writeConflicts(plan.conflicts, ctx, now)
    closeSettled(plan.settled, now)
    return { applied: plan.applied.length, conflicts: plan.conflicts.length }
  }

  const bumpGeneration = (): number => {
    const generation = syncStateNumber(db, 'generation') + 1
    writeSyncState(db, 'generation', String(generation))
    return generation
  }

  const receivedVersion = (item: IncomingRecord): VersionWrite => ({
    kind: item.record.kind,
    id: item.record.id,
    hlc: item.record.hlc,
    baseHlc: item.record.baseHlc,
    deviceId: item.device,
    hash: !item.record.deleted && item.record.payload ? hashPayload(item.record.payload) : '',
    deleted: item.record.deleted,
    serverSeq: item.serverSeq
  })

  const allMemoryRecords = (): SyncRecord[] =>
    [...repo.currentRecords().values()].filter((r) => r.kind === 'memory')

  return {
    state: getState,

    getSyncDeviceId: me,

    pendingOutgoing(): OutgoingRow[] {
      const pushed = syncStateNumber(db, 'pushed_seq')
      return db
        .all<{
          kind: SyncKind
          id: string
          hlc: string
          base_hlc: string | null
          deleted: number
          seq: number
        }>(
          'SELECT kind, id, hlc, base_hlc, deleted, seq FROM sync_records ' +
            'WHERE device_id = ? AND seq > ? ORDER BY seq',
          [me(), pushed]
        )
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          hlc: r.hlc,
          baseHlc: r.base_hlc,
          deleted: r.deleted === 1,
          seq: r.seq
        }))
    },

    pendingOutgoingCount(): number {
      return (
        db.get<{ c: number }>(
          'SELECT COUNT(*) AS c FROM sync_records WHERE device_id = ? AND seq > ?',
          [me(), syncStateNumber(db, 'pushed_seq')]
        )?.c ?? 0
      )
    },

    markPushed(seqLocalMax, serverSeqs): void {
      db.tx(() => {
        for (const s of serverSeqs)
          db.run('UPDATE sync_records SET server_seq=? WHERE kind=? AND id=? AND hlc=?', [
            s.serverSeq,
            s.kind,
            s.id,
            s.hlc
          ])
        if (seqLocalMax > syncStateNumber(db, 'pushed_seq'))
          writeSyncState(db, 'pushed_seq', String(seqLocalMax))
      })
    },

    currentSyncRecords: () => repo.currentRecords(),

    snapshotRecords(): WireRecord[] {
      const rows = db.all<{
        kind: SyncKind
        id: string
        hlc: string
        base_hlc: string | null
        deleted: number
        seq: number
      }>('SELECT kind, id, hlc, base_hlc, deleted, seq FROM sync_records ORDER BY seq')
      return buildOutgoing(
        rows.map((r) => ({
          kind: r.kind,
          id: r.id,
          hlc: r.hlc,
          baseHlc: r.base_hlc,
          deleted: r.deleted === 1,
          seq: r.seq
        })),
        repo.currentRecords()
      )
    },

    pruneSyncTombstones(minCursor, nowMs): number {
      if (!Number.isSafeInteger(minCursor) || minCursor < 0) return 0
      const rows = db.all<{ kind: string; id: string; hlc: string }>(
        'SELECT kind, id, hlc FROM sync_records ' +
          'WHERE deleted = 1 AND server_seq IS NOT NULL AND server_seq <= ?',
        [minCursor]
      )
      const cutoff = nowMs - TOMBSTONE_MIN_AGE_MS
      return db.tx(() => {
        let count = 0
        for (const row of rows) {
          const parsed = parseHlc(row.hlc)
          if (parsed && parsed.ms < cutoff)
            count += db.run('DELETE FROM sync_records WHERE kind = ? AND id = ? AND deleted = 1', [
              row.kind,
              row.id
            ]).changes
        }
        return count
      })
    },

    applyRemoteRecords(records, ctx) {
      const now = ctx.now ?? Date.now()
      const data = records.filter((item) => DATA_KIND_SET.has(item.record.kind))
      const memories = records.filter((item) => item.record.kind === 'memory')
      return db.tx(() => {
        const retried = takePending(ctx, now)
        const base = getState()
        const plan = planRemoteApply(base, [...retried, ...data], storedVersions(DATA_KINDS))
        let generation = syncStateNumber(db, 'generation')
        let state: MobileState | null = null
        if (plan.applied.length) {
          repo.persist(plan.state)
          generation = bumpGeneration()
          state = plan.state
        }
        writeReceivedVersions(plan.versions)
        writeConflicts(plan.conflicts, ctx, now)
        closeSettled(plan.settled, now)
        writePending(plan.pending, ctx, now)
        const memory = applyMemories(memories, ctx, now)
        return {
          applied: plan.applied.length,
          memories: memory.applied,
          conflicts: plan.conflicts.length + memory.conflicts,
          pending: plan.pending.length,
          generation,
          state
        }
      })
    },

    replaceWithRemoteRecords(records, ctx) {
      const latest = latestVersions(records)
      const data = latest.filter((item) => DATA_KIND_SET.has(item.record.kind))
      const memories = latest.filter((item) => item.record.kind === 'memory')
      void ctx
      return db.tx(() => {
        const next = replaceSyncableState(
          emptyState(),
          data.map((item) => item.record)
        )
        repo.persist(next)
        db.run("DELETE FROM records WHERE kind = 'memory'")
        for (const item of memories) repo.writeMemory(item.record)
        db.run('DELETE FROM sync_pending')
        db.run('DELETE FROM sync_records')
        writeReceivedVersions(latest.map(receivedVersion))
        return { generation: bumpGeneration(), state: next, records: latest.length }
      })
    },

    readSyncState(key) {
      return (
        db.get<{ value: string | null }>('SELECT value FROM sync_state WHERE key=?', [key])
          ?.value ?? null
      )
    },

    writeSyncState(key, value) {
      writeSyncState(db, key, value)
    },

    listSyncConflicts(now): SyncConflictRow[] {
      db.run('DELETE FROM sync_conflicts WHERE created_at < ?', [now - CONFLICT_TTL_MS])
      return db
        .all<{
          id: string
          kind: SyncKind
          record_id: string
          type: SyncConflictRow['type']
          loser_cipher: string
          winner_hlc: string | null
          loser_hlc: string
          loser_device: string
          created_at: number
        }>(
          'SELECT id, kind, record_id, type, loser_cipher, winner_hlc, loser_hlc, loser_device, ' +
            'created_at FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC'
        )
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          recordId: r.record_id,
          type: r.type,
          loserCipher: r.loser_cipher,
          winnerHlc: r.winner_hlc,
          loserHlc: r.loser_hlc,
          loserDevice: r.loser_device,
          createdAt: r.created_at
        }))
    },

    openSyncConflictCount(now): number {
      return (
        db.get<{ c: number }>(
          'SELECT COUNT(*) AS c FROM sync_conflicts WHERE resolved_at IS NULL AND created_at >= ?',
          [now - CONFLICT_TTL_MS]
        )?.c ?? 0
      )
    },

    markSyncConflictResolved(id, now): void {
      db.run('UPDATE sync_conflicts SET resolved_at=? WHERE id=? AND resolved_at IS NULL', [
        now,
        id
      ])
    },

    adoptSyncVersion(record, now = Date.now()): SyncStateChange {
      if (record.kind === 'memory') {
        db.tx(() => {
          repo.writeMemory(record)
          captureVersions(
            db,
            me(),
            allMemoryRecords(),
            record.deleted
              ? {
                  kinds: MEMORY_KINDS,
                  complete: false,
                  removedIds: [{ kind: 'memory', id: record.id }]
                }
              : { kinds: MEMORY_KINDS, complete: false },
            now
          )
        })
        return { generation: syncStateNumber(db, 'generation'), state: null }
      }
      const key = recordKey(record.kind, record.id)
      return db.tx(() => {
        const next = applyRecordsToState(getState(), [record])
        const present = extractDataRecords(next).some((r) => recordKey(r.kind, r.id) === key)
        if (!record.deleted && !present) throw new Error('sync record parent missing')
        repo.save(next, now)
        return { generation: bumpGeneration(), state: next }
      })
    },

    rebaseSyncVersion(kind, id, baseHlc, now): boolean {
      return db.tx(() => {
        const current = db.get<{ hash: string; deleted: number }>(
          'SELECT hash, deleted FROM sync_records WHERE kind=? AND id=?',
          [kind, id]
        )
        if (!current) return false
        const state = db.get<{ maxHlc: string | null; maxSeq: number }>(
          'SELECT MAX(hlc) AS maxHlc, COALESCE(MAX(seq), 0) AS maxSeq FROM sync_records'
        ) ?? { maxHlc: null, maxSeq: 0 }
        const row = buildRebasedRow(
          { kind: kind as SyncKind, id, hash: current.hash, deleted: current.deleted === 1 },
          baseHlc,
          state,
          me(),
          now
        )
        db.run(
          'UPDATE sync_records SET hlc=?, device_id=?, seq=?, base_hlc=?, server_seq=NULL ' +
            'WHERE kind=? AND id=?',
          [row.hlc, row.deviceId, row.seq, row.baseHlc, kind, id]
        )
        return true
      })
    },

    syncRecordVersion(kind, id) {
      const row = db.get<{ hlc: string; device_id: string; deleted: number }>(
        'SELECT hlc, device_id, deleted FROM sync_records WHERE kind=? AND id=?',
        [kind, id]
      )
      return row ? { hlc: row.hlc, deviceId: row.device_id, deleted: row.deleted === 1 } : null
    },

    syncRecordOrigins(kind) {
      return new Map(
        db
          .all<{
            id: string
            device_id: string
          }>('SELECT id, device_id FROM sync_records WHERE kind=?', [kind])
          .map((r) => [r.id, r.device_id])
      )
    }
  }
}
