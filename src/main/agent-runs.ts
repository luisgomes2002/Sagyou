// Past code-agent runs, kept so a conversation's log and diff can be reopened
// later. No Electron here, so the rules are testable on their own; index.ts owns
// the directory and does the IO.
//
// Two decisions shape this file, and both are load-bearing.
//
// **A run is stored as a frozen snapshot, never as something to recompute.**
// The live diff is derived (`diffSince` measures a pre-spawn base against the
// working tree), which is right *while* the run is the last thing that happened.
// It is wrong the moment the user keeps working: re-running that query tomorrow
// would present their own later edits as things the agent did — exactly the
// confusion `code-diff.ts` exists to prevent. So the diff is computed once, when
// the agent exits, and what is reopened afterwards is that text and nothing else.
// Storing the base commit instead would be smaller and would reintroduce the bug.
//
// **The payload lives in its own file, not in ai-conversations.json.** That file
// is re-read and rewritten whole on every autosave *and* every keystroke of the
// history search; a log (8k) plus a diff (up to 200k) inlined there would drag
// both down permanently — the same reason chat images are files with ids only.
// So: one `<id>.json` per run for the heavy part, and a small `index.json` of
// metadata that the run picker can list without touching any of it.

/** Runs kept per conversation. Older ones are pruned, newest first. */
export const MAX_RUNS_PER_CONV = 20

/** Runs kept overall, as a backstop against many conversations each holding 20. */
export const MAX_RUNS_TOTAL = 100

/** What the picker needs to draw a row. Small on purpose — this is the index. */
export interface AgentRunMeta {
  id: string
  /** The conversation that started the run. Null for a run with no chat behind it. */
  convId: string | null
  /**
   * What ran the agent — the model name for the native agent (e.g. "gpt-4o"),
   * or "codex" for runs archived by the old external-agent path. Free text so
   * the picker can state whichever it was; old rows without it read as "codex".
   */
  agent: string
  dir: string
  /** The task as asked, trimmed for the row's tooltip. */
  task: string
  startedAt: number
  endedAt: number
  exitCode: number
  /** Whether an isolated worktree was delivered back to the original tree. */
  delivery?: 'applied' | 'merge_failed'
  /** Files the diff touched — the one number worth showing before opening it. */
  fileCount: number
  /** Tokens billed across the run (prompt + completion). Absent on old rows and
   *  on runs whose provider reported no usage. */
  tokens?: { promptTokens: number; completionTokens: number; reasoningTokens?: number }
}

/** A run as reopened: the metadata plus the frozen output. */
export interface AgentRunSnapshot extends AgentRunMeta {
  log: string
  /** Serialized DiffResult, exactly as the live panel receives it. */
  diff: unknown
}

/** Longest task string kept on a meta row. It is a label, not a record. */
const MAX_TASK_CHARS = 200

/**
 * Whether `id` is one of ours.
 *
 * The id comes back from the renderer to read a run, so it is a path in
 * disguise: `../../ai-config.json` must not resolve to anything. Same guard,
 * same reason, as `isImageFileName`.
 */
export function isRunId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
}

/** Trim a task down to a label. */
export function taskLabel(task: unknown): string {
  const s = typeof task === 'string' ? task.trim().replace(/\s+/g, ' ') : ''
  return s.length > MAX_TASK_CHARS ? `${s.slice(0, MAX_TASK_CHARS)}…` : s
}

/**
 * Drop rows an unreadable index would otherwise turn into broken picker entries.
 *
 * The file is on disk and hand-editable, and a row missing its id is a row that
 * can never be opened. Same defensive load as `normalizeTemplates`.
 */
export function normalizeRuns(raw: unknown): AgentRunMeta[] {
  if (!Array.isArray(raw)) return []
  const out: AgentRunMeta[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const m = r as Record<string, unknown>
    if (!isRunId(m.id)) continue
    out.push({
      id: m.id,
      convId: typeof m.convId === 'string' && m.convId ? m.convId : null,
      // The model that ran it, preserved; an old row (or a hand-edited one with
      // no agent) reads back as "codex" so the picker always has something to show.
      agent: typeof m.agent === 'string' && m.agent.trim() ? m.agent : 'codex',
      dir: typeof m.dir === 'string' ? m.dir : '',
      task: taskLabel(m.task),
      startedAt: Number(m.startedAt) || 0,
      endedAt: Number(m.endedAt) || 0,
      exitCode: Number.isFinite(Number(m.exitCode)) ? Number(m.exitCode) : 0,
      ...((m.delivery === 'applied' || m.delivery === 'merge_failed') ? { delivery: m.delivery } : {}),
      fileCount: Number(m.fileCount) || 0,
      ...readTokens(m.tokens)
    })
  }
  return out
}

/** Accept a stored `tokens` object only when both fields are finite; otherwise
 *  leave it off (old rows, or a hand-edited file, read back as "unknown"). */
function readTokens(raw: unknown): { tokens?: { promptTokens: number; completionTokens: number; reasoningTokens?: number } } {
  if (!raw || typeof raw !== 'object') return {}
  const t = raw as Record<string, unknown>
  const p = Number(t.promptTokens)
  const c = Number(t.completionTokens)
  if (!Number.isFinite(p) || !Number.isFinite(c)) return {}
  const r = Number(t.reasoningTokens)
  const rt = Number.isFinite(r) ? r : undefined
  return { tokens: { promptTokens: p, completionTokens: c, ...(rt !== undefined ? { reasoningTokens: rt } : {}) } }
}

/** Newest first — the order the picker shows and the order pruning trusts. */
export function sortRuns(runs: AgentRunMeta[]): AgentRunMeta[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * Which runs survive and which are dropped, after adding one.
 *
 * Runs older than 24h are dropped first, then per-conversation cap, then a
 * global backstop. Callers delete the `drop` files — an index that forgets
 * a run without deleting its payload leaks disk for good.
 */
export const RUN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function pruneRuns(
  runs: AgentRunMeta[],
  perConv = MAX_RUNS_PER_CONV,
  total = MAX_RUNS_TOTAL
): { keep: AgentRunMeta[]; drop: AgentRunMeta[] } {
  const sorted = sortRuns(runs)
  const now = Date.now()
  const seen = new Map<string, number>()
  const keep: AgentRunMeta[] = []
  const drop: AgentRunMeta[] = []

  for (const r of sorted) {
    // Drop runs older than 24h first. Skip endedAt=0 (tests, legacy) — no
    // timestamp means no TTL.
    if (r.endedAt > 0 && now - r.endedAt > RUN_TTL_MS) {
      drop.push(r)
      continue
    }
    const key = r.convId ?? '__none__'
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > perConv || keep.length >= total) drop.push(r)
    else keep.push(r)
  }
  return { keep, drop }
}

/** Runs belonging to one conversation, newest first. */
export function runsForConv(runs: AgentRunMeta[], convId: unknown): AgentRunMeta[] {
  if (typeof convId !== 'string' || !convId) return []
  return sortRuns(runs.filter((r) => r.convId === convId))
}

/** How many files a DiffResult touched, tolerant of a shape that isn't one. */
export function diffFileCount(diff: unknown): number {
  if (!diff || typeof diff !== 'object') return 0
  const files = (diff as { files?: unknown }).files
  return Array.isArray(files) ? files.length : 0
}
