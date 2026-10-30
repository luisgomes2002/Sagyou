/**
 * What goes over the wire: the versions this device minted since the last
 * push, each with the record's current payload, packed into batches small
 * enough for one request. A batch is `{v: 1, records}` as JSON, gzipped before
 * it is sealed (sync-crypto.ts); the server only ever sees the sealed bytes.
 */
import { gunzipSync, gzipSync } from 'zlib'
import type { SyncKind, SyncRecord } from './sync-records'

export const MAX_BATCH_BYTES = 262144
export const MAX_BATCH_RECORDS = 500
const BATCH_VERSION = 1

/** One version as both devices understand it. The receiver recomputes the hash. */
export interface WireRecord {
  kind: SyncKind
  id: string
  hlc: string
  /** The version this edit was made on top of; null for the first version. */
  baseHlc: string | null
  deleted: boolean
  payload?: Record<string, unknown>
}

/** A row of sync_records waiting to be pushed. */
export interface OutgoingRow {
  kind: SyncKind
  id: string
  hlc: string
  baseHlc: string | null
  deleted: boolean
  seq: number
}

export function recordKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

/**
 * Pair each pending version with the record's current payload. A version whose
 * record no longer exists goes out as a tombstone: the payload it was minted
 * with is gone, and a later delete is already on its way.
 */
export function buildOutgoing(rows: OutgoingRow[], current: Map<string, SyncRecord>): WireRecord[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .map((row) => {
      const record = row.deleted ? undefined : current.get(recordKey(row.kind, row.id))
      const wire: WireRecord = {
        kind: row.kind,
        id: row.id,
        hlc: row.hlc,
        baseHlc: row.baseHlc,
        deleted: !record
      }
      if (record) wire.payload = record.payload
      return wire
    })
}

function wireBytes(record: WireRecord): number {
  return Buffer.byteLength(JSON.stringify(record))
}

/** Split into batches of at most MAX_BATCH_RECORDS and MAX_BATCH_BYTES (an oversized record travels alone). */
export function packBatches(records: WireRecord[]): { records: WireRecord[]; bytes: number }[] {
  const batches: { records: WireRecord[]; bytes: number }[] = []
  let current: WireRecord[] = []
  let bytes = 0
  for (const record of records) {
    const size = wireBytes(record) + 1
    if (
      current.length &&
      (current.length >= MAX_BATCH_RECORDS || bytes + size > MAX_BATCH_BYTES)
    ) {
      batches.push({ records: current, bytes })
      current = []
      bytes = 0
    }
    current.push(record)
    bytes += size
  }
  if (current.length) batches.push({ records: current, bytes })
  return batches
}

export function encodeBatch(records: WireRecord[]): Uint8Array {
  return new Uint8Array(gzipSync(JSON.stringify({ v: BATCH_VERSION, records })))
}

function isWireRecord(value: unknown): value is WireRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    typeof r.kind === 'string' &&
    typeof r.id === 'string' &&
    typeof r.hlc === 'string' &&
    (r.baseHlc === null || typeof r.baseHlc === 'string') &&
    typeof r.deleted === 'boolean' &&
    (r.deleted
      ? r.payload === undefined
      : !!r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload))
  )
}

export function decodeBatch(bytes: Uint8Array): WireRecord[] {
  const parsed = JSON.parse(gunzipSync(bytes).toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid sync batch')
  const { v, records } = parsed as { v?: unknown; records?: unknown }
  if (v !== BATCH_VERSION) throw new Error(`unsupported sync batch version ${String(v)}`)
  if (!Array.isArray(records) || !records.every(isWireRecord)) throw new Error('invalid sync batch')
  return records
}
