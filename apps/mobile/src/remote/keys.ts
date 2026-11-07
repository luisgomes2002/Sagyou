import { newSigningKeys } from '@sagyou/core/control/crypto'
import { signEnvelope, type ControlKind, type SignedEnvelope } from '@sagyou/core/control/messages'
import { fromBase64, toBase64 } from '@sagyou/core/sync/bytes'

/**
 * This phone's remote-control keys (spec docs/specs/2026-11-03-controle-remoto-app.md).
 *
 * - The Ed25519 private key is stored with `requireAuthentication`: reading it
 *   asks for the biometrics (or the screen lock). Every request to the PC is
 *   signed with it; the sync key alone is never enough to control the PC.
 * - The PC's public key, the ESP32 key and the authorization state are stored
 *   without biometrics (the PC key is public; the ESP32 key only signs power
 *   commands, which the app gates with the biometrics itself).
 * Never in SQLite, prefs, a persisted store or a log.
 */

export interface SecureOptions {
  requireAuthentication?: boolean
  authenticationPrompt?: string
}

/** The slice of expo-secure-store used here (Android Keystore). */
export interface ControlSecureStore {
  getItemAsync(key: string, options?: SecureOptions): Promise<string | null>
  setItemAsync(key: string, value: string, options?: SecureOptions): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

export const KEY_PRIVATE = 'sagyou.control.private'
export const KEY_PUBLIC = 'sagyou.control.public'
export const KEY_PCPUB = 'sagyou.control.pcpub'
export const KEY_ESP32 = 'sagyou.control.esp32'
export const KEY_STATE = 'sagyou.control.state'
/** Every entry a wipe or "Remover este celular" deletes. */
export const CONTROL_SECURE_KEYS = [KEY_PRIVATE, KEY_PUBLIC, KEY_PCPUB, KEY_ESP32, KEY_STATE]

const AUTH: SecureOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Confirme para controlar o PC'
}

export type AuthorizationState = 'none' | 'pending' | 'waiting-pc' | 'yes'
const STATES: AuthorizationState[] = ['none', 'pending', 'waiting-pc', 'yes']

/** The Keystore key behind the private key is gone (the biometrics changed). */
export class KeyInvalidatedError extends Error {
  constructor() {
    super('control key invalidated')
    this.name = 'KeyInvalidatedError'
  }
}

/** The user closed the biometric prompt. */
export class KeyCancelledError extends Error {
  constructor() {
    super('authentication cancelled')
    this.name = 'KeyCancelledError'
  }
}

function classify(error: unknown): Error {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/invalidat/i.test(text)) return new KeyInvalidatedError()
  if (/cancel/i.test(text)) return new KeyCancelledError()
  return error instanceof Error ? error : new Error(text)
}

function key32(value: string | null): Uint8Array | null {
  if (!value) return null
  try {
    const bytes = fromBase64(value)
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

export interface FreshKeys {
  publicKey: Uint8Array
  /** Signs with the new key while it is still in memory (no second prompt). */
  sign(kind: ControlKind, body: Record<string, unknown>, ttlMs?: number): SignedEnvelope
}

export interface ControllerKeys {
  /** A new pair (asks for the biometrics to store it). Replaces any older one. */
  renew(): Promise<FreshKeys>
  publicKey(): Promise<Uint8Array | null>
  /** Reads the private key (the biometric prompt appears here) and signs. */
  sign(kind: ControlKind, body: Record<string, unknown>, ttlMs?: number): Promise<SignedEnvelope>
  pcPublicKey(): Promise<Uint8Array | null>
  setPcPublicKey(key: Uint8Array): Promise<void>
  esp32Key(): Promise<Uint8Array | null>
  setEsp32Key(key: Uint8Array): Promise<void>
  state(): Promise<AuthorizationState>
  setState(state: AuthorizationState): Promise<void>
  clear(): Promise<void>
}

export function createControllerKeys(
  secure: ControlSecureStore,
  now: () => number = Date.now
): ControllerKeys {
  const read = async (key: string): Promise<Uint8Array | null> =>
    key32(await secure.getItemAsync(key))

  return {
    async renew() {
      const { privateKey, publicKey } = newSigningKeys()
      try {
        await secure.setItemAsync(KEY_PRIVATE, toBase64(privateKey), AUTH)
      } catch (error) {
        throw classify(error)
      }
      await secure.setItemAsync(KEY_PUBLIC, toBase64(publicKey))
      // A new pair starts a new authorization: the old PC and ESP32 keys belong to the old one.
      for (const key of [KEY_PCPUB, KEY_ESP32]) {
        try {
          await secure.deleteItemAsync(key)
        } catch {
          // A missing entry is already what we want.
        }
      }
      return {
        publicKey,
        sign: (kind, body, ttlMs) => signEnvelope(privateKey, kind, body, now(), ttlMs)
      }
    },

    publicKey: () => read(KEY_PUBLIC),

    async sign(kind, body, ttlMs) {
      let raw: string | null
      try {
        raw = await secure.getItemAsync(KEY_PRIVATE, AUTH)
      } catch (error) {
        throw classify(error)
      }
      const privateKey = key32(raw)
      if (!privateKey) throw new KeyInvalidatedError()
      return signEnvelope(privateKey, kind, body, now(), ttlMs)
    },

    pcPublicKey: () => read(KEY_PCPUB),
    setPcPublicKey: (key) => secure.setItemAsync(KEY_PCPUB, toBase64(key)),
    esp32Key: () => read(KEY_ESP32),
    setEsp32Key: (key) => secure.setItemAsync(KEY_ESP32, toBase64(key)),

    async state() {
      const raw = await secure.getItemAsync(KEY_STATE)
      return STATES.includes(raw as AuthorizationState) ? (raw as AuthorizationState) : 'none'
    },
    setState: (state) => secure.setItemAsync(KEY_STATE, state),

    async clear() {
      for (const key of CONTROL_SECURE_KEYS) {
        try {
          await secure.deleteItemAsync(key)
        } catch {
          // A missing entry is already what we want.
        }
      }
    }
  }
}
