import { MCP_APPROVAL_REQUIRED } from './mcp-write-tools'

/**
 * What a Claude outside the Fleet may do with the external token: everything,
 * with no card (spec docs/specs/2026-11-03-acesso-remoto.md). Kept apart from
 * sagyou-mcp.ts and mcp-external.ts so both can import it without a cycle.
 */

/** The fixed run every external call belongs to: no terminal, no end. */
export const EXTERNAL_RUN_ID = 'external'

/** The legacy writes that always show a card in a Fleet session. */
const LEGACY_CARD_WRITES: ReadonlySet<string> = new Set(['save_memory', 'criar_task'])

/**
 * Whether a queued MCP write waits for an approval card. The external token
 * never does: no run can answer a card for it, and Luis decided on 2026-11-03
 * that it writes everything directly. A Fleet run keeps its cards.
 */
export function externalApproval(runId: string, name: string): boolean {
  if (runId === EXTERNAL_RUN_ID) return false
  return MCP_APPROVAL_REQUIRED.has(name) || LEGACY_CARD_WRITES.has(name)
}

/**
 * Run-owned state (timers stopped at the run's end, the handoff's activity)
 * only exists for Fleet runs: the external token has no end to stop them at.
 */
export function tracksRunState(runId: string): boolean {
  return runId !== EXTERNAL_RUN_ID
}
