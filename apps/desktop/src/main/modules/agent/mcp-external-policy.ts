import { MCP_APPROVAL_REQUIRED } from './mcp-write-tools'

/**
 * What a Claude outside the Fleet may do with the external token: every tool,
 * with a card for the risky writes (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md).
 * Kept apart from sagyou-mcp.ts and mcp-external.ts so both can import it without a cycle.
 */

/** The fixed run every external call belongs to: no terminal, no end. */
export const EXTERNAL_RUN_ID = 'external'

/** The "session" an external card shows, on the PC and on the phone. */
export const EXTERNAL_SESSION_NAME = 'Acesso externo'

/** Every external tools/call while the phone's "Cortar acesso" holds. */
export const EXTERNAL_CUT_MESSAGE = 'Acesso externo cortado pelo celular.'

/** An external write with the Sagyou locked and "Ler com o Sagyou bloqueado" on. */
export const EXTERNAL_LOCKED_WRITE_MESSAGE =
  'O Sagyou está bloqueado: as escritas voltam depois de desbloquear (no PC ou pelo celular, aba PC). Leituras funcionam.'

/** The legacy writes that always show a card in a Fleet session. */
const LEGACY_CARD_WRITES: ReadonlySet<string> = new Set(['save_memory', 'criar_task'])

/**
 * Whether a queued MCP write waits for an approval card. The external token
 * asks exactly for the risky writes (deletes, money, financial tables and
 * profiles, archiving a project), answered on the PC or on the authorized
 * phone. Its save_memory/criar_task carry no more risk than create_task, so
 * only a Fleet run keeps their legacy cards.
 */
export function externalApproval(runId: string, name: string): boolean {
  if (runId === EXTERNAL_RUN_ID) return MCP_APPROVAL_REQUIRED.has(name)
  return MCP_APPROVAL_REQUIRED.has(name) || LEGACY_CARD_WRITES.has(name)
}

/**
 * Run-owned state (timers stopped at the run's end, the handoff's activity)
 * only exists for Fleet runs: the external token has no end to stop them at.
 */
export function tracksRunState(runId: string): boolean {
  return runId !== EXTERNAL_RUN_ID
}
