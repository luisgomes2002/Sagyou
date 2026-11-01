/**
 * "Substituir pelos da nuvem" and "a nuvem manda", without SQL.
 *
 * The local syncable data is dropped and rebuilt from the cloud's latest
 * version of each record. Only what belongs to this device survives: timers,
 * UI preferences, the active profile and project, and each surviving project's
 * code paths. Whatever existed only here is gone from the database; the forced
 * backup the engine makes first is where it can be found again.
 */
import { recordKey, type WireRecord } from './sync-batch'
import { applyRecordsToState, type IncomingRecord, type SyncableState } from './sync-apply'
import { DATA_KINDS, type SyncKind } from './sync-records'

type Row = Record<string, unknown>

const KIND_ORDER = new Map<SyncKind, number>(
  [...DATA_KINDS, 'memory' as const].map((kind, index) => [kind, index])
)

/**
 * The newest version of each record (highest HLC), parents before children
 * (DATA_KINDS order, memories last), so a rebuild never meets a child first.
 */
export function latestVersions(items: IncomingRecord[]): IncomingRecord[] {
  const best = new Map<string, IncomingRecord>()
  for (const item of items) {
    const key = recordKey(item.record.kind, item.record.id)
    const seen = best.get(key)
    if (!seen || item.record.hlc > seen.record.hlc) best.set(key, item)
  }
  const order = (item: IncomingRecord): number =>
    KIND_ORDER.get(item.record.kind) ?? Number.MAX_SAFE_INTEGER
  return [...best.values()].sort((a, b) => order(a) - order(b))
}

/** Device-only fields of a project, kept when the cloud has the same project. */
const DEVICE_PROJECT_FIELDS = ['codePaths', 'activeCodePathIds', 'activeCodePathId'] as const

/** Every syncable top-level collection except projects, rebuilt from nothing. */
const REBUILT = [
  'tasks',
  'sprints',
  'notes',
  'goals',
  'habits',
  'lists',
  'files',
  'financialProfiles',
  'timeBlocks',
  'routines'
] as const

/**
 * The state as the cloud has it: every syncable collection holds exactly the
 * live records given (one version per record, parents first, see
 * latestVersions), and every non-syncable field of `state` passes through.
 */
export function replaceSyncableState<T extends SyncableState>(state: T, records: WireRecord[]): T {
  const live = records.filter((r) => !r.deleted && r.payload && r.kind !== 'memory')
  const cloudProjects = new Set(live.filter((r) => r.kind === 'project').map((r) => r.id))
  const base = structuredClone(state) as unknown as Row
  // A stub per surviving project carries only its device fields; the record
  // fills the rest, and its columns and links come from their own records.
  base.projects = (state.projects as Row[])
    .filter((p) => typeof p.id === 'string' && cloudProjects.has(p.id))
    .map((p) => {
      const stub: Row = { id: p.id, columns: [], links: [] }
      for (const field of DEVICE_PROJECT_FIELDS)
        if (field in p) stub[field] = structuredClone(p[field])
      return stub
    })
  for (const key of REBUILT) base[key] = []
  return applyRecordsToState(base as unknown as T, live)
}
