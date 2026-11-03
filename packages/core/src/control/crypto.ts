/**
 * Cryptography of the remote control (spec docs/specs/2026-11-03-controle-remoto-app.md).
 *
 * - Content between the PC and an authorized phone is sealed with a subkey of the
 *   sync key (`controlKey`), XChaCha20-Poly1305, AAD binding sender, recipient and
 *   message id: the Worker can neither read nor redirect a message.
 * - Every request is also signed with Ed25519 by its device's own key, so knowing
 *   the sync key (the work PC, a revoked device) is never enough to control the PC.
 * - The ESP32 has no sync key: its commands carry an HMAC-SHA256 with a key only
 *   the PC and the authorized phones know (`docs/esp32-api.md` is the contract).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { ed25519 } from '@noble/curves/ed25519'
import {
  fromBase64,
  fromBase64Url,
  hkdfSha256,
  hmacSha256Hex,
  randomBytes,
  sha256Bytes,
  toBase64,
  toBase64Url,
  utf8
} from '../sync/bytes'

const KEY_BYTES = 32
const NONCE_BYTES = 24
const CONTROL_INFO = 'sagyou-control-v1'
const PROTOCOL_VERSION = 1

export class ControlDecryptError extends Error {
  constructor() {
    super('control message could not be decrypted')
    this.name = 'ControlDecryptError'
  }
}

export function controlKey(syncKey: Uint8Array): Uint8Array {
  return hkdfSha256(syncKey, CONTROL_INFO, KEY_BYTES)
}

function associatedData(from: string, to: string, msgId: string): Uint8Array {
  return utf8(`sagyou-control|${PROTOCOL_VERSION}|${from}|${to}|${msgId}`)
}

/** Returns base64 of `nonce || ciphertext+tag`. */
export function sealControl(
  key: Uint8Array,
  from: string,
  to: string,
  msgId: string,
  plain: Uint8Array
): string {
  const nonce = randomBytes(NONCE_BYTES)
  const sealed = xchacha20poly1305(key, nonce, associatedData(from, to, msgId)).encrypt(plain)
  const out = new Uint8Array(nonce.length + sealed.length)
  out.set(nonce)
  out.set(sealed, nonce.length)
  return toBase64(out)
}

export function openControl(
  key: Uint8Array,
  from: string,
  to: string,
  msgId: string,
  sealed: string
): Uint8Array {
  let raw: Uint8Array
  try {
    raw = fromBase64(sealed)
  } catch {
    throw new ControlDecryptError()
  }
  if (raw.length <= NONCE_BYTES) throw new ControlDecryptError()
  try {
    return xchacha20poly1305(
      key,
      raw.subarray(0, NONCE_BYTES),
      associatedData(from, to, msgId)
    ).decrypt(raw.subarray(NONCE_BYTES))
  } catch {
    throw new ControlDecryptError()
  }
}

// ── Ed25519 ─────────────────────────────────────────────────────────────────────

export function newSigningKeys(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes(KEY_BYTES)
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey)
}

/** Base64url signature. */
export function signBytes(privateKey: Uint8Array, data: Uint8Array): string {
  return toBase64Url(ed25519.sign(data, privateKey))
}

export function verifyBytes(publicKey: Uint8Array, data: Uint8Array, sig: string): boolean {
  try {
    return ed25519.verify(fromBase64Url(sig), data, publicKey)
  } catch {
    return false
  }
}

/** 6 digits both screens show while authorizing a phone; same for either order. */
export function pairingCode(a: Uint8Array, b: Uint8Array): string {
  const [first, second] = compare(a, b) <= 0 ? [a, b] : [b, a]
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first)
  joined.set(second, first.length)
  const h = sha256Bytes(joined)
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0
  return (n % 1_000_000).toString().padStart(6, '0')
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

// ── ESP32 ───────────────────────────────────────────────────────────────────────

export type PowerCommand = 'wake' | 'shutdown' | 'abort-shutdown'
export type PowerResult = 'ok' | 'mac' | 'old' | 'clock' | 'expired'

export function newEsp32Key(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

export function powerCommandMac(key: Uint8Array, cmd: string, at: number, exp: number): string {
  return hmacSha256Hex(key, `sagyou-power|1|${cmd}|${at}|${exp}`)
}

export function powerStateMac(
  key: Uint8Array,
  pcPing: boolean,
  lastResult: string,
  at: number
): string {
  return hmacSha256Hex(key, `sagyou-power-state|1|${pcPing ? 1 : 0}|${lastResult}|${at}`)
}
