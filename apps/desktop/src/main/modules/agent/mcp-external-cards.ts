import { randomUUID } from 'crypto'
import type { PendingMcpApproval } from './mcp-approval'
import { EXTERNAL_RUN_ID, EXTERNAL_SESSION_NAME } from './mcp-external-policy'

/**
 * Approval cards of the external token (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md,
 * item 1). The token has no Fleet run whose `pendingApprovals` could hold them,
 * so they live here, parked through the same `createRemoteCards` the Fleet
 * uses: the card opens a dialog on the PC and reaches the authorized phone, the
 * first answer wins, and whatever closes it tells both screens.
 */
export interface ExternalCard {
  runId: string
  id: string
  /** `mcp:<tool>`, like a Fleet card. */
  name: string
  args: Record<string, unknown>
  resumo: string
  expiresAt?: string
}

type Park = (
  pending: Map<string, PendingMcpApproval<ExternalCard>>,
  request: ExternalCard,
  toRenderer: (card: ExternalCard) => void,
  session: string
) => Promise<boolean>

export interface ExternalCards {
  /** Read by `createRemoteCards.answer` (with the Fleet runs' maps). */
  pending: Map<string, PendingMcpApproval<ExternalCard>>
  request(name: string, args: Record<string, unknown>, resumo: string): Promise<boolean>
  /** Refuses every pending card: lock, cut access, a new or revoked token. */
  denyAll(): void
  count(): number
}

export function createExternalCards(deps: {
  park: Park
  send: (channel: string, payload: unknown) => void
}): ExternalCards {
  const pending = new Map<string, PendingMcpApproval<ExternalCard>>()
  return {
    pending,
    request: (name, args, resumo) =>
      deps.park(
        pending,
        { runId: EXTERNAL_RUN_ID, id: randomUUID(), name: `mcp:${name}`, args, resumo },
        (card) => deps.send('mcp-external:approve-request', card),
        EXTERNAL_SESSION_NAME
      ),
    denyAll: () => {
      const entries = [...pending.values()]
      pending.clear()
      for (const { resolve } of entries) resolve(false)
    },
    count: () => pending.size
  }
}
