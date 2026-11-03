import { checkEnvelope } from '@sagyou/core/control/messages'
import {
  KEY_ESP32,
  KEY_PCPUB,
  KEY_PRIVATE,
  KEY_PUBLIC,
  KeyCancelledError,
  KeyInvalidatedError,
  createControllerKeys
} from '../keys'
import { fakeSecure } from './fakes'

const NOW = 1_800_000_000_000

describe('chaves do controle', () => {
  it('só a chave privada pede biometria', async () => {
    const secure = fakeSecure()
    const keys = createControllerKeys(secure, () => NOW)
    const fresh = await keys.renew()
    await keys.setPcPublicKey(new Uint8Array(32).fill(1))
    await keys.setEsp32Key(new Uint8Array(32).fill(2))
    const auth = secure.writes.filter((w) => w.options?.requireAuthentication)
    expect(auth.map((w) => w.key)).toEqual([KEY_PRIVATE])
    for (const key of [KEY_PUBLIC, KEY_PCPUB, KEY_ESP32]) {
      expect(secure.writes.find((w) => w.key === key)?.options?.requireAuthentication).toBeFalsy()
    }
    expect(await keys.publicKey()).toEqual(fresh.publicKey)
  })

  it('assinar lê a chave privada com biometria e o PC confere', async () => {
    const secure = fakeSecure()
    const keys = createControllerKeys(secure, () => NOW)
    const { publicKey } = await keys.renew()
    const env = await keys.sign('unlock', {})
    expect(secure.reads.at(-1)).toMatchObject({
      key: KEY_PRIVATE,
      options: { requireAuthentication: true }
    })
    expect(checkEnvelope(env, publicKey, NOW, () => false)).toEqual({ ok: true })
  })

  it('biometria trocada vira KeyInvalidatedError; cancelar vira KeyCancelledError', async () => {
    const secure = fakeSecure()
    const keys = createControllerKeys(secure, () => NOW)
    await keys.renew()
    secure.failRead = new Error('android.security.keystore.KeyPermanentlyInvalidatedException')
    await expect(keys.sign('unlock', {})).rejects.toBeInstanceOf(KeyInvalidatedError)
    secure.failRead = new Error('User canceled the authentication')
    await expect(keys.sign('unlock', {})).rejects.toBeInstanceOf(KeyCancelledError)
  })

  it('limpar apaga tudo', async () => {
    const secure = fakeSecure()
    const keys = createControllerKeys(secure, () => NOW)
    await keys.renew()
    await keys.setState('yes')
    await keys.setEsp32Key(new Uint8Array(32))
    await keys.clear()
    expect(secure.data.size).toBe(0)
    expect(await keys.state()).toBe('none')
  })
})
