/**
 * Turning received versions back into app state, without SQL.
 *
 * `applyRecordsToState` is the inverse of `extractDataRecords`: each record is
 * put back where the renderer keeps it (a transaction inside its table, a
 * column inside its project), and device-only fields (code paths, timers, UI
 * preferences, the active profile) are never touched. `planRemoteApply` runs
 * the conflict rule over a whole pull and says what store.ts must write;
 * `guardStaleSave` keeps a late renderer save from undoing a received change.
 */
import { gunzipSync, gzipSync } from 'zlib'
import { normalizeMemory, type AiMemory } from '../ai/memory'
import { recordKey, type WireRecord } from './sync-batch'
import { decideIncoming, parentOf, type LocalVersion, type ParentState } from './sync-merge'
import { DATA_KINDS, extractDataRecords, hashPayload, type SyncKind } from './sync-records'

/** A pending child that never saw its parent is dropped after 30 days. */
export const PENDING_TTL_MS = 30 * 86400000

type Row = Record<string, unknown>

/** The parts of the store's save payload that sync rewrites; everything else passes through. */
export interface SyncableState {
  projects: object[]
  tasks: object[]
  sprints: object[]
  notes: object[]
  goals: object[]
  habits: object[]
  lists: object[]
  files: object[]
  financialProfiles?: object[]
  timeBlocks?: object[]
  routines?: object[]
}

/** One received version, with the sender's opaque id and the server seq it came down with. */
export interface IncomingRecord {
  record: WireRecord
  device: string
  serverSeq: number | null
  /** When it first arrived (ms); set on records retried from sync_pending. */
  receivedAt?: number
}

/** A row of sync_records as the planner needs it. */
export interface StoredSyncVersion extends LocalVersion {
  deviceId: string
  baseHlc: string | null
}

export interface VersionWrite {
  kind: SyncKind
  id: string
  hlc: string
  baseHlc: string | null
  deviceId: string
  hash: string
  deleted: boolean
  serverSeq: number | null
}

export type ConflictType = 'lww' | 'pending_choice' | 'orphan'

export interface ConflictWrite {
  type: ConflictType
  kind: SyncKind
  recordId: string
  /** The version that did not become current (sealed before it is stored). */
  loser: WireRecord
  loserDevice: string
  winnerHlc: string | null
  loserHlc: string
}

export interface ApplyPlan<T> {
  state: T
  /** Records written into `state`, in order. */
  applied: WireRecord[]
  versions: VersionWrite[]
  conflicts: ConflictWrite[]
  /** Children whose parent has not arrived yet. */
  pending: IncomingRecord[]
}

// ── applyRecordsToState ──────────────────────────────────────────────────────

type DataKind = Exclude<SyncKind, 'memory'>

// Required fields as the renderer and the SQLite insert expect them. A payload
// drops '', false and empty lists (see clean() in sync-records.ts), so they
// come back from here; values that survived in the payload always win.
const DEFAULTS: Record<DataKind, Row> = {
  project: { name: '', color: '', createdAt: '', updatedAt: '' },
  project_column: { name: '', order: 0 },
  project_link: { label: '', url: '' },
  task: {
    projectId: '',
    columnId: '',
    title: '',
    priority: '',
    tags: [],
    order: 0,
    createdAt: '',
    updatedAt: ''
  },
  sprint: { projectId: '', name: '', createdAt: '' },
  note: {
    projectId: '',
    content: '',
    color: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    createdAt: '',
    updatedAt: ''
  },
  goal: { title: '', target: 0, unit: '', color: '', createdAt: '', updatedAt: '' },
  goal_entry: { date: '', value: 0, createdAt: '' },
  habit: { name: '', color: '', createdAt: '', updatedAt: '' },
  habit_completion: {},
  financial_profile: { name: '', createdAt: '', updatedAt: '' },
  financial_table: { name: '', currency: '', createdAt: '', updatedAt: '' },
  financial_debt: {
    name: '',
    originalAmount: '0',
    remainingAmount: '0',
    createdAt: '',
    updatedAt: ''
  },
  transaction: { description: '', amount: '0', type: '', date: '' },
  shopping_item: { name: '', qty: 0, done: false },
  financial_goal: { name: '', targetAmount: '0', targetMonth: 0, targetYear: 0 },
  yield_source: { name: '', createdAt: '' },
  yield_entry: { sourceId: '', date: '', amount: '0', createdAt: '' },
  file: { name: '', ext: '', size: 0, createdAt: '' },
  time_block: {
    date: '',
    startTime: '',
    endTime: '',
    title: '',
    type: '',
    order: 0,
    createdAt: '',
    updatedAt: ''
  },
  routine: {
    title: '',
    startTime: '',
    endTime: '',
    daysOfWeek: [],
    active: false,
    createdAt: '',
    updatedAt: ''
  }
}

const TOP_LEVEL: Partial<Record<DataKind, string>> = {
  project: 'projects',
  task: 'tasks',
  sprint: 'sprints',
  note: 'notes',
  goal: 'goals',
  habit: 'habits',
  financial_profile: 'financialProfiles',
  financial_table: 'lists',
  file: 'files',
  time_block: 'timeBlocks',
  routine: 'routines'
}

/** Fields of a parent entity that are not in its record: its children and device-only fields. */
const KEPT_ON_PARENT: Partial<Record<DataKind, string[]>> = {
  project: ['columns', 'links', 'codePaths', 'activeCodePathIds', 'activeCodePathId'],
  goal: ['entries'],
  habit: ['completions'],
  financial_table: ['items', 'transactions', 'goals', 'debts', 'yieldSources', 'yieldEntries']
}

const EMPTY_CHILDREN: Partial<Record<DataKind, Row>> = {
  project: { columns: [] },
  goal: { entries: [] },
  habit: { completions: [] },
  financial_table: {
    items: [],
    transactions: [],
    goals: [],
    debts: [],
    yieldSources: [],
    yieldEntries: []
  }
}

/** Where a nested child lives: the parent's collection, its field, and the payload field naming the parent. */
const NESTED: Partial<Record<DataKind, { parent: string; field: string; ref: string }>> = {
  project_column: { parent: 'projects', field: 'columns', ref: 'projectId' },
  project_link: { parent: 'projects', field: 'links', ref: 'projectId' },
  goal_entry: { parent: 'goals', field: 'entries', ref: 'goalId' },
  financial_debt: { parent: 'lists', field: 'debts', ref: 'tableId' },
  transaction: { parent: 'lists', field: 'transactions', ref: 'tableId' },
  shopping_item: { parent: 'lists', field: 'items', ref: 'tableId' },
  financial_goal: { parent: 'lists', field: 'goals', ref: 'tableId' },
  yield_source: { parent: 'lists', field: 'yieldSources', ref: 'tableId' },
  yield_entry: { parent: 'lists', field: 'yieldEntries', ref: 'tableId' }
}

function list(state: Row, key: string): Row[] {
  if (!Array.isArray(state[key])) state[key] = []
  return state[key] as Row[]
}

function childList(parent: Row, field: string): Row[] {
  if (!Array.isArray(parent[field])) parent[field] = []
  return parent[field] as Row[]
}

function entityFrom(kind: DataKind, payload: Row): Row {
  const entity: Row = { ...DEFAULTS[kind], ...payload }
  const nested = NESTED[kind]
  if (nested) delete entity[nested.ref]
  return entity
}

function upsertById(items: Row[], entity: Row): void {
  const index = items.findIndex((item) => item.id === entity.id)
  if (index >= 0) items[index] = entity
  else items.push(entity)
}

function removeById(items: Row[], id: string): void {
  const index = items.findIndex((item) => item.id === id)
  if (index >= 0) items.splice(index, 1)
}

function applyTopLevel(state: Row, kind: DataKind, key: string, record: WireRecord): void {
  const items = list(state, key)
  if (record.deleted || !record.payload) {
    removeById(items, record.id)
    return
  }
  const entity = entityFrom(kind, record.payload)
  const kept = KEPT_ON_PARENT[kind]
  if (kept) {
    const existing = items.find((item) => item.id === record.id)
    if (existing) {
      for (const field of kept) if (field in existing) entity[field] = existing[field]
    } else Object.assign(entity, structuredClone(EMPTY_CHILDREN[kind] ?? {}))
  }
  upsertById(items, entity)
}

function applyNested(
  state: Row,
  kind: DataKind,
  nested: { parent: string; field: string; ref: string },
  record: WireRecord
): void {
  const parents = list(state, nested.parent)
  const target =
    record.deleted || !record.payload
      ? undefined
      : parents.find((p) => p.id === record.payload?.[nested.ref])
  const current = parents.find(
    (p) =>
      Array.isArray(p[nested.field]) && (p[nested.field] as Row[]).some((c) => c.id === record.id)
  )
  if (!target) {
    // A tombstone, or a child whose parent is not here (the planner never lets that through).
    if (record.deleted && current) removeById(childList(current, nested.field), record.id)
    return
  }
  const entity = entityFrom(kind, record.payload as Row)
  if (current && current !== target) removeById(childList(current, nested.field), record.id)
  upsertById(childList(target, nested.field), entity)
}

function applyCompletion(state: Row, record: WireRecord): void {
  const split = record.id.lastIndexOf(':')
  const habitId =
    typeof record.payload?.habitId === 'string' ? record.payload.habitId : record.id.slice(0, split)
  const date =
    typeof record.payload?.date === 'string' ? record.payload.date : record.id.slice(split + 1)
  const habit = list(state, 'habits').find((h) => h.id === habitId)
  if (!habit) return
  const completions = (Array.isArray(habit.completions) ? habit.completions : []).filter(
    (d) => d !== date
  ) as string[]
  if (!record.deleted) completions.push(date)
  habit.completions = completions.sort()
}

/**
 * Insert, replace or remove each record where the renderer keeps it. Records
 * apply in order, so a parent must come before its children. Nothing outside
 * the records changes: device fields and unrelated entities pass through.
 */
export function applyRecordsToState<T extends SyncableState>(state: T, records: WireRecord[]): T {
  const next = structuredClone(state) as unknown as Row
  for (const record of records) {
    if (record.kind === 'memory') continue
    const kind = record.kind
    if (kind === 'habit_completion') {
      applyCompletion(next, record)
      continue
    }
    const key = TOP_LEVEL[kind]
    if (key) {
      applyTopLevel(next, kind, key, record)
      continue
    }
    const nested = NESTED[kind]
    if (nested) applyNested(next, kind, nested, record)
  }
  return next as unknown as T
}

// ── guardStaleSave ───────────────────────────────────────────────────────────

const KIND_ORDER = new Map<SyncKind, number>(DATA_KINDS.map((kind, index) => [kind, index]))

function splitKey(key: string): { kind: SyncKind; id: string } | null {
  const at = key.indexOf(':')
  if (at <= 0) return null
  const kind = key.slice(0, at) as SyncKind
  return KIND_ORDER.has(kind) ? { kind, id: key.slice(at + 1) } : null
}

/**
 * A renderer save built before it saw a received change would write the old
 * version back. For every record changed remotely since the renderer's
 * generation, keep what `current` (the database) has; every other edit in
 * `next` goes through.
 */
export function guardStaleSave<T extends SyncableState>(
  next: T,
  current: T,
  remoteKeys: Set<string>
): T {
  if (!remoteKeys.size) return next
  const records = new Map(extractDataRecords(current).map((r) => [recordKey(r.kind, r.id), r]))
  const wires: WireRecord[] = []
  for (const key of remoteKeys) {
    const parsed = splitKey(key)
    if (!parsed) continue
    const record = records.get(key)
    const wire: WireRecord = { ...parsed, hlc: '', baseHlc: null, deleted: !record }
    if (record) wire.payload = record.payload
    wires.push(wire)
  }
  wires.sort((a, b) => (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0))
  return applyRecordsToState(next, wires)
}

// ── planRemoteApply ──────────────────────────────────────────────────────────

const PARENT_COLLECTION: Partial<Record<SyncKind, string>> = {
  project: 'projects',
  goal: 'goals',
  habit: 'habits',
  financial_table: 'lists'
}

interface Resolver {
  versions: VersionWrite[]
  conflicts: ConflictWrite[]
  applied: WireRecord[]
  /** Returns false when the record must wait for its parent. */
  resolve(item: IncomingRecord): boolean
}

function createResolver(
  stored: Map<string, StoredSyncVersion>,
  localPayload: (kind: SyncKind, id: string) => Row | undefined,
  parentPresent: (kind: SyncKind, id: string) => boolean
): Resolver {
  const known = new Map(stored)
  // What this pull already applied: later records read it instead of the old state.
  const overlay = new Map<string, WireRecord>()
  const versions: VersionWrite[] = []
  const conflicts: ConflictWrite[] = []
  const applied: WireRecord[] = []

  const parentState = (record: WireRecord): ParentState => {
    const ref = parentOf(record)
    if (!ref) return null
    const key = recordKey(ref.kind, ref.id)
    const seen = overlay.get(key)
    const present = seen ? !seen.deleted : parentPresent(ref.kind, ref.id)
    if (present) return { present: true, deleted: false }
    return { present: false, deleted: known.get(key)?.deleted === true }
  }

  const writeVersion = (item: IncomingRecord, hash: string): void => {
    const { record } = item
    const version: VersionWrite = {
      kind: record.kind,
      id: record.id,
      hlc: record.hlc,
      baseHlc: record.baseHlc,
      deviceId: item.device,
      hash,
      deleted: record.deleted,
      serverSeq: item.serverSeq
    }
    known.set(recordKey(record.kind, record.id), {
      hlc: version.hlc,
      hash,
      deleted: version.deleted,
      deviceId: version.deviceId,
      baseHlc: version.baseHlc
    })
    versions.push(version)
  }

  const localWire = (record: WireRecord, local: StoredSyncVersion): WireRecord => {
    const key = recordKey(record.kind, record.id)
    const seen = overlay.get(key)
    const payload = seen
      ? seen.payload
      : local.deleted
        ? undefined
        : localPayload(record.kind, record.id)
    const wire: WireRecord = {
      kind: record.kind,
      id: record.id,
      hlc: local.hlc,
      baseHlc: local.baseHlc,
      deleted: !payload
    }
    if (payload) wire.payload = payload
    return wire
  }

  const keep = (
    type: ConflictType,
    loser: WireRecord,
    loserDevice: string,
    winnerHlc: string | null
  ): void => {
    conflicts.push({
      type,
      kind: loser.kind,
      recordId: loser.id,
      loser,
      loserDevice,
      winnerHlc,
      loserHlc: loser.hlc
    })
  }

  const apply = (item: IncomingRecord, local: StoredSyncVersion | null): void => {
    const { record } = item
    const hash =
      !record.deleted && record.payload ? hashPayload(record.payload) : (local?.hash ?? '')
    overlay.set(recordKey(record.kind, record.id), record)
    applied.push(record)
    writeVersion(item, hash)
  }

  const resolve = (item: IncomingRecord): boolean => {
    const { record } = item
    const local = known.get(recordKey(record.kind, record.id)) ?? null
    const decision = decideIncoming(record, local, parentState(record))
    switch (decision.type) {
      case 'apply':
        apply(item, local)
        return true
      case 'skip':
        // Same content minted twice (two devices joining with equal data):
        // adopt the newer version so the next edit on either side is not a conflict.
        if (
          local &&
          record.hlc > local.hlc &&
          record.deleted === local.deleted &&
          (record.deleted || (record.payload && hashPayload(record.payload) === local.hash))
        )
          writeVersion(item, local.hash)
        return true
      case 'apply-and-keep-loser':
        if (local) keep('lww', localWire(record, local), local.deviceId, record.hlc)
        apply(item, local)
        return true
      case 'keep-local-and-keep-loser':
        keep('lww', record, item.device, local?.hlc ?? null)
        return true
      case 'pending-choice':
        keep('pending_choice', record, item.device, local?.hlc ?? null)
        return true
      case 'orphan-conflict':
        keep('orphan', record, item.device, null)
        return true
      case 'wait-parent':
        return false
    }
  }

  return { versions, conflicts, applied, resolve }
}

/** Run the records again while any of them waits for a parent that a later one brought. */
function resolveAll(resolver: Resolver, incoming: IncomingRecord[]): IncomingRecord[] {
  let queue = incoming
  for (;;) {
    const waiting = queue.filter((item) => !resolver.resolve(item))
    if (!waiting.length || waiting.length === queue.length) return waiting
    queue = waiting
  }
}

/**
 * Decide every received data record against the local versions and fold the
 * winners into `state`. Nothing is written: store.ts persists `state`, the
 * versions, the conflicts (sealed) and the pending children.
 */
export function planRemoteApply<T extends SyncableState>(
  state: T,
  incoming: IncomingRecord[],
  stored: Map<string, StoredSyncVersion>
): ApplyPlan<T> {
  let index: Map<string, Row> | null = null
  const localPayload = (kind: SyncKind, id: string): Row | undefined => {
    index ??= new Map(extractDataRecords(state).map((r) => [recordKey(r.kind, r.id), r.payload]))
    return index.get(recordKey(kind, id))
  }
  const source = state as unknown as Row
  const parentPresent = (kind: SyncKind, id: string): boolean => {
    const collection = PARENT_COLLECTION[kind]
    if (collection) {
      const items = source[collection]
      return Array.isArray(items) && items.some((item) => (item as Row)?.id === id)
    }
    return localPayload(kind, id) !== undefined
  }
  const resolver = createResolver(stored, localPayload, parentPresent)
  const data = incoming.filter((item) => KIND_ORDER.has(item.record.kind))
  const pending = resolveAll(resolver, data)
  return {
    state: resolver.applied.length ? applyRecordsToState(state, resolver.applied) : state,
    applied: resolver.applied,
    versions: resolver.versions,
    conflicts: resolver.conflicts,
    pending
  }
}

export interface MemoryApplyPlan {
  applied: WireRecord[]
  versions: VersionWrite[]
  conflicts: ConflictWrite[]
}

/** Same rule for memories, which have no parent and live outside the save payload. */
export function planMemoryApply(
  incoming: IncomingRecord[],
  stored: Map<string, StoredSyncVersion>,
  localPayload: (id: string) => Row | undefined
): MemoryApplyPlan {
  const resolver = createResolver(
    stored,
    (_kind, id) => localPayload(id),
    () => true
  )
  for (const item of incoming) if (item.record.kind === 'memory') resolver.resolve(item)
  return {
    applied: resolver.applied,
    versions: resolver.versions,
    conflicts: resolver.conflicts
  }
}

/** A received memory, keeping this device's access bookkeeping when it already has the memory. */
export function memoryFromPayload(
  payload: Row,
  existing: AiMemory | null,
  nowIso: string
): AiMemory {
  return normalizeMemory(
    {
      ...(payload as unknown as Partial<AiMemory>),
      id: String(payload.id),
      lastAccessedAt: existing?.lastAccessedAt,
      accessCount: existing?.accessCount
    },
    nowIso
  )
}

// ── sync_pending payload ─────────────────────────────────────────────────────

/** Bytes sealed into sync_pending.record_cipher: the record plus where it came from. */
export function encodeIncoming(item: IncomingRecord): Uint8Array {
  return new Uint8Array(
    gzipSync(
      JSON.stringify({ record: item.record, device: item.device, serverSeq: item.serverSeq })
    )
  )
}

export function decodeIncoming(bytes: Uint8Array): IncomingRecord {
  const parsed = JSON.parse(gunzipSync(bytes).toString('utf8')) as Row
  const record = parsed.record as WireRecord | undefined
  if (
    !record ||
    typeof record.kind !== 'string' ||
    typeof record.id !== 'string' ||
    typeof record.hlc !== 'string' ||
    typeof parsed.device !== 'string'
  )
    throw new Error('invalid pending sync record')
  return {
    record,
    device: parsed.device,
    serverSeq: typeof parsed.serverSeq === 'number' ? parsed.serverSeq : null
  }
}
