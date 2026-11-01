// @sagyou/core runs under the React Native toolchain (babel/metro), not only
// under Node: seal → open → decode round-trips and a desktop vector still hashes alike.
import { decodeBatch, encodeBatch, type WireRecord } from '@sagyou/core/sync/batch'
import { deriveKeys, newSyncKey, openBatch, sealBatch } from '@sagyou/core/sync/crypto'
import { hashPayload } from '@sagyou/core/sync/records'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vectors = require('../../../../packages/core/src/__tests__/fixtures/sync-vectors.json')

describe('@sagyou/core no celular', () => {
  it('sela, abre e decodifica um lote', () => {
    const { enc } = deriveKeys(newSyncKey())
    const records: WireRecord[] = [
      {
        kind: 'task',
        id: 't1',
        hlc: 'h1',
        baseHlc: null,
        deleted: false,
        payload: { title: 'Pão' }
      },
      { kind: 'task', id: 't2', hlc: 'h2', baseHlc: 'h1', deleted: true }
    ]
    const sealed = sealBatch(enc, 'celular', 'lote-1', encodeBatch(records))
    expect(decodeBatch(openBatch(enc, 'celular', 'lote-1', sealed))).toEqual(records)
  })

  it('calcula o mesmo hash que o desktop', () => {
    const { payload, hash } = vectors.payloadHashes[0]
    expect(hashPayload(payload)).toBe(hash)
  })
})
