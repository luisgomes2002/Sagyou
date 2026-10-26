/**
 * How long an MCP write card waits for the user. The user is often reading
 * the agent's reply in another window when the card appears; at 30 s the
 * card expired before they reached it, while still looking answerable.
 */
export const MCP_APPROVAL_TIMEOUT_MS = 5 * 60_000

/**
 * How long Codex waits for a Sagyou tool call (its own default is 60 s).
 * A write can wait behind an earlier card of its run and then on its own, so this must
 * outlast several approval windows: if Codex gave up first, an approval given
 * afterwards would still write while the model was told the call failed, and a
 * retry would duplicate it. Claude Code and OpenCode already wait for hours.
 */
export const MCP_CLIENT_TOOL_TIMEOUT_SEC = 60 * 60

export interface PendingMcpApproval<R> {
  resolve: (approved: boolean) => void
  request: R
}

/**
 * Parks an MCP approval card until the user answers or the deadline passes.
 * The card carries `expiresAt` so the renderer can count down and disable
 * itself on time: an answer after the deadline would otherwise be dropped
 * silently, since the pending entry is already gone.
 */
export function parkMcpApproval<R extends { id: string; expiresAt?: string }>(
  pending: Map<string, PendingMcpApproval<R>>,
  request: R,
  send: (request: R) => void,
  timeoutMs = MCP_APPROVAL_TIMEOUT_MS
): Promise<boolean> {
  const card: R = { ...request, expiresAt: new Date(Date.now() + timeoutMs).toISOString() }
  return new Promise((resolveApproval) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(card.id)) return
      resolveApproval(false)
    }, timeoutMs)
    pending.set(card.id, {
      resolve: (approved) => {
        clearTimeout(timeout)
        resolveApproval(approved)
      },
      request: card
    })
    send(card)
  })
}
