import type { McpActionResult, McpScope } from './mcp-write-types'

/** Writes that end a timer the run started, so the run no longer owns it. */
const RELEASES_TIMER = new Set(['stop_task_timer', 'complete_task', 'delete_task'])
/** Ended run ids kept to catch a start that lands after the end; bounded. */
const ENDED_RUNS_KEPT = 200

export type RunTimerStopOutcome = 'ok' | 'refused' | 'error'

/**
 * Task timers each agent run created through MCP, keyed by the instant they
 * started. When the run ends (Stop, crash, terminal closed, app quit) the ones
 * still running are stopped so a timer the agent forgot never keeps counting.
 * Ownership is the start instant: a timer that was already running (started by
 * the user) is never owned, and one the user stopped and restarted no longer
 * matches, so `stop` is told the instant and must leave any other timer alone.
 */
export function createRunTaskTimers(
  stop: (taskId: string, startedAt: number, scope: McpScope) => Promise<unknown>,
  onStopped?: (event: { runId: string; taskId: string; outcome: RunTimerStopOutcome }) => void
): {
  record: (runId: string, scope: McpScope, tool: string, result: McpActionResult) => void
  stopAll: (runId: string) => Promise<void>
  stopEverything: () => Promise<void>
  hasRunning: () => boolean
} {
  const runs = new Map<string, { scope: McpScope; timers: Map<string, number> }>()
  const ended = new Set<string>()

  const stopOne = async (
    runId: string,
    taskId: string,
    startedAt: number,
    scope: McpScope
  ): Promise<void> => {
    let outcome: RunTimerStopOutcome = 'ok'
    try {
      const result = (await stop(taskId, startedAt, scope)) as { ok?: unknown } | undefined
      if (result && result.ok === false) outcome = 'refused'
    } catch {
      outcome = 'error'
    }
    onStopped?.({ runId, taskId, outcome })
  }

  const record = (runId: string, scope: McpScope, tool: string, result: McpActionResult): void => {
    if (!result.ok) return
    if (tool === 'start_task_timer') {
      // Only a timer this call created carries startedAt (not one already running).
      if (typeof result.startedAt !== 'number') return
      if (ended.has(runId)) {
        void stopOne(runId, result.id, result.startedAt, scope)
        return
      }
      const run = runs.get(runId) ?? { scope, timers: new Map<string, number>() }
      run.timers.set(result.id, result.startedAt)
      runs.set(runId, run)
    } else if (RELEASES_TIMER.has(tool)) runs.get(runId)?.timers.delete(result.id)
  }

  const stopAll = async (runId: string): Promise<void> => {
    ended.add(runId)
    if (ended.size > ENDED_RUNS_KEPT) ended.delete(ended.values().next().value as string)
    const run = runs.get(runId)
    runs.delete(runId)
    if (!run) return
    // In parallel, and a failed stop (renderer gone, timeout) never blocks the others.
    await Promise.allSettled(
      [...run.timers].map(([taskId, startedAt]) => stopOne(runId, taskId, startedAt, run.scope))
    )
  }

  const stopEverything = async (): Promise<void> => {
    await Promise.allSettled([...runs.keys()].map((runId) => stopAll(runId)))
  }

  const hasRunning = (): boolean => [...runs.values()].some((run) => run.timers.size > 0)

  return { record, stopAll, stopEverything, hasRunning }
}
