/**
 * What a Claude outside the Fleet may do with the external token: everything,
 * with no card (spec docs/specs/2026-11-03-acesso-remoto.md). Kept apart from
 * sagyou-mcp.ts and mcp-external.ts so both can import it without a cycle.
 */

/** The fixed run every external call belongs to: no terminal, no end. */
export const EXTERNAL_RUN_ID = 'external'

/** Writes the external token runs without a card (no run can answer one). */
export function externalSkipsCard(runId: string, name: string): boolean {
  return runId === EXTERNAL_RUN_ID && name === 'criar_task'
}

/**
 * Run-owned state (timers stopped at the run's end, the handoff's activity)
 * only exists for Fleet runs: the external token has no end to stop them at.
 */
export function tracksRunState(runId: string): boolean {
  return runId !== EXTERNAL_RUN_ID
}
