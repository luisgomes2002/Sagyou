// @vitest-environment node
//
// The vectors in packages/core were generated from this code before the sync
// moved to packages/core. If any of these drift, every device re-sends every
// record (hash), or stops opening other devices' batches (cipher, ids).
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { decodeBatch } from '../modules/sync/sync-batch'
import {
  deriveKeys,
  keyProof,
  openBatch,
  opaqueDeviceId,
  toRecoveryCode
} from '../modules/sync/sync-crypto'
import { encodePairCode } from '../modules/sync/sync-engine'
import { extractDataRecords, extractMemoryRecords, hashPayload } from '../modules/sync/sync-records'

const vectors = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'core',
      'src',
      '__tests__',
      'fixtures',
      'sync-vectors.json'
    ),
    'utf8'
  )
)

const hex = (text: string): Uint8Array =>
  new Uint8Array((text.match(/../g) ?? []).map((h) => parseInt(h, 16)))

describe('vetores de compatibilidade do sync', () => {
  it('extrai os mesmos registros, com o mesmo hash, de um estado completo', () => {
    expect(extractDataRecords(vectors.source)).toEqual(vectors.dataRecords)
    expect(extractMemoryRecords(vectors.memories)).toEqual(vectors.memoryRecords)
  })

  it('calcula o mesmo hash de cada payload', () => {
    expect(vectors.payloadHashes.length).toBeGreaterThan(20)
    for (const { payload, hash } of vectors.payloadHashes) expect(hashPayload(payload)).toBe(hash)
  })

  it('deriva as mesmas chaves, id opaco, prova e códigos', () => {
    const key = hex(vectors.crypto.keyHex)
    const { enc, id } = deriveKeys(key)
    expect(Buffer.from(enc).toString('hex')).toBe(vectors.crypto.encHex)
    expect(Buffer.from(id).toString('hex')).toBe(vectors.crypto.idHex)
    expect(opaqueDeviceId(id, vectors.crypto.deviceId)).toBe(vectors.crypto.opaqueId)
    expect(keyProof(id)).toBe(vectors.crypto.keyProof)
    expect(toRecoveryCode(key, vectors.crypto.url)).toBe(vectors.crypto.recoveryCode)
    expect(encodePairCode(vectors.crypto.url, key, vectors.crypto.invite)).toBe(
      vectors.crypto.pairCode
    )
  })

  it('abre o lote cifrado gravado', () => {
    const plain = openBatch(
      hex(vectors.crypto.encHex),
      vectors.crypto.opaqueId,
      vectors.batch.batchId,
      vectors.batch.sealed
    )
    expect(decodeBatch(plain)).toEqual(vectors.batch.records)
  })
})
