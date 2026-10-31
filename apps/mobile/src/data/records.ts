import { recordKey, type WireRecord } from '@sagyou/core/sync/batch'
import { randomBytes, toHex } from '@sagyou/core/sync/bytes'
import { buildSyncRows, captureBaseHlc, planSyncChanges } from '@sagyou/core/sync/plan'
import {
  DATA_KINDS,
  canonicalJson,
  extractDataRecords,
  hashPayload,
  type SyncKind,
  type SyncRecord
} from '@sagyou/core/sync/records'
import { replaceSyncableState } from '@sagyou/core/sync/replace'
import type { SqlDb } from './sql'
import { emptyState, type MobileState } from './state'

type Row = Record<string, unknown>

const DATA_KIND_SET = new Set<string>(DATA_KINDS)

/** Keys (`kind:id`) a persist wrote or removed, for the search index. */
export interface PersistChange {
  written: SyncRecord[]
  removed: { kind: SyncKind; id: string }[]
}

export interface RecordRepo {
  /** This installation's stage-1 sync id (32 hex), created once; never leaves the phone. */
  deviceId(): string
  /** The state rebuilt from the stored payloads, exactly as they came (no re-normalizing). */
  loadState(): MobileState
  /** A local edit: write what changed and mint a version for it. Returns the versions made. */
  save(next: MobileState, now: number): number
  /** Write a state without minting versions (a received change). */
  persist(next: MobileState): PersistChange
  /** Every data record as stored, keyed by kind:id (the engine's currentSyncRecords). */
  currentRecords(): Map<string, SyncRecord>
  memoryPayload(id: string): Row | undefined
  /** A received memory upsert or delete, stored as its payload. */
  writeMemory(record: WireRecord): void
  readPref(key: string): string | null
  writePref(key: string, value: string | null): void
}

export function syncStateNumber(db: SqlDb, key: string): number {
  const row = db.get<{ value: string | null }>('SELECT value FROM sync_state WHERE key=?', [key])
  const n = Number(row?.value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function writeSyncState(db: SqlDb, key: string, value: string): void {
  db.run(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?',
    [key, value, value]
  )
}

export function createRecordRepo(
  db: SqlDb,
  onPersist: (change: PersistChange, state: MobileState) => void = () => undefined
): RecordRepo {
  let cachedDeviceId: string | null = null

  const readPref = (key: string): string | null =>
    db.get<{ value: string | null }>('SELECT value FROM prefs WHERE key=?', [key])?.value ?? null

  const writePref = (key: string, value: string | null): void => {
    if (value === null) db.run('DELETE FROM prefs WHERE key=?', [key])
    else
      db.run(
        'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?',
        [key, value, value]
      )
  }

  const deviceId = (): string => {
    if (cachedDeviceId) return cachedDeviceId
    let id = readPref('device_id')
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      id = toHex(randomBytes(16))
      writePref('device_id', id)
    }
    cachedDeviceId = id
    return id
  }

  const storedHashes = (): Map<string, string> =>
    new Map(
      db
        .all<{
          kind: string
          id: string
          hash: string
        }>("SELECT kind, id, hash FROM records WHERE kind <> 'memory'")
        .map((r) => [recordKey(r.kind, r.id), r.hash])
    )

  const persist = (next: MobileState): PersistChange => {
    const records = extractDataRecords(next)
    const stored = storedHashes()
    const written: SyncRecord[] = []
    const seen = new Set<string>()
    for (const record of records) {
      const key = recordKey(record.kind, record.id)
      seen.add(key)
      if (stored.get(key) === record.hash) continue
      db.run(
        `INSERT INTO records (kind, id, payload, hash) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET payload=excluded.payload, hash=excluded.hash`,
        [record.kind, record.id, canonicalJson(record.payload), record.hash]
      )
      written.push(record)
    }
    const removed: { kind: SyncKind; id: string }[] = []
    for (const key of stored.keys()) {
      if (seen.has(key)) continue
      const at = key.indexOf(':')
      const kind = key.slice(0, at) as SyncKind
      const id = key.slice(at + 1)
      db.run('DELETE FROM records WHERE kind=? AND id=?', [kind, id])
      removed.push({ kind, id })
    }
    const change = { written, removed }
    if (written.length || removed.length) onPersist(change, next)
    return change
  }

  return {
    deviceId,
    readPref,
    writePref,

    loadState(): MobileState {
      const rows = db.all<{ kind: string; id: string; payload: string }>(
        "SELECT kind, id, payload FROM records WHERE kind <> 'memory'"
      )
      const wire: WireRecord[] = rows
        .filter((r) => DATA_KIND_SET.has(r.kind))
        .map((r) => ({
          kind: r.kind as SyncKind,
          id: r.id,
          hlc: '',
          baseHlc: null,
          deleted: false,
          payload: JSON.parse(r.payload) as Row
        }))
      return replaceSyncableState(emptyState(), wire)
    },

    persist,

    save(next: MobileState, now: number): number {
      return db.tx(() => {
        persist(next)
        const records = extractDataRecords(next)
        const stored = db
          .all<{
            kind: SyncKind
            id: string
            hlc: string
            hash: string
            deleted: number
            device_id: string
            base_hlc: string | null
            seq: number
          }>(
            `SELECT kind, id, hlc, hash, deleted, device_id, base_hlc, seq FROM sync_records
             WHERE kind <> 'memory'`
          )
          .map((r) => ({
            kind: r.kind,
            id: r.id,
            hlc: r.hlc,
            hash: r.hash,
            deleted: r.deleted === 1,
            deviceId: r.device_id,
            baseHlc: r.base_hlc,
            seq: r.seq
          }))
        const plan = planSyncChanges(records, stored, { kinds: DATA_KINDS, complete: true })
        if (!plan.upserts.length && !plan.deletes.length) return 0
        const state = db.get<{ maxHlc: string | null; maxSeq: number }>(
          'SELECT MAX(hlc) AS maxHlc, COALESCE(MAX(seq), 0) AS maxSeq FROM sync_records'
        ) ?? { maxHlc: null, maxSeq: 0 }
        const me = deviceId()
        const rows = buildSyncRows(plan, state, me, now)
        const pushedSeq = syncStateNumber(db, 'pushed_seq')
        const previous = new Map(stored.map((v) => [recordKey(v.kind, v.id), v]))
        for (const row of rows) {
          const base = captureBaseHlc(previous.get(recordKey(row.kind, row.id)), me, pushedSeq)
          db.run(
            `INSERT INTO sync_records (kind, id, hlc, device_id, hash, deleted, seq, base_hlc, server_seq)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(kind, id) DO UPDATE SET
               hlc=excluded.hlc, device_id=excluded.device_id, hash=excluded.hash,
               deleted=excluded.deleted, seq=excluded.seq, base_hlc=excluded.base_hlc,
               server_seq=NULL`,
            [row.kind, row.id, row.hlc, row.deviceId, row.hash, row.deleted ? 1 : 0, row.seq, base]
          )
        }
        return rows.length
      })
    },

    currentRecords(): Map<string, SyncRecord> {
      const rows = db.all<{ kind: SyncKind; id: string; payload: string; hash: string }>(
        'SELECT kind, id, payload, hash FROM records'
      )
      return new Map(
        rows.map((r) => [
          recordKey(r.kind, r.id),
          { kind: r.kind, id: r.id, payload: JSON.parse(r.payload) as Row, hash: r.hash }
        ])
      )
    },

    memoryPayload(id: string): Row | undefined {
      const row = db.get<{ payload: string }>(
        "SELECT payload FROM records WHERE kind='memory' AND id=?",
        [id]
      )
      return row ? (JSON.parse(row.payload) as Row) : undefined
    },

    writeMemory(record: WireRecord): void {
      if (record.deleted || !record.payload) {
        db.run("DELETE FROM records WHERE kind='memory' AND id=?", [record.id])
        return
      }
      db.run(
        `INSERT INTO records (kind, id, payload, hash) VALUES ('memory', ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET payload=excluded.payload, hash=excluded.hash`,
        [record.id, canonicalJson(record.payload), hashPayload(record.payload)]
      )
    }
  }
}
