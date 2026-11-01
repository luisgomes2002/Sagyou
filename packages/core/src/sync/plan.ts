import { nextHlc } from './hlc'
import { MEMORY_KINDS, type SyncKind, type SyncRecord } from './records'

export interface StoredVersion {
  kind: SyncKind
  id: string
  hash: string
  deleted: boolean
}

/**
 * Which kinds a capture covers, and whether it saw all of them. A complete
 * capture (a full save) tombstones every live version it did not see; a partial
 * one (one memory saved) tombstones only the ids it names, so the rest stay put.
 */
export interface SyncScope {
  kinds: readonly SyncKind[]
  complete: boolean
  removedIds?: { kind: SyncKind; id: string }[]
}

export interface SyncPlan {
  upserts: SyncRecord[]
  /** The stored version being tombstoned; its hash is kept on the tombstone. */
  deletes: StoredVersion[]
}

export interface SyncRow {
  kind: SyncKind
  id: string
  hlc: string
  deviceId: string
  hash: string
  deleted: boolean
  seq: number
}

const key = (kind: string, id: string): string => `${kind}\0${id}`

export function planSyncChanges(
  records: SyncRecord[],
  stored: StoredVersion[],
  scope: SyncScope
): SyncPlan {
  const kinds = new Set<SyncKind>(scope.kinds)
  const versions = new Map<string, StoredVersion>()
  for (const v of stored) if (kinds.has(v.kind)) versions.set(key(v.kind, v.id), v)

  const seen = new Set<string>()
  const upserts: SyncRecord[] = []
  for (const r of records) {
    if (!kinds.has(r.kind)) continue
    const k = key(r.kind, r.id)
    if (seen.has(k)) continue
    seen.add(k)
    const version = versions.get(k)
    if (!version || version.deleted || version.hash !== r.hash) upserts.push(r)
  }

  const deletes: StoredVersion[] = []
  if (scope.complete) {
    for (const [k, v] of versions) if (!v.deleted && !seen.has(k)) deletes.push(v)
  } else {
    for (const removed of scope.removedIds ?? []) {
      const v = versions.get(key(removed.kind, removed.id))
      if (v && !v.deleted) deletes.push(v)
    }
  }
  return { upserts, deletes }
}

/** The version a record holds before a new capture overwrites it. */
export interface PreviousVersion {
  hlc: string
  baseHlc: string | null
  deviceId: string
  seq: number
}

/**
 * The version a new local edit is made on top of. Other devices only ever
 * see what was pushed, so an edit over a version of this device that has not
 * gone out yet keeps that version's base: two edits before a push reach the
 * other side as one, made on top of what it already has.
 */
export function captureBaseHlc(
  previous: PreviousVersion | undefined,
  deviceId: string,
  pushedSeq: number
): string | null {
  if (!previous) return null
  if (previous.deviceId === deviceId && previous.seq > pushedSeq) return previous.baseHlc
  return previous.hlc
}

/** Turn a plan into rows, each with a newer version and the next local sequence. */
export function buildSyncRows(
  plan: SyncPlan,
  state: { maxHlc: string | null; maxSeq: number },
  deviceId: string,
  nowMs: number
): SyncRow[] {
  let hlc = state.maxHlc
  let seq = state.maxSeq
  const row = (kind: SyncKind, id: string, hash: string, deleted: boolean): SyncRow => {
    hlc = nextHlc(nowMs, hlc, deviceId)
    seq += 1
    return { kind, id, hlc, deviceId, hash, deleted, seq }
  }
  return [
    ...plan.upserts.map((r) => row(r.kind, r.id, r.hash, false)),
    ...plan.deletes.map((v) => row(v.kind, v.id, v.hash, true))
  ]
}

/**
 * A new version of this device for content it already holds, made on top of
 * `baseHlc` (a version received from another device and kept aside). Keeping
 * the local side of a pending choice this way makes the other device, which
 * still holds that version, apply ours without a new conflict. The HLC passes
 * `baseHlc` too: the received version was never written to sync_records, so
 * the stored maximum may be behind it.
 */
export function buildRebasedRow(
  current: { kind: SyncKind; id: string; hash: string; deleted: boolean },
  baseHlc: string,
  state: { maxHlc: string | null; maxSeq: number },
  deviceId: string,
  nowMs: number
): SyncRow & { baseHlc: string } {
  const last = state.maxHlc !== null && state.maxHlc > baseHlc ? state.maxHlc : baseHlc
  return {
    kind: current.kind,
    id: current.id,
    hlc: nextHlc(nowMs, last, deviceId),
    deviceId,
    hash: current.hash,
    deleted: current.deleted,
    seq: state.maxSeq + 1,
    baseHlc
  }
}

/**
 * Memory writes go straight to SQL, one or a few rows at a time, so their
 * captures are partial: only a wholesale replace (backup restore) sees every
 * memory and may tombstone the ones it did not write.
 */
export function memoryCaptureScope(
  op: 'upsert' | 'archive' | 'delete' | 'replace' | 'scrub',
  ids: string[]
): SyncScope {
  if (op === 'replace') return { kinds: MEMORY_KINDS, complete: true }
  if (op === 'delete')
    return {
      kinds: MEMORY_KINDS,
      complete: false,
      removedIds: ids.map((id) => ({ kind: 'memory' as const, id }))
    }
  return { kinds: MEMORY_KINDS, complete: false }
}
