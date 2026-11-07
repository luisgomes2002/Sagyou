import { EXTERNAL_CUT_MESSAGE, EXTERNAL_LOCKED_WRITE_MESSAGE } from './mcp-external-policy'
import { MCP_LOCKED_MESSAGE } from './sagyou-mcp'

/**
 * What stops an external tools/call right now (spec
 * docs/specs/2026-11-07-endurecer-acesso-remoto.md), in this order:
 * 1. the phone cut the access;
 * 2. the app is locking (the renderer saving on its way to locked);
 * 3. the app is locked: without "Ler com o Sagyou bloqueado" nothing passes;
 *    with it, reads pass and writes are refused (they come back after an unlock).
 * Returns the message the call fails with, or null when it may run.
 */
export function externalRefusal(state: {
  cut: boolean
  locked: boolean
  locking: boolean
  allowWhileLocked: boolean
  kind: 'read' | 'write'
}): string | null {
  if (state.cut) return EXTERNAL_CUT_MESSAGE
  if (state.locking) return MCP_LOCKED_MESSAGE
  if (!state.locked) return null
  if (!state.allowWhileLocked) return MCP_LOCKED_MESSAGE
  return state.kind === 'write' ? EXTERNAL_LOCKED_WRITE_MESSAGE : null
}

/**
 * Whether a data IPC channel may run. Locked, none does: the window that once
 * let the external token's `store:save` through the lock is gone, so no
 * renderer save ever happens on the password screen.
 */
export function dataIpcAllowed(unlocked: boolean, _channel: string): boolean {
  return unlocked
}
