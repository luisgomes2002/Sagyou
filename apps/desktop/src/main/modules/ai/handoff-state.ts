import {
  HANDOFF_INTERRUPTED_TAG,
  HANDOFF_RUNNING_TAG,
  isRunningHandoff,
  selectHandoffOverflow,
  type AiMemory
} from './memory'

// The wording of a handoff's state lives here once: the builder writes it
// (terminal-handoff.ts) and the app marks a left-over one interrupted on open.
export const RUNNING_TITLE_PREFIX = '[em andamento] '
export const INTERRUPTED_TITLE_PREFIX = '[interrompida] '
export const RUNNING_STATUS_LINE = 'Status: em andamento'
export const INTERRUPTED_STATUS_LINE = 'Status: interrompida'
export const RUNNING_RESULT_LINE =
  'Resultado: Sessão em andamento; este registro é do último checkpoint.'

const interruptedResultLine = (lastRecord: string): string =>
  `Resultado: A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: ${lastRecord}.`

function replaceLast(text: string, search: string, replacement: string): string {
  const at = text.lastIndexOf(search)
  return at < 0 ? text : text.slice(0, at) + replacement + text.slice(at + search.length)
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
  const body = replaceLast(
    replaceLast(memory.body, RUNNING_STATUS_LINE, INTERRUPTED_STATUS_LINE),
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

/** The running handoffs among `memories`, already marked interrupted. */
export function interruptRunningHandoffs(memories: AiMemory[], now: string): AiMemory[] {
  return memories.filter(isRunningHandoff).map((memory) => markHandoffInterrupted(memory, now))
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
