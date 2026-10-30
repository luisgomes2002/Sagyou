// @vitest-environment node
//
// The sync key and the device token are only ever written through the OS
// keychain (Electron safeStorage). Without one — including Linux's
// `basic_text` fallback — sync does not turn on, and nothing is written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const warn = vi.fn()
vi.mock('../modules/logs/logger', () => ({
  log: { info: vi.fn(), warn: (...args: unknown[]) => warn(...args), error: vi.fn() }
}))

import {
  clearSyncConfig,
  loadSyncConfig,
  saveSyncConfig,
  SYNC_CONFIG_FILE,
  syncAvailability,
  type SafeStorageLike,
  type SyncConfig
} from '../modules/sync/sync-config'

// A reversible fake "keychain": XOR with a fixed byte, so the stored text is not the plain text.
function fakeSafe(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf-8').map((b) => b ^ 0x5a)),
    decryptString: (enc) => Buffer.from(enc.map((b) => b ^ 0x5a)).toString('utf-8'),
    ...overrides
  }
}

const config: SyncConfig = {
  url: 'https://sagyou-sync.example.workers.dev',
  syncKey: new Uint8Array(32).fill(3),
  token: 'tok_secret_value_123',
  deviceName: 'PC de casa',
  paused: null
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-sync-config-'))
  warn.mockClear()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('syncAvailability', () => {
  it('needs real keychain encryption', () => {
    expect(syncAvailability(fakeSafe())).toBe('ok')
    expect(syncAvailability(fakeSafe({ isEncryptionAvailable: () => false }))).toBe('no-keychain')
    expect(syncAvailability(fakeSafe({ getSelectedStorageBackend: () => 'basic_text' }))).toBe(
      'no-keychain'
    )
  })
})

describe('saveSyncConfig / loadSyncConfig', () => {
  it('round-trips the config', () => {
    saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe(), config)
    const loaded = loadSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe())
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') return
    expect(Buffer.from(loaded.config.syncKey).equals(Buffer.from(config.syncKey))).toBe(true)
    expect(loaded.config).toMatchObject({
      url: config.url,
      token: config.token,
      deviceName: 'PC de casa',
      paused: null
    })
  })

  it('never writes the key or the token in the clear', () => {
    saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe(), config)
    const text = readFileSync(join(dir, SYNC_CONFIG_FILE), 'utf-8')
    expect(text).not.toContain(config.token)
    expect(text).not.toContain(Buffer.from(config.syncKey).toString('base64'))
    expect(text).not.toContain(Buffer.from(config.syncKey).toString('hex'))
  })

  it('writes atomically with mode 0600', () => {
    saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe(), config)
    expect(existsSync(join(dir, `${SYNC_CONFIG_FILE}.tmp`))).toBe(false)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, SYNC_CONFIG_FILE)).mode & 0o777).toBe(0o600)
    }
  })

  it('refuses to save without a keychain', () => {
    expect(() =>
      saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe({ isEncryptionAvailable: () => false }), config)
    ).toThrow()
    expect(existsSync(join(dir, SYNC_CONFIG_FILE))).toBe(false)
  })

  it('reports none, no-keychain and corrupt apart', () => {
    expect(loadSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe()).status).toBe('none')
    saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe(), config)
    expect(
      loadSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe({ getSelectedStorageBackend: () => 'basic_text' }))
        .status
    ).toBe('no-keychain')

    writeFileSync(join(dir, SYNC_CONFIG_FILE), '{not json')
    expect(loadSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe()).status).toBe('corrupt')
    expect(warn).toHaveBeenCalledWith('sync', 'config_corrupt')
  })

  it('clearSyncConfig removes the file', () => {
    saveSyncConfig(dir, SYNC_CONFIG_FILE, fakeSafe(), config)
    clearSyncConfig(dir, SYNC_CONFIG_FILE)
    expect(existsSync(join(dir, SYNC_CONFIG_FILE))).toBe(false)
  })
})
