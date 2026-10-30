/**
 * End-to-end encryption for sync batches.
 *
 * One random 256-bit sync key, created on the first device and never derived
 * from the app password, is the root of everything. HKDF splits it into `enc`
 * (seals batches with XChaCha20-Poly1305, a fresh 24-byte nonce each time) and
 * `id` (turns the local device id into the opaque id the server sees). The
 * associated data binds a batch to its sender and batch id, so the server can
 * neither move a batch to another device nor replay it under another id.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { createHash, createHmac, hkdfSync, randomBytes } from 'crypto'

const NONCE_BYTES = 24
const KEY_BYTES = 32
const ENC_INFO = 'sagyou-sync-enc-v1'
const ID_INFO = 'sagyou-sync-id-v1'
const PROTOCOL_VERSION = 1

export class SyncDecryptError extends Error {
  constructor() {
    super('sync batch could not be decrypted')
    this.name = 'SyncDecryptError'
  }
}

export function newSyncKey(): Uint8Array {
  return new Uint8Array(randomBytes(KEY_BYTES))
}

export function deriveKeys(syncKey: Uint8Array): { enc: Uint8Array; id: Uint8Array } {
  const derive = (info: string): Uint8Array =>
    new Uint8Array(hkdfSync('sha256', syncKey, new Uint8Array(0), info, KEY_BYTES))
  return { enc: derive(ENC_INFO), id: derive(ID_INFO) }
}

export function opaqueDeviceId(idKey: Uint8Array, deviceId: string): string {
  return createHmac('sha256', idKey).update(deviceId).digest('hex').slice(0, 32)
}

function associatedData(opaqueId: string, batchId: string): Uint8Array {
  return new TextEncoder().encode(`sagyou-sync|${PROTOCOL_VERSION}|${opaqueId}|${batchId}`)
}

/** Returns base64 of `nonce || ciphertext+tag`. */
export function sealBatch(
  encKey: Uint8Array,
  opaqueId: string,
  batchId: string,
  plain: Uint8Array
): string {
  const nonce = new Uint8Array(randomBytes(NONCE_BYTES))
  const sealed = xchacha20poly1305(encKey, nonce, associatedData(opaqueId, batchId)).encrypt(plain)
  return Buffer.concat([nonce, sealed]).toString('base64')
}

export function openBatch(
  encKey: Uint8Array,
  opaqueId: string,
  batchId: string,
  sealed: string
): Uint8Array {
  const raw = new Uint8Array(Buffer.from(sealed, 'base64'))
  if (raw.length <= NONCE_BYTES) throw new SyncDecryptError()
  try {
    return xchacha20poly1305(
      encKey,
      raw.subarray(0, NONCE_BYTES),
      associatedData(opaqueId, batchId)
    ).decrypt(raw.subarray(NONCE_BYTES))
  } catch {
    throw new SyncDecryptError()
  }
}

// ── Recovery code ─────────────────────────────────────────────────────────────
// RFC 4648 base32 without padding: the key is 52 characters, a 2-byte SHA-256
// checksum of the key adds 4 more, printed as 14 groups of 4 on one line with
// the server URL on the next.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const KEY_CHARS = 52
const CHECKSUM_CHARS = 4

function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(text: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength)
  let bits = 0
  let value = 0
  let index = 0
  for (const char of text) {
    const digit = BASE32.indexOf(char)
    if (digit < 0) throw new Error('invalid recovery code character')
    value = ((value << 5) | digit) & 0xffff
    bits += 5
    if (bits >= 8) {
      if (index < byteLength) out[index] = (value >>> (bits - 8)) & 0xff
      index++
      bits -= 8
    }
  }
  if (index !== byteLength) throw new Error('invalid recovery code length')
  return out
}

function checksum(key: Uint8Array): string {
  return base32(createHash('sha256').update(key).digest().subarray(0, 2)).slice(0, CHECKSUM_CHARS)
}

export function toRecoveryCode(key: Uint8Array, url: string): string {
  const chars = base32(key) + checksum(key)
  const groups = chars.match(/.{4}/g) ?? []
  return `${groups.join('-')}\n${url}`
}

export function fromRecoveryCode(text: string): { key: Uint8Array; url: string } {
  const [line = '', ...rest] = text.trim().split(/\r?\n/)
  const chars = line.toUpperCase().replace(/[\s-]/g, '')
  if (chars.length !== KEY_CHARS + CHECKSUM_CHARS) throw new Error('invalid recovery code length')
  const key = fromBase32(chars.slice(0, KEY_CHARS), KEY_BYTES)
  if (checksum(key) !== chars.slice(KEY_CHARS)) throw new Error('invalid recovery code checksum')
  const url = rest.join('').trim()
  if (!/^https:\/\/\S+$/.test(url)) throw new Error('invalid recovery code url')
  return { key, url }
}
