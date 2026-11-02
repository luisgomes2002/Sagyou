import { MCP_APPROVAL_REQUIRED } from './mcp-write-tools'

/**
 * What a Claude outside the Fleet may do with the external token (spec
 * docs/specs/2026-11-02-mcp-externo.md). Kept apart from sagyou-mcp.ts and
 * mcp-external.ts so both can import it without a cycle.
 */

/** The fixed run every external call belongs to: no terminal, no end. */
export const EXTERNAL_RUN_ID = 'external'

export const EXTERNAL_EXPIRED_MESSAGE =
  'Token expirado: renove em Configurações → Acesso MCP externo'

export const EXTERNAL_RISKY_MESSAGE =
  'Esta ação exige aprovação: faça pelo Sagyou ou por uma sessão do Fleet'

/**
 * The legacy write that always shows a card in a Fleet session and stays
 * refused here. criar_task is not in it: creating a task is the external
 * token's main use (decided by Luis on 2026-11-02), and it runs without a card.
 */
const LEGACY_CARD_WRITES: ReadonlySet<string> = new Set(['save_memory'])

/** Refused for the external token until the phone can approve them (stage 6). */
export function isExternalRisky(name: string): boolean {
  return MCP_APPROVAL_REQUIRED.has(name) || LEGACY_CARD_WRITES.has(name)
}

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
