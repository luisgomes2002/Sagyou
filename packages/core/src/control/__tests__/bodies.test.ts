import { describe, expect, it } from 'vitest'
import { toBase64 } from '../../sync/bytes'
import { newSigningKeys } from '../crypto'
import {
  parseApprovalAnswer,
  parseApprovalCard,
  parseAuthorizeRemote,
  parseAuthorizeRequest,
  parseAuthorized,
  parseEsp32Key,
  parseResult
} from '../bodies'

const pub = toBase64(newSigningKeys().publicKey)

describe('corpos das mensagens do controle', () => {
  it('pedido de autorização exige nome e chave de 32 bytes', () => {
    expect(parseAuthorizeRequest({ name: 'Pixel 8', publicKey: pub })?.name).toBe('Pixel 8')
    expect(parseAuthorizeRequest({ name: '', publicKey: pub })).toBeNull()
    expect(parseAuthorizeRequest({ name: 'x', publicKey: toBase64(new Uint8Array(16)) })).toBeNull()
    expect(parseAuthorizeRequest({ name: 'x', publicKey: '%%%' })).toBeNull()
    expect(parseAuthorizeRequest(null)).toBeNull()
  })

  it('pedido à distância exige a senha selada', () => {
    expect(parseAuthorizeRemote({ name: 'x', publicKey: pub })).toBeNull()
    const sealed = parseAuthorizeRemote({ name: 'x', publicKey: pub, sealedPassword: 'abc' })
    expect(sealed?.sealedPassword).toBe('abc')
    expect(sealed?.key).toHaveLength(32)
    expect(sealed?.outdated).toBeUndefined()
    expect(
      parseAuthorizeRemote({ name: 'x', publicKey: pub, sealedPassword: 'a'.repeat(2049) })
    ).toBeNull()
    expect(parseAuthorizeRemote({ name: '', publicKey: pub, sealedPassword: 'abc' })).toBeNull()
  })

  it('pedido à distância de um celular antigo (senha sem selo) vem marcado, com a chave', () => {
    const old = parseAuthorizeRemote({ name: 'x', publicKey: pub, password: 's' })
    expect(old?.outdated).toBe(true)
    expect(old?.key).toHaveLength(32)
    expect(old?.sealedPassword).toBeUndefined()
    expect(old).not.toHaveProperty('password')
    expect(parseAuthorizeRemote({ name: 'x', publicKey: '%%%', password: 's' })).toBeNull()
  })

  it('chaves do PC e do ESP32', () => {
    expect(parseAuthorized({ pcPublicKey: pub })?.key).toHaveLength(32)
    expect(parseAuthorized({})).toBeNull()
    expect(parseEsp32Key({ key: pub })).toHaveLength(32)
    expect(parseEsp32Key({ key: 1 })).toBeNull()
  })

  it('resultado, cartão e resposta', () => {
    expect(parseResult({ replyTo: 'abc', ok: false, reason: 'suspended', until: 5 })).toEqual({
      replyTo: 'abc',
      ok: false,
      reason: 'suspended',
      until: 5
    })
    expect(parseResult({ ok: true })).toBeNull()
    const card = {
      id: 'c1',
      session: 'Sagyou',
      tool: 'delete_task',
      resumo: 'Apagar',
      expiresAt: 10
    }
    expect(parseApprovalCard(card)).toEqual(card)
    expect(parseApprovalCard({ ...card, expiresAt: 'x' })).toBeNull()
    expect(parseApprovalAnswer({ id: 'c1', approved: true })).toEqual({ id: 'c1', approved: true })
    expect(parseApprovalAnswer({ id: 'c1' })).toBeNull()
  })
})
