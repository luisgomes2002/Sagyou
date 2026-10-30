import { nextHlc } from './hlc'
import { MEMORY_KINDS, type SyncKind, type SyncRecord } from './sync-records'

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
