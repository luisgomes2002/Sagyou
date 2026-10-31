// @vitest-environment node
//
// Pending versions are sent with the record's current payload, in batches of
// at most 500 records and 256 KB before encryption. Decoding refuses anything
// that is not a version-1 batch of well-formed records.
import { gzipSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import {
  buildOutgoing,
  decodeBatch,
  encodeBatch,
  MAX_BATCH_BYTES,
  packBatches,
  recordKey,
  type OutgoingRow,
  type WireRecord
} from '../modules/sync/sync-batch'
import type { SyncRecord } from '../modules/sync/sync-records'

function wire(i: number, payload: Record<string, unknown> = { title: `t${i}` }): WireRecord {
  return { kind: 'task', id: `t${i}`, hlc: `h${i}`, baseHlc: null, deleted: false, payload }
}

describe('buildOutgoing', () => {
  const row = (id: string, seq: number, deleted = false): OutgoingRow => ({
    kind: 'task',
    id,
    hlc: `h-${id}`,
    baseHlc: 'base',
    deleted,
    seq
  })
  const current = new Map<string, SyncRecord>([
    [recordKey('task', 'a'), { kind: 'task', id: 'a', payload: { title: 'A' }, hash: 'x' }]
  ])

  it('pairs a version with the current payload, in seq order', () => {
    const out = buildOutgoing([row('a', 2)], current)
    expect(out).toEqual([
      {
        kind: 'task',
        id: 'a',
        hlc: 'h-a',
        baseHlc: 'base',
        deleted: false,
        payload: { title: 'A' }
      }
    ])
  })

  it('sends a tombstone without payload', () => {
    const [out] = buildOutgoing([row('a', 1, true)], current)
    expect(out.deleted).toBe(true)
    expect(out).not.toHaveProperty('payload')
  })

  it('sends a version whose record is gone as a tombstone', () => {
    const [out] = buildOutgoing([row('gone', 1)], current)
    expect(out.deleted).toBe(true)
    expect(out).not.toHaveProperty('payload')
  })

  it('orders by seq', () => {
    const out = buildOutgoing([row('a', 5), row('gone', 1)], current)
    expect(out.map((r) => r.id)).toEqual(['gone', 'a'])
  })
})

describe('packBatches', () => {
  it('splits 1200 small records into 500/500/200', () => {
    const batches = packBatches(Array.from({ length: 1200 }, (_, i) => wire(i)))
    expect(batches.map((b) => b.records.length)).toEqual([500, 500, 200])
  })

  it('keeps every batch within 256 KB', () => {
    const big = 'x'.repeat(100_000)
    const batches = packBatches(Array.from({ length: 7 }, (_, i) => wire(i, { body: big })))
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) expect(batch.bytes).toBeLessThanOrEqual(MAX_BATCH_BYTES)
    expect(batches.flatMap((b) => b.records)).toHaveLength(7)
  })

  it('sends a record larger than the limit on its own', () => {
    const huge = wire(1, { body: 'x'.repeat(MAX_BATCH_BYTES + 10) })
    const batches = packBatches([wire(0), huge, wire(2)])
    expect(batches.map((b) => b.records.map((r) => r.id))).toEqual([['t0'], ['t1'], ['t2']])
  })
})

describe('encodeBatch / decodeBatch', () => {
  it('round-trips', () => {
    const records = [wire(1), { ...wire(2), deleted: true, payload: undefined }]
    delete (records[1] as Partial<WireRecord>).payload
    expect(decodeBatch(encodeBatch(records))).toEqual(records)
  })

  it('refuses another batch version', () => {
    const bytes = new Uint8Array(gzipSync(JSON.stringify({ v: 2, records: [] })))
    expect(() => decodeBatch(bytes)).toThrow(/version/)
  })

  it('refuses malformed records', () => {
    const bytes = new Uint8Array(gzipSync(JSON.stringify({ v: 1, records: [{ kind: 'task' }] })))
    expect(() => decodeBatch(bytes)).toThrow()
  })
})
