import { describe, expect, it } from 'vitest'
import { newSigningKeys } from '../crypto'
import { checkEnvelope, parsePcStatus, signEnvelope, type SignedEnvelope } from '../messages'

const NOW = 1_800_000_000_000
const never = (): boolean => false

describe('checkEnvelope', () => {
  const { privateKey, publicKey } = newSigningKeys()
  const sign = (issuedAt = NOW): SignedEnvelope =>
    signEnvelope(privateKey, 'unlock', { pc: 'x' }, issuedAt)

  it('aceita um pedido válido de 60 s', () => {
    const env = sign()
    expect(env.expiresAt - env.issuedAt).toBe(60_000)
    expect(checkEnvelope(env, publicKey, NOW, never)).toEqual({ ok: true })
  })

  it('recusa assinatura trocada ou corpo alterado', () => {
    const env = sign()
    expect(checkEnvelope({ ...env, body: { pc: 'y' } }, publicKey, NOW, never)).toEqual({
      ok: false,
      reason: 'signature'
    })
    const other = newSigningKeys().publicKey
    expect(checkEnvelope(env, other, NOW, never)).toEqual({ ok: false, reason: 'signature' })
  })

  it('recusa pedido vencido', () => {
    const env = sign()
    expect(checkEnvelope(env, publicKey, env.expiresAt + 30_000, never)).toEqual({
      ok: false,
      reason: 'expired'
    })
  })

  it('aceita até 90 s de atraso e recusa 91 s', () => {
    expect(checkEnvelope(sign(NOW - 89_000), publicKey, NOW, never)).toEqual({ ok: true })
    expect(checkEnvelope(sign(NOW - 91_000), publicKey, NOW, never)).toEqual({
      ok: false,
      reason: 'expired'
    })
  })

  it('recusa relógio adiantado mais de 30 s', () => {
    expect(checkEnvelope(sign(NOW + 30_000), publicKey, NOW, never)).toEqual({ ok: true })
    expect(checkEnvelope(sign(NOW + 31_000), publicKey, NOW, never)).toEqual({
      ok: false,
      reason: 'future'
    })
  })

  it('recusa nonce já visto', () => {
    const env = sign()
    expect(checkEnvelope(env, publicKey, NOW, (n) => n === env.nonce)).toEqual({
      ok: false,
      reason: 'replay'
    })
  })

  it('recusa tipo desconhecido, forma errada ou validade maior que a do tipo', () => {
    const env = sign()
    expect(checkEnvelope({ ...env, kind: 'format-c' }, publicKey, NOW, never)).toEqual({
      ok: false,
      reason: 'shape'
    })
    expect(checkEnvelope(null, publicKey, NOW, never)).toEqual({ ok: false, reason: 'shape' })
    const long = signEnvelope(privateKey, 'unlock', {}, NOW, 61_000)
    expect(checkEnvelope(long, publicKey, NOW, never)).toEqual({ ok: false, reason: 'shape' })
  })

  it('authorize-remote pode valer 24 h', () => {
    const env = signEnvelope(privateKey, 'authorize-remote', {}, NOW, 24 * 3_600_000)
    expect(checkEnvelope(env, publicKey, NOW + 23 * 3_600_000, never)).toEqual({ ok: true })
  })
})

describe('parsePcStatus', () => {
  const valid = {
    v: 1,
    at: NOW,
    locked: true,
    servers: [{ name: 'Sagyou', up: true }],
    pendingCards: 0,
    shutdownAt: null,
    suspendedUntil: null
  }

  it('lê um status válido', () => {
    expect(parsePcStatus(valid)).toEqual(valid)
  })

  it('recusa campos com tipo errado', () => {
    expect(parsePcStatus({ ...valid, locked: 'sim' })).toBeNull()
    expect(parsePcStatus({ ...valid, servers: [{ name: 1, up: true }] })).toBeNull()
    expect(parsePcStatus({ ...valid, pendingCards: -1 })).toBeNull()
    expect(parsePcStatus({ ...valid, shutdownAt: 'agora' })).toBeNull()
    expect(parsePcStatus(null)).toBeNull()
  })
})
