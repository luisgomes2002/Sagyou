/**
 * What to do with one version received from another device.
 *
 * A received edit is in conflict when its sender did not see this device's
 * current version (`baseHlc !== local.hlc`). Without a conflict, the newer HLC
 * simply wins. With one, the newer HLC still wins on every device alike, and
 * the losing version is kept for 30 days so nothing disappears in silence. A
 * debt is the exception: its remaining amount and linked payments make a
 * silent pick dangerous, so the local version stays and the user chooses.
 */
import type { WireRecord } from './sync-batch'
import { hashPayload, type SyncKind } from './sync-records'

export interface LocalVersion {
  hlc: string
  hash: string
  deleted: boolean
}

/** Where the record's parent stands locally; null when the kind has no parent to wait for. */
export type ParentState = { present: boolean; deleted: boolean } | null

export type Decision =
  | { type: 'apply' }
  | { type: 'skip' }
  | { type: 'apply-and-keep-loser'; loser: 'local' }
  | { type: 'keep-local-and-keep-loser'; loser: 'incoming' }
  | { type: 'pending-choice' }
  | { type: 'wait-parent' }
  | { type: 'orphan-conflict' }

type Payload = Record<string, unknown>
const ref = (kind: SyncKind, id: unknown): { kind: SyncKind; id: string } | null =>
  typeof id === 'string' && id ? { kind, id } : null

/**
 * The record a child cannot exist without, read from the payload as
 * extractDataRecords writes it. Optional links (a goal's project, a time
 * block's task) are not parents: deleting the target only unlinks them.
 */
export const PARENT_OF: Partial<
  Record<SyncKind, (p: Payload) => { kind: SyncKind; id: string } | null>
> = {
  project_column: (p) => ref('project', p.projectId),
  project_link: (p) => ref('project', p.projectId),
  task: (p) => ref('project', p.projectId),
  sprint: (p) => ref('project', p.projectId),
  note: (p) => ref('project', p.projectId),
  goal_entry: (p) => ref('goal', p.goalId),
  habit_completion: (p) => ref('habit', p.habitId),
  financial_debt: (p) => ref('financial_table', p.tableId),
  transaction: (p) => ref('financial_table', p.tableId),
  shopping_item: (p) => ref('financial_table', p.tableId),
  financial_goal: (p) => ref('financial_table', p.tableId),
  yield_source: (p) => ref('financial_table', p.tableId),
  yield_entry: (p) => ref('financial_table', p.tableId),
  file: (p) => ref('project', p.projectId)
}

export function parentOf(record: WireRecord): { kind: SyncKind; id: string } | null {
  if (record.deleted || !record.payload) return null
  return PARENT_OF[record.kind]?.(record.payload) ?? null
}

export function decideIncoming(
  incoming: WireRecord,
  local: LocalVersion | null,
  parent: ParentState
): Decision {
  if (local && local.hlc === incoming.hlc) return { type: 'skip' }

  if (!incoming.deleted && parent) {
    if (parent.deleted) return { type: 'orphan-conflict' }
    if (!parent.present) return { type: 'wait-parent' }
  }

  if (!local) return { type: 'apply' }

  const incomingHash = incoming.payload ? hashPayload(incoming.payload) : ''
  if (incoming.deleted === local.deleted && (incoming.deleted || incomingHash === local.hash)) {
    return { type: 'skip' }
  }

  const newer = incoming.hlc > local.hlc
  if (incoming.baseHlc === local.hlc) return newer ? { type: 'apply' } : { type: 'skip' }

  if (incoming.kind === 'financial_debt') return { type: 'pending-choice' }
  return newer
    ? { type: 'apply-and-keep-loser', loser: 'local' }
    : { type: 'keep-local-and-keep-loser', loser: 'incoming' }
}
