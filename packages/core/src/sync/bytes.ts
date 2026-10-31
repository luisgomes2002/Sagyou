// Byte helpers without Node: the same code runs in Electron and in React Native
// (Hermes), so no Buffer, crypto, zlib or TextDecoder. Outputs are identical to
// the Node versions they replace (pinned by the vectors in __tests__/fixtures).
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { hkdf } from '@noble/hashes/hkdf'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { base64, base64urlnopad } from '@scure/base'

export const utf8 = (text: string): Uint8Array => strToU8(text)
export const fromUtf8 = (bytes: Uint8Array): string => strFromU8(bytes)
export const utf8Length = (text: string): number => strToU8(text).length

export const toHex = (bytes: Uint8Array): string => bytesToHex(bytes)
export const toBase64 = (bytes: Uint8Array): string => base64.encode(bytes)
export const fromBase64 = (text: string): Uint8Array => base64.decode(text)
export const toBase64Url = (bytes: Uint8Array): string => base64urlnopad.encode(bytes)
export const fromBase64Url = (text: string): Uint8Array => base64urlnopad.decode(text)

/** Cryptographically secure random bytes (Web Crypto; polyfilled on React Native). */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

const asBytes = (data: Uint8Array | string): Uint8Array =>
  typeof data === 'string' ? utf8(data) : data

export const sha256Bytes = (data: Uint8Array | string): Uint8Array => sha256(asBytes(data))
export const sha256Hex = (data: Uint8Array | string): string => toHex(sha256Bytes(data))
export const hmacSha256Hex = (key: Uint8Array, data: Uint8Array | string): string =>
  toHex(hmac(sha256, key, asBytes(data)))
export const hkdfSha256 = (ikm: Uint8Array, info: string, length: number): Uint8Array =>
  hkdf(sha256, ikm, new Uint8Array(0), info, length)

export const gzip = (data: Uint8Array | string): Uint8Array => gzipSync(asBytes(data))
export const gunzip = (data: Uint8Array): Uint8Array => gunzipSync(data)

/** RFC 4122 version 4 UUID from secure random bytes (no `uuid` package: it is ESM-only). */
export function randomUUID(): string {
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = toHex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
