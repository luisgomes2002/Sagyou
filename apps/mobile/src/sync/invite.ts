import { SyncUserError } from '@sagyou/core/sync/engine'
import * as Clipboard from 'expo-clipboard'

export const UNEXPECTED_ERROR_TEXT = 'Não foi possível gerar o código.'

/** What the "Parear outro aparelho" screen shows. */
export type InviteState =
  // Waiting for the authenticator code (spec 2026-11-07, item 6); `error` is
  // the last attempt's message, shown on the field.
  | { kind: 'factor'; error?: string }
  | { kind: 'loading' }
  | { kind: 'ready'; code: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

/** "M:SS" until `expiresAt`; never negative. */
export function countdownText(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const minutes = Math.floor(left / 60)
  const seconds = String(left % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/**
 * Asks the engine for a one-time pairing code. Never throws: the engine turns
 * every failure (offline included) into a SyncUserError, whose message is
 * shown as is; anything else gets the generic text.
 */
export async function fetchInvite(
  engine: {
    createInvite(factor: { totp: string }): Promise<{ code: string; expiresAt: number }>
  },
  // The authenticator code or a backup code (spec 2026-11-07, item 6).
  totp = ''
): Promise<InviteState> {
  try {
    const { code, expiresAt } = await engine.createInvite({ totp })
    return { kind: 'ready', code, expiresAt }
  } catch (cause) {
    return {
      kind: 'error',
      message:
        cause instanceof SyncUserError && cause.message ? cause.message : UNEXPECTED_ERROR_TEXT
    }
  }
}

/**
 * The pairing code carries the sync key: once the screen closes, locks or the
 * code expires, it must not stay in the system clipboard (the keyboard and
 * its history read it). Clears it only if it still holds this code, so
 * something the user copied afterwards is left alone. Best effort, never throws.
 */
export async function forgetCopiedCode(code: string | null): Promise<void> {
  if (!code) return
  try {
    if ((await Clipboard.getStringAsync()) === code) await Clipboard.setStringAsync('')
  } catch {
    // Nothing else to do: the clipboard is the system's.
  }
}
