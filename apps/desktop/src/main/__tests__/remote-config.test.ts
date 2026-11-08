// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  defaultRemoteConfig,
  esp32Key,
  loadRemoteConfig,
  pcPrivateKey,
  remoteConfigFileName,
  saveRemoteConfig,
  sealSecret,
  type RemoteConfig
} from '../modules/remote/remote-config'
import type { SafeStorageLike } from '../modules/sync/sync-config'

const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (enc) => enc.toString().replace(/^enc:/, '')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-config-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = remoteConfigFileName(false)

describe('remote-control.json', () => {
  it('ausente = desligado', () => {
    expect(loadRemoteConfig(dir, file)).toEqual(defaultRemoteConfig())
  })

  it('ida e volta, com chaves cifradas pelo safeStorage', () => {
    const priv = Uint8Array.from({ length: 32 }, (_, i) => i)
    const esp = Uint8Array.from({ length: 32 }, (_, i) => 100 + i)
    const config: RemoteConfig = {
      ...defaultRemoteConfig(),
      enabled: true,
      pcKeys: { publicKey: 'cHVi', privateCipher: sealSecret(safe, priv) },
      controllers: [{ id: 'b'.repeat(32), name: 'Pixel', publicKey: 'cGs=', since: '2026-11-03' }],
      servers: ['Sagyou', 'Murasaki'],
      esp32KeyCipher: sealSecret(safe, esp)
    }
    saveRemoteConfig(dir, file, config, 0)
    const loaded = loadRemoteConfig(dir, file)
    expect(loaded).toEqual(config)
    expect(pcPrivateKey(loaded, safe)).toEqual(priv)
    expect(esp32Key(loaded, safe)).toEqual(esp)
    expect(readFileSync(join(dir, file), 'utf-8')).not.toContain(
      Buffer.from(priv).toString('base64')
    )
  })

  // Spec 2026-11-07-endurecer-acesso-remoto: "Cortar acesso" survives restarts.
  it('accessCutAt: padrão null, arquivo antigo sem o campo = null, valor inválido = null', () => {
    expect(defaultRemoteConfig().accessCutAt).toBeNull()
    const write = (body: object): void =>
      writeFileSync(join(dir, file), JSON.stringify(body), 'utf-8')
    write({ enabled: true, servers: ['Sagyou'] })
    expect(loadRemoteConfig(dir, file).accessCutAt).toBeNull()
    expect(loadRemoteConfig(dir, file).enabled).toBe(true)
    write({ enabled: true, accessCutAt: 'x' })
    expect(loadRemoteConfig(dir, file).accessCutAt).toBeNull()
    write({ enabled: true, accessCutAt: 1.5 })
    expect(loadRemoteConfig(dir, file).accessCutAt).toBeNull()
    write({ enabled: true, accessCutAt: 123 })
    expect(loadRemoteConfig(dir, file).accessCutAt).toBe(123)
  })

  it('accessCutAt faz ida e volta', () => {
    saveRemoteConfig(dir, file, { ...defaultRemoteConfig(), accessCutAt: 1794077717884 }, 0)
    expect(loadRemoteConfig(dir, file).accessCutAt).toBe(1794077717884)
  })

  it('JSON malformado volta ao padrão', () => {
    writeFileSync(join(dir, file), '{ não é json')
    expect(loadRemoteConfig(dir, file)).toEqual(defaultRemoteConfig())
  })

  it.skipIf(process.platform === 'win32')('grava com modo 0600', () => {
    saveRemoteConfig(dir, file, defaultRemoteConfig())
    expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600)
  })

  it('poda nonces vencidos ao salvar', () => {
    saveRemoteConfig(
      dir,
      file,
      {
        ...defaultRemoteConfig(),
        seenNonces: [
          { nonce: 'velho', until: 1000 },
          { nonce: 'novo', until: 5000 }
        ]
      },
      2000
    )
    expect(loadRemoteConfig(dir, file).seenNonces).toEqual([{ nonce: 'novo', until: 5000 }])
  })

  it('sem cofre do sistema não abre as chaves', () => {
    const noKeychain: SafeStorageLike = { ...safe, getSelectedStorageBackend: () => 'basic_text' }
    const config = {
      ...defaultRemoteConfig(),
      pcKeys: { publicKey: 'x', privateCipher: sealSecret(safe, new Uint8Array(32)) }
    }
    expect(pcPrivateKey(config, noKeychain)).toBeNull()
    expect(() => sealSecret(noKeychain, new Uint8Array(32))).toThrow()
  })

  it('nome em dev é separado', () => {
    expect(remoteConfigFileName(true)).toBe('remote-control-dev.json')
    expect(remoteConfigFileName(false)).toBe('remote-control.json')
  })
})
