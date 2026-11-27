import {
  HANDOFF_INTERRUPTED_TAG,
  HANDOFF_RUNNING_TAG,
  isRunningHandoffState,
  selectHandoffOverflow,
  type AiMemory
} from '@sagyou/core/memory'

// The wording of a handoff's state lives here once: the builder writes it
// (terminal-handoff.ts) and the app marks a left-over one interrupted on open.
export const RUNNING_TITLE_PREFIX = '[em andamento] '
export const INTERRUPTED_TITLE_PREFIX = '[interrompida] '
export const RUNNING_STATUS_LINE = 'Status: em andamento'
export const INTERRUPTED_STATUS_LINE = 'Status: interrompida'
export const RUNNING_RESULT_LINE =
  'Resultado: Sessão em andamento; este registro é do último checkpoint.'

/** Said to the agent wherever it learns how to resume a subject. */
export const HANDOFF_STATE_HINT =
  'Handoffs com [em andamento] são de sessões abertas agora (veja list_active_sessions) e os com [interrompida] terminaram sem saída normal.'

const interruptedResultLine = (lastRecord: string): string =>
  `Resultado: A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: ${lastRecord}.`

/**
 * Replaces the last line that is exactly `line`. Whole lines only: an action or a
 * pending task that merely contains the text is written as `- <text>` and is never
 * mistaken for the state line.
 */
function replaceLastLine(text: string, line: string, replacement: string): string {
  const lines = text.split('\n')
  const at = lines.lastIndexOf(line)
  if (at < 0) return text
  lines[at] = replacement
  return lines.join('\n')
}

/**
 * What a running handoff becomes when its session never exited normally. Only
 * the state lines change; the subject, actions, pending tasks, files and the
 * `Referências: run=…` line stay as the last checkpoint left them.
 */
export function markHandoffInterrupted(memory: AiMemory, now: string): AiMemory {
  const title = memory.title.startsWith(RUNNING_TITLE_PREFIX)
    ? INTERRUPTED_TITLE_PREFIX + memory.title.slice(RUNNING_TITLE_PREFIX.length)
    : INTERRUPTED_TITLE_PREFIX + memory.title
  // The request is free text and comes first, so the state lines are matched
  // exactly and from the end: a request that quotes them is left alone.
  const body = replaceLastLine(
    replaceLastLine(memory.body, RUNNING_STATUS_LINE, INTERRUPTED_STATUS_LINE),
    RUNNING_RESULT_LINE,
    interruptedResultLine(memory.updatedAt)
  )
  return {
    ...memory,
    title,
    body,
    tags: memory.tags.map((tag) => (tag === HANDOFF_RUNNING_TAG ? HANDOFF_INTERRUPTED_TAG : tag)),
    updatedAt: now,
    lastAccessedAt: now
  }
}

/** The running handoffs among `memories` (archived ones too), already marked interrupted. */
export function interruptRunningHandoffs(memories: AiMemory[], now: string): AiMemory[] {
  return memories.filter(isRunningHandoffState).map((memory) => markHandoffInterrupted(memory, now))
}

/**
 * What may be versioned for sync. A handoff still marked running belongs to a live
 * session of THIS device: no other device can know whether it is alive, so it never
 * travels (a pin from the memory screen, an archive and the reconcile all go through
 * here). It gets its first version when it leaves that state.
 */
export function syncableMemories(memories: AiMemory[]): AiMemory[] {
  return memories.filter((memory) => !isRunningHandoffState(memory))
}

/**
 * A restored backup (or any wholesale replace) holds no live session: every running
 * handoff in it is marked interrupted. Doing it before the complete capture also
 * stops the capture from tombstoning a handoff whose finished version other devices
 * already have.
 */
export function restoreAsInterrupted(memory: AiMemory, now: string): AiMemory {
  return isRunningHandoffState(memory) ? markHandoffInterrupted(memory, now) : memory
}

export interface HandoffOverflowDeps {
  /** Every active memory. */
  list: () => AiMemory[]
  archive: (ids: string[], now: string) => void
  /** Runs still alive: their running handoff is never archived. */
  live: () => ReadonlySet<string>
  now: () => string
}

/**
 * Archives the handoffs past the newest five of each project and returns their
 * ids. One implementation for the prune pass and for a session's exit.
 */
export function archiveHandoffOverflow(deps: HandoffOverflowDeps): string[] {
  const ids = selectHandoffOverflow(deps.list(), deps.live())
  if (ids.length) deps.archive(ids, deps.now())
  return ids
}
