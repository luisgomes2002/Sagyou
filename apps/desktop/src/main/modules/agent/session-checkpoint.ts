import { handoffId, scrubSecrets, type AiMemory } from '../ai/memory'
import { buildTerminalHandoff, type TerminalHandoffInput } from './terminal-handoff'

/** At most one write per run in this window; a later one is scheduled, not dropped. */
export const CHECKPOINT_MIN_GAP_MS = 15_000
/** While a run lives its handoff is refreshed this often, when anything changed. */
export const CHECKPOINT_TICK_MS = 120_000

const ACTION_LIMIT = 12
const FILE_LIMIT = 20
const SUBJECT_LIMIT = 160
const ITEM_LIMIT = 200
const PATH_LIMIT = 180

/**
 * What another session is shown. The handoff row is cleaned by buildMemory; this is
 * the same cleaning for the snapshot, which would otherwise serve the raw text: no
 * secret, no line breaks (a subject could not forge a heading), bounded.
 */
export function cleanSnapshotText(value: string, limit: number): string {
  return scrubSecrets(value).text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/** What `list_active_sessions` shows of a live session: its last checkpoint. */
export interface CheckpointSnapshot {
  runId: string
  projectId: string | null
  startedAt: number
  /** When the handoff row was last written (ms). */
  updatedAt: number
  subject?: string
  actions: string[]
  files: string[]
}

export interface SessionCheckpointDeps {
  now: () => number
  /** The run as it is now; null when it no longer exists. `input.request` is the request's source. */
  read: (runId: string) => Promise<{
    projectId: string | null
    startedAt: number
    input: Omit<TerminalHandoffInput, 'runId' | 'projectId' | 'status' | 'result'>
  } | null>
  /** The handoff row of this run, to keep its pin, creation, access count and archive. */
  getMemory: (id: string) => AiMemory | null
  /** Writes locally, WITHOUT a sync version: a running handoff never travels. */
  write: (memory: AiMemory) => void
  onError: (runId: string, error: unknown) => void
}

interface RunState {
  stopped: boolean
  busy: boolean
  again: boolean
  force: boolean
  lastAttemptAt: number
  lastText: string | null
  trailing: ReturnType<typeof setTimeout> | null
  tick: ReturnType<typeof setInterval> | null
  snapshot: CheckpointSnapshot | null
}

/**
 * Keeps a running handoff per terminal session, so a crash, a freeze or a power
 * cut still leaves where the session was. Refreshed on every applied MCP write
 * (at most once per 15 s) and every 2 minutes, only when the text changed. After
 * `stop` nothing is written, even by a read still in flight: the exit writes the
 * final state and a late checkpoint must never put "em andamento" back over it.
 */
export function createSessionCheckpoints(deps: SessionCheckpointDeps): {
  start: (runId: string) => void
  touch: (runId: string) => void
  stop: (runId: string) => void
  resetAll: () => void
  snapshot: (runId: string) => CheckpointSnapshot | null
  live: () => CheckpointSnapshot[]
} {
  const states = new Map<string, RunState>()

  function halt(runId: string, state: RunState): void {
    state.stopped = true
    if (state.trailing) clearTimeout(state.trailing)
    if (state.tick) clearInterval(state.tick)
    state.trailing = null
    state.tick = null
    if (states.get(runId) === state) states.delete(runId)
  }

  async function checkpoint(runId: string, state: RunState): Promise<void> {
    if (state.stopped) return
    if (state.busy) {
      state.again = true
      return
    }
    state.busy = true
    try {
      do {
        state.again = false
        state.lastAttemptAt = deps.now()
        const data = await deps.read(runId)
        if (state.stopped) return
        if (!data) {
          halt(runId, state)
          return
        }
        const id = handoffId(data.projectId, runId)
        const at = deps.now()
        const memory = buildTerminalHandoff(
          { ...data.input, runId, projectId: data.projectId, status: 'running', result: '' },
          new Date(at).toISOString(),
          deps.getMemory(id)
        )
        const text = `${memory.title}\n${memory.tags.join(',')}\n${memory.body}`
        const wrote = state.force || text !== state.lastText
        if (wrote) {
          deps.write(memory)
          state.lastText = text
        }
        state.force = false
        state.snapshot = {
          runId,
          projectId: data.projectId,
          startedAt: data.startedAt,
          updatedAt: wrote || !state.snapshot ? at : state.snapshot.updatedAt,
          ...(data.input.subject
            ? { subject: cleanSnapshotText(data.input.subject, SUBJECT_LIMIT) }
            : {}),
          actions: (data.input.actions ?? [])
            .slice(0, ACTION_LIMIT)
            .map((action) => cleanSnapshotText(action, ITEM_LIMIT)),
          files: data.input.changedFiles
            .slice(0, FILE_LIMIT)
            .map((file) => cleanSnapshotText(file, PATH_LIMIT))
        }
      } while (state.again && !state.stopped)
    } catch (error) {
      if (!state.stopped) deps.onError(runId, error)
    } finally {
      state.busy = false
    }
  }

  return {
    start(runId) {
      if (states.has(runId)) return
      const state: RunState = {
        stopped: false,
        busy: false,
        again: false,
        force: false,
        lastAttemptAt: 0,
        lastText: null,
        trailing: null,
        tick: null,
        snapshot: null
      }
      states.set(runId, state)
      state.tick = setInterval(() => void checkpoint(runId, state), CHECKPOINT_TICK_MS)
      void checkpoint(runId, state)
    },

    touch(runId) {
      const state = states.get(runId)
      if (!state || state.stopped || state.trailing) return
      const wait = state.lastAttemptAt + CHECKPOINT_MIN_GAP_MS - deps.now()
      if (wait <= 0) {
        void checkpoint(runId, state)
        return
      }
      state.trailing = setTimeout(() => {
        state.trailing = null
        void checkpoint(runId, state)
      }, wait)
    },

    stop(runId) {
      const state = states.get(runId)
      if (state) halt(runId, state)
    },

    resetAll() {
      for (const [runId, state] of states) {
        state.lastText = null
        state.force = true
        void checkpoint(runId, state)
      }
    },

    snapshot: (runId) => states.get(runId)?.snapshot ?? null,

    live: () => [...states.values()].flatMap((state) => (state.snapshot ? [state.snapshot] : []))
  }
}
