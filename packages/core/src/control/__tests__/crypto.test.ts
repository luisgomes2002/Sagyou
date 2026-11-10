import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import {
  fromBase64,
  fromBase64Url,
  hkdfSha256,
  hmacSha256Hex,
  toBase64,
  toBase64Url,
  utf8
} from '../../sync/bytes'
import { deriveKeys } from '../../sync/crypto'
import {
  ControlDecryptError,
  controlKey,
  newEsp32Key,
  newSigningKeys,
  openControl,
  openPasswordFromPc,
  pairingCode,
  powerCommandMac,
  powerStateMac,
  publicKeyOf,
  sealControl,
  sealPasswordToPc,
  signBytes,
  verifyBytes
} from '../crypto'

const syncKey = Uint8Array.from({ length: 32 }, (_, i) => i)
const PC = 'a'.repeat(32)
const PHONE = 'b'.repeat(32)

describe('controlKey', () => {
  it('é uma subchave própria, diferente das chaves do sync', () => {
    const key = controlKey(syncKey)
    const { enc, id } = deriveKeys(syncKey)
    expect(key).toHaveLength(32)
    expect(key).not.toEqual(enc)
    expect(key).not.toEqual(id)
    expect(controlKey(syncKey)).toEqual(key)
  })
})

describe('sealControl / openControl', () => {
  const key = controlKey(syncKey)
  const plain = utf8('{"kind":"unlock"}')

  it('abre o que selou', () => {
    const sealed = sealControl(key, PHONE, PC, 'm1', plain)
    expect(openControl(key, PHONE, PC, 'm1', sealed)).toEqual(plain)
  })

  it('não abre com outro destinatário, remetente, id ou chave', () => {
    const sealed = sealControl(key, PHONE, PC, 'm1', plain)
    expect(() => openControl(key, PHONE, PHONE, 'm1', sealed)).toThrow(ControlDecryptError)
    expect(() => openControl(key, PC, PC, 'm1', sealed)).toThrow(ControlDecryptError)
    expect(() => openControl(key, PHONE, PC, 'm2', sealed)).toThrow(ControlDecryptError)
    const other = controlKey(new Uint8Array(32))
    expect(() => openControl(other, PHONE, PC, 'm1', sealed)).toThrow(ControlDecryptError)
    expect(() => openControl(key, PHONE, PC, 'm1', 'não é base64!')).toThrow(ControlDecryptError)
  })
})

describe('assinatura Ed25519', () => {
  /**
   * A changed signature: one bit of its first byte flipped. Swapping the last
   * base64url characters is not a change: the last of 86 characters carries 4
   * unused bits, and "…BA" swapped for "BA" is the same text, so the old
   * check passed ~0.6% of the time (CI on main, run of b082da7).
   */
  const corrupt = (sig: string): string => {
    const bytes = fromBase64Url(sig)
    bytes[0] ^= 1
    return toBase64Url(bytes)
  }

  it('a assinatura trocada sempre difere em algum byte', () => {
    const endsInBA = toBase64Url(Uint8Array.from({ length: 64 }, (_, i) => (i === 63 ? 4 : 0)))
    expect(endsInBA.slice(-2)).toBe('BA')
    // The old swap leaves this one untouched.
    expect(endsInBA.slice(0, -2) + (endsInBA.endsWith('A') ? 'BA' : 'AA')).toBe(endsInBA)
    expect(fromBase64Url(corrupt(endsInBA))).not.toEqual(fromBase64Url(endsInBA))
  })

  it('verifica a assinatura certa e recusa dado ou assinatura trocados', () => {
    const { privateKey, publicKey } = newSigningKeys()
    expect(publicKey).toHaveLength(32)
    const data = utf8('pedido')
    const sig = signBytes(privateKey, data)
    expect(verifyBytes(publicKey, data, sig)).toBe(true)
    expect(verifyBytes(publicKey, utf8('pedidO'), sig)).toBe(false)
    expect(verifyBytes(publicKey, data, corrupt(sig))).toBe(false)
    expect(verifyBytes(newSigningKeys().publicKey, data, sig)).toBe(false)
    expect(verifyBytes(publicKey, data, 'lixo')).toBe(false)
  })
})

describe('senha selada para o PC', () => {
  const seq = (n: number, start: number): Uint8Array =>
    Uint8Array.from({ length: n }, (_, i) => (start + i) & 255)
  const pc = newSigningKeys()
  const phone = newSigningKeys()

  it('selar e abrir devolve a senha', () => {
    for (const password of ['s', 'senha çã 🔒', 'x'.repeat(1024)]) {
      const sealed = sealPasswordToPc(pc.publicKey, phone.publicKey, password)
      expect(openPasswordFromPc(pc.privateKey, phone.publicKey, sealed)).toBe(password)
    }
  })

  it('dois selos da mesma senha são diferentes', () => {
    const a = sealPasswordToPc(pc.publicKey, phone.publicKey, 'mesma')
    const b = sealPasswordToPc(pc.publicKey, phone.publicKey, 'mesma')
    expect(a).not.toBe(b)
  })

  it('não abre com outra chave de PC', () => {
    const sealed = sealPasswordToPc(pc.publicKey, phone.publicKey, 'senha')
    expect(() => openPasswordFromPc(newSigningKeys().privateKey, phone.publicKey, sealed)).toThrow(
      ControlDecryptError
    )
  })

  it('não abre com a chave de outro celular (selo copiado para outro pedido)', () => {
    const sealed = sealPasswordToPc(pc.publicKey, phone.publicKey, 'senha')
    expect(() => openPasswordFromPc(pc.privateKey, newSigningKeys().publicKey, sealed)).toThrow(
      ControlDecryptError
    )
  })

  it('não abre com um byte trocado, base64 inválido ou curto demais', () => {
    const sealed = sealPasswordToPc(pc.publicKey, phone.publicKey, 'senha')
    const raw = fromBase64(sealed)
    for (const i of [0, 40, raw.length - 1]) {
      const bad = raw.slice()
      bad[i] ^= 1
      expect(() => openPasswordFromPc(pc.privateKey, phone.publicKey, toBase64(bad))).toThrow(
        ControlDecryptError
      )
    }
    expect(() => openPasswordFromPc(pc.privateKey, phone.publicKey, '%%%')).toThrow(
      ControlDecryptError
    )
    expect(() =>
      openPasswordFromPc(pc.privateKey, phone.publicKey, toBase64(raw.subarray(0, 72)))
    ).toThrow(ControlDecryptError)
  })

  it('abrir recusa senha acima de 1024 bytes, mesmo selada por fora da função', () => {
    // Built by hand (same construction), since sealPasswordToPc refuses it.
    const ephemeral = seq(32, 9)
    const ephemeralPub = x25519.getPublicKey(ephemeral)
    const pcX = edwardsToMontgomeryPub(pc.publicKey)
    const ikm = new Uint8Array([...x25519.getSharedSecret(ephemeral, pcX), ...ephemeralPub, ...pcX])
    const key = hkdfSha256(ikm, 'sagyou-remote-password-v1', 32)
    const aad = utf8(
      `sagyou-remote-password|1|${toBase64(phone.publicKey)}|${toBase64(pc.publicKey)}`
    )
    const nonce = seq(24, 1)
    const build = (password: string): string =>
      toBase64(
        new Uint8Array([
          ...ephemeralPub,
          ...nonce,
          ...xchacha20poly1305(key, nonce, aad).encrypt(utf8(password))
        ])
      )
    expect(
      openPasswordFromPc(pc.privateKey, phone.publicKey, build('x'.repeat(1024)))
    ).toHaveLength(1024)
    expect(() =>
      openPasswordFromPc(pc.privateKey, phone.publicKey, build('x'.repeat(1025)))
    ).toThrow(ControlDecryptError)
  })

  it('recusa selar senha vazia ou acima de 1024 bytes', () => {
    expect(() => sealPasswordToPc(pc.publicKey, phone.publicKey, '')).toThrow()
    expect(() => sealPasswordToPc(pc.publicKey, phone.publicKey, 'x'.repeat(1025))).toThrow()
  })

  it('vetor fixo: o formato do selo não muda sem querer', () => {
    // Computed once with an independent script over the same @noble libraries.
    const pcFixed = seq(32, 0)
    const phoneFixed = publicKeyOf(seq(32, 0x40))
    const chunks = [seq(32, 0x80), seq(24, 0xc0)]
    const sealed = sealPasswordToPc(publicKeyOf(pcFixed), phoneFixed, 'senha çã 🔒', () => {
      const next = chunks.shift()
      if (!next) throw new Error('random called too often')
      return next
    })
    expect(sealed).toBe(
      'ST6C/HRGSlkmiBdiPSBTxeuOLMSpiLT+4XnsawENUx3AwcLDxMXGx8jJysvMzc7P0NHS09TV1tdiwX8Aki2lvzXyRSUdHr+i/8/UwAQUweTzyDL6l5nF'
    )
    expect(openPasswordFromPc(pcFixed, phoneFixed, sealed)).toBe('senha çã 🔒')
  })
})

describe('pairingCode', () => {
  it('tem 6 dígitos e é igual nas duas ordens', () => {
    const a = newSigningKeys().publicKey
    const b = newSigningKeys().publicKey
    expect(pairingCode(a, b)).toMatch(/^\d{6}$/)
    expect(pairingCode(a, b)).toBe(pairingCode(b, a))
  })
})

describe('MAC do ESP32', () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i)

  it('assina o comando sobre o texto fixo do contrato', () => {
    const expected = hmacSha256Hex(key, 'sagyou-power|1|wake|1000|121000')
    expect(powerCommandMac(key, 'wake', 1000, 121000)).toBe(expected)
    expect(powerCommandMac(key, 'shutdown', 1000, 121000)).not.toBe(expected)
    expect(powerCommandMac(key, 'wake', 1001, 121000)).not.toBe(expected)
    expect(powerCommandMac(key, 'wake', 1000, 121001)).not.toBe(expected)
  })

  it('assina o estado informado pelo ESP32', () => {
    expect(powerStateMac(key, true, 'ok', 5000)).toBe(
      hmacSha256Hex(key, 'sagyou-power-state|1|1|ok|5000')
    )
    expect(powerStateMac(key, false, 'ok', 5000)).not.toBe(powerStateMac(key, true, 'ok', 5000))
  })

  it('gera chaves de 32 bytes diferentes', () => {
    expect(newEsp32Key()).toHaveLength(32)
    expect(newEsp32Key()).not.toEqual(newEsp32Key())
  })
})
