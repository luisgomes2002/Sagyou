// @vitest-environment node
//
// Every batch leaves the device sealed with XChaCha20-Poly1305 under a key the
// server never sees. Opening must fail on any tampering or on a batch claimed
// by another device, and the recovery code must round-trip the key exactly.
import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import {
  deriveKeys,
  fromRecoveryCode,
  keyProof,
  newSyncKey,
  opaqueDeviceId,
  openBatch,
  sealBatch,
  SyncDecryptError,
  toRecoveryCode
} from '../modules/sync/sync-crypto'

const plain = new TextEncoder().encode('{"v":1,"records":[]}')

function keys(): ReturnType<typeof deriveKeys> {
  return deriveKeys(new Uint8Array(32).fill(7))
}

describe('newSyncKey', () => {
  it('makes 32 random bytes', () => {
    const a = newSyncKey()
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).equals(Buffer.from(newSyncKey()))).toBe(false)
  })
})

describe('deriveKeys', () => {
  it('derives two distinct 32-byte subkeys, stable per key', () => {
    const { enc, id } = keys()
    expect(enc).toHaveLength(32)
    expect(id).toHaveLength(32)
    expect(Buffer.from(enc).equals(Buffer.from(id))).toBe(false)
    expect(Buffer.from(keys().enc).equals(Buffer.from(enc))).toBe(true)
  })
})

describe('opaqueDeviceId', () => {
  it('is 32 hex chars, stable, and changes with the key', () => {
    const one = opaqueDeviceId(keys().id, 'a'.repeat(32))
    expect(one).toMatch(/^[0-9a-f]{32}$/)
    expect(opaqueDeviceId(keys().id, 'a'.repeat(32))).toBe(one)
    const other = deriveKeys(new Uint8Array(32).fill(8)).id
    expect(opaqueDeviceId(other, 'a'.repeat(32))).not.toBe(one)
    expect(one).not.toContain('a'.repeat(32))
  })
})

describe('keyProof', () => {
  it('proves possession of the id key with the fixed auth context', () => {
    const id = keys().id
    expect(keyProof(id)).toBe(createHmac('sha256', id).update('sagyou-sync-auth-v1').digest('hex'))
    expect(keyProof(id)).not.toBe(keyProof(deriveKeys(new Uint8Array(32).fill(8)).id))
  })
})

describe('sealBatch / openBatch', () => {
  const { enc } = keys()

  it('round-trips the bytes', () => {
    const sealed = sealBatch(enc, 'dev1', 'b1', plain)
    expect(Buffer.from(openBatch(enc, 'dev1', 'b1', sealed)).equals(Buffer.from(plain))).toBe(true)
  })

  it('never seals the same text the same way (random nonce)', () => {
    expect(sealBatch(enc, 'dev1', 'b1', plain)).not.toBe(sealBatch(enc, 'dev1', 'b1', plain))
  })

  it('refuses a flipped byte', () => {
    const raw = Buffer.from(sealBatch(enc, 'dev1', 'b1', plain), 'base64')
    raw[raw.length - 1] ^= 1
    expect(() => openBatch(enc, 'dev1', 'b1', raw.toString('base64'))).toThrow(SyncDecryptError)
  })

  it('refuses another device, another batch id or another key', () => {
    const sealed = sealBatch(enc, 'dev1', 'b1', plain)
    expect(() => openBatch(enc, 'dev2', 'b1', sealed)).toThrow(SyncDecryptError)
    expect(() => openBatch(enc, 'dev1', 'b2', sealed)).toThrow(SyncDecryptError)
    const other = deriveKeys(new Uint8Array(32).fill(9)).enc
    expect(() => openBatch(other, 'dev1', 'b1', sealed)).toThrow(SyncDecryptError)
  })

  it('refuses garbage shorter than a nonce', () => {
    expect(() => openBatch(enc, 'dev1', 'b1', 'AAAA')).toThrow(SyncDecryptError)
  })
})

describe('recovery code', () => {
  const key = new Uint8Array(32).map((_, i) => i * 7)
  const url = 'https://sagyou-sync.example.workers.dev'

  it('is 14 groups of 4 base32 chars on one line and the URL on the next', () => {
    const [line, second] = toRecoveryCode(key, url).split('\n')
    expect(line).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/)
    expect(second).toBe(url)
  })

  it('round-trips, ignoring case and spaces', () => {
    const [line, second] = toRecoveryCode(key, url).split('\n')
    const messy = `${line.toLowerCase().replace(/-/g, ' - ')}\n${second}`
    const back = fromRecoveryCode(messy)
    expect(Buffer.from(back.key).equals(Buffer.from(key))).toBe(true)
    expect(back.url).toBe(url)
  })

  it('refuses a wrong checksum or a wrong length', () => {
    const [line, second] = toRecoveryCode(key, url).split('\n')
    const swapped = (line[0] === 'A' ? 'B' : 'A') + line.slice(1)
    expect(() => fromRecoveryCode(`${swapped}\n${second}`)).toThrow()
    expect(() => fromRecoveryCode(`${line.slice(5)}\n${second}`)).toThrow()
  })
})
