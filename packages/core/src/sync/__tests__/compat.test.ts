// The core replaced node crypto/zlib/Buffer with noble/fflate/scure so it can
// run on the phone. These vectors came from the desktop code before the move:
// any drift here means every device re-sends everything (hash) or stops
// reading the others' batches (cipher, ids, codes).
import { readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { decodeBatch, encodeBatch } from '../batch'
import {
  deriveKeys,
  keyProof,
  openBatch,
  opaqueDeviceId,
  sealBatch,
  toRecoveryCode
} from '../crypto'
import { encodePairCode, parsePairCode } from '../engine'
import { extractDataRecords, extractMemoryRecords, hashPayload } from '../records'

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '__tests__', 'fixtures', 'sync-vectors.json'), 'utf8')
)
const hex = (text: string): Uint8Array =>
  new Uint8Array((text.match(/../g) ?? []).map((h) => parseInt(h, 16)))
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

describe('compatibilidade com o sync do desktop antes do core', () => {
  it('extrai os mesmos registros e hashes', () => {
    expect(extractDataRecords(vectors.source)).toEqual(vectors.dataRecords)
    expect(extractMemoryRecords(vectors.memories)).toEqual(vectors.memoryRecords)
    for (const { payload, hash } of vectors.payloadHashes) expect(hashPayload(payload)).toBe(hash)
  })

  it('deriva as mesmas chaves, ids e códigos', () => {
    const key = hex(vectors.crypto.keyHex)
    const { enc, id } = deriveKeys(key)
    expect(toHex(enc)).toBe(vectors.crypto.encHex)
    expect(toHex(id)).toBe(vectors.crypto.idHex)
    expect(opaqueDeviceId(id, vectors.crypto.deviceId)).toBe(vectors.crypto.opaqueId)
    expect(keyProof(id)).toBe(vectors.crypto.keyProof)
    expect(toRecoveryCode(key, vectors.crypto.url)).toBe(vectors.crypto.recoveryCode)
    const pair = encodePairCode(vectors.crypto.url, key, vectors.crypto.invite)
    expect(pair).toBe(vectors.crypto.pairCode)
    expect(toHex(parsePairCode(pair).syncKey)).toBe(vectors.crypto.keyHex)
  })

  it('abre o lote cifrado pelo desktop antigo', () => {
    const plain = openBatch(
      hex(vectors.crypto.encHex),
      vectors.crypto.opaqueId,
      vectors.batch.batchId,
      vectors.batch.sealed
    )
    expect(decodeBatch(plain)).toEqual(vectors.batch.records)
  })

  it('gera lote que o zlib do Node abre, e abre gzip do zlib', () => {
    const records = vectors.batch.records
    const ours = encodeBatch(records)
    expect(JSON.parse(gunzipSync(ours).toString('utf8'))).toEqual({ v: 1, records })
    const theirs = new Uint8Array(gzipSync(JSON.stringify({ v: 1, records })))
    expect(decodeBatch(theirs)).toEqual(records)
  })

  it('o que o core sela, o core abre; e lote adulterado é recusado', () => {
    const { enc } = deriveKeys(hex(vectors.crypto.keyHex))
    const sealed = sealBatch(enc, 'dev', 'b1', encodeBatch(vectors.batch.records))
    expect(decodeBatch(openBatch(enc, 'dev', 'b1', sealed))).toEqual(vectors.batch.records)
    expect(() => openBatch(enc, 'dev', 'outro-lote', sealed)).toThrow()
    expect(() => openBatch(enc, 'dev', 'b1', 'não é base64!')).toThrow()
  })
})
