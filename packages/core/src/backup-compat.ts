import { scrubConversationLinks } from './memory'
import { migrateYieldSummaryDates } from './yieldSummary'
import type { AiMemory, Backup, FinancialTable, Project } from './types'

// Everything an OLD backup file can carry that the current model no longer has lives here, and
// only the import of a backup calls it. The live paths (loading the database, sync, the phone)
// see the current model only. The validator still accepts versions 1 to 7, so this is the one
// place to read when a new rule makes an old shape unreadable.
//
// Money is not here on purpose: `normalizeFinancialTable` turns every amount into a canonical
// decimal string (number or text), and that is the current rule, not a legacy one.

/** Pure, idempotent and free of Node; it never mutates its input. */
export function upgradeLegacyBackup(backup: Backup): Backup {
  const out: Backup = { ...backup }
  // The chat history was removed: nothing reads these two, and the bytes never reach the renderer.
  delete out.conversations
  delete out.chatImages
  if (Array.isArray(backup.projects)) out.projects = backup.projects.map(upgradeProject)
  if (Array.isArray(backup.lists)) out.lists = backup.lists.map(upgradeFinancialTable)
  if (Array.isArray(backup.memories)) out.memories = backup.memories.map(upgradeMemory)
  return out
}

/** The chat is gone: a memory loses its link to a conversation and the text that pointed at it. */
function upgradeMemory(memory: AiMemory): AiMemory {
  const { sourceConversationId: _gone, ...rest } = memory as AiMemory & {
    sourceConversationId?: unknown
  }
  void _gone
  // Runs on raw file data, before the store normalizes it: only a text body can be scrubbed.
  if (typeof rest.body !== 'string') return rest as AiMemory
  return scrubConversationLinks([rest as AiMemory]).memories[0]
}

/** The single `activeCodePathId` of before multi-select becomes the list, and is dropped. */
function upgradeProject(project: Project): Project {
  const { activeCodePathId, ...rest } = project
  if (Array.isArray(rest.activeCodePathIds) || !activeCodePathId) return rest
  return { ...rest, activeCodePathIds: [activeCodePathId] }
}

/**
 * Budgets and recurring transactions were an unfinished feature that no longer exists; their
 * values and the hidden `legacyFinancialMetadata` copy are dropped. A month-end yield summary
 * moves to the first day (and the edit is recorded in the transaction's audit).
 */
function upgradeFinancialTable(table: FinancialTable): FinancialTable {
  const {
    budgets: _budgets,
    recurringTransactions: _recurring,
    legacyFinancialMetadata: _legacy,
    ...rest
  } = table as FinancialTable & {
    budgets?: unknown
    recurringTransactions?: unknown
    legacyFinancialMetadata?: unknown
  }
  void _budgets
  void _recurring
  void _legacy
  return migrateYieldSummaryDates(rest as FinancialTable)
}
