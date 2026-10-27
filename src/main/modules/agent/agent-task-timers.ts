import type { McpActionResult, McpScope } from './mcp-write-types'

/** Writes that end a timer the run started, so the run no longer owns it. */
const RELEASES_TIMER = new Set(['stop_task_timer', 'complete_task', 'delete_task'])

/**
 * Task timers each agent run started through MCP. When the run ends (Stop,
 * crash, terminal closed) the ones still running are stopped, so a timer the
 * agent forgot never keeps counting. Timers the user started are never touched.
 */
export function createRunTaskTimers(stop: (taskId: string, scope: McpScope) => Promise<unknown>): {
  record: (runId: string, scope: McpScope, tool: string, result: McpActionResult) => void
  stopAll: (runId: string) => Promise<void>
} {
  const runs = new Map<string, { scope: McpScope; taskIds: Set<string> }>()

  const record = (runId: string, scope: McpScope, tool: string, result: McpActionResult): void => {
    if (!result.ok) return
    if (tool === 'start_task_timer') {
      const run = runs.get(runId) ?? { scope, taskIds: new Set<string>() }
      run.taskIds.add(result.id)
      runs.set(runId, run)
    } else if (RELEASES_TIMER.has(tool)) runs.get(runId)?.taskIds.delete(result.id)
  }

  const stopAll = async (runId: string): Promise<void> => {
    const run = runs.get(runId)
    runs.delete(runId)
    if (!run) return
    // In parallel, and a failed stop (renderer gone, timeout) never blocks the others.
    await Promise.allSettled([...run.taskIds].map((taskId) => stop(taskId, run.scope)))
  }

  return { record, stopAll }
}
