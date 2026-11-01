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
const TITLE_LIMIT = 80

/**
 * Finance stays in its captured profile, but a handoff is a memory any session
 * can read. Their card text (amount, table, profile name) never goes into it.
 */
const FINANCIAL_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'create_financial_table',
  'add_financial_category',
  'remove_financial_category',
  'create_financial_profile',
  'rename_financial_profile'
])

/**
 * The entry a write leaves in its run, or null when it did not succeed.
 * `cardResumo` is the approval card's default text, for tools that prepare none.
 */
export function runActivityEntry(
  request: { name: string; args: Record<string, unknown>; resumo?: string },
  value: unknown,
  cardResumo: () => string
): RunActivityEntry | null {
  const result = value as { ok?: unknown; id?: unknown } | null
  if (!result || result.ok !== true) return null
  if (FINANCIAL_WRITE_TOOLS.has(request.name))
    return { name: request.name, resumo: `Escrita financeira (${request.name}); confira no Sagyou` }
  const title = String(request.args.titulo ?? '').trim()
  const isMemory = request.name === 'save_memory'
  return {
    name: request.name,
    resumo:
      request.resumo ??
      (isMemory
        ? `Salvar memória ${String(request.args.tipo ?? '')} "${title.slice(0, TITLE_LIMIT)}"`
        : cardResumo()),
    ...(typeof result.id === 'string' ? { id: result.id } : {}),
    ...(isMemory && request.args.tipo === 'decisao' && title ? { decision: title } : {})
  }
}
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
