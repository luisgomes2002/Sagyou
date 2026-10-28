/** One MCP write a run applied, as the approval card described it. */
export interface RunActivityEntry {
  name: string
  resumo: string
  /** The record the write touched, when the tool returns it (tasks, memories). */
  id?: string
  /** Title of a `decisao` memory the run saved: an explicit decision, never an inference. */
  decision?: string
}

export interface RunActivitySummary {
  subject?: string
  actions: string[]
  decisions: string[]
  pending: string[]
}

const ENTRY_LIMIT = 40
const ACTION_LIMIT = 12

/**
 * What each run did through the MCP, kept in memory until the terminal exits
 * and its handoff is written. Bounded, so a looping agent cannot grow it.
 */
export function createRunActivity(): {
  record: (runId: string, entry: RunActivityEntry) => void
  take: (runId: string) => RunActivityEntry[]
} {
  const runs = new Map<string, RunActivityEntry[]>()
  return {
    record: (runId, entry) => {
      const entries = runs.get(runId) ?? []
      if (entries.length >= ENTRY_LIMIT) return
      entries.push(entry)
      runs.set(runId, entries)
    },
    take: (runId) => {
      const entries = runs.get(runId) ?? []
      runs.delete(runId)
      return entries
    }
  }
}

/**
 * Handoff sources from applied writes only. A task is pending when the run
 * started its timer and did not complete it afterwards.
 */
export function summarizeRunActivity(entries: RunActivityEntry[]): RunActivitySummary {
  const pending = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.id) continue
    if (entry.name === 'start_task_timer') pending.set(entry.id, entry.resumo)
    else if (entry.name === 'complete_task') pending.delete(entry.id)
  }
  return {
    ...(entries.length ? { subject: entries[0].resumo } : {}),
    actions: entries.slice(0, ACTION_LIMIT).map((entry) => entry.resumo),
    decisions: entries.flatMap((entry) => (entry.decision ? [entry.decision] : [])),
    pending: [...pending.values()]
  }
}
