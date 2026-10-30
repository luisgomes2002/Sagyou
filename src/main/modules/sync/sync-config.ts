import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from '../logs/logger'

export const SYNC_CONFIG_FILE = 'sync-config.json'
export const SYNC_CONFIG_FILE_DEV = 'sync-config-dev.json'

/** The slice of Electron's safeStorage this module needs (injected so tests need no Electron). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type SyncPause = null | 'restore' | 'join'

export interface SyncConfig {
  url: string
  syncKey: Uint8Array
  token: string
  deviceName: string
  paused: SyncPause
}

export type SyncConfigLoad =
  | { status: 'none' }
  | { status: 'no-keychain' }
  | { status: 'corrupt' }
  | { status: 'ok'; config: SyncConfig }

/**
 * Sync only runs when the OS keychain protects its secrets. On Linux without a
 * keyring Electron falls back to `basic_text`, a fixed key anyone can undo, so
 * it counts as unavailable: the sync key is never written in the clear.
 */
export function syncAvailability(safe: SafeStorageLike): 'ok' | 'no-keychain' {
  if (!safe.isEncryptionAvailable()) return 'no-keychain'
  if (safe.getSelectedStorageBackend?.() === 'basic_text') return 'no-keychain'
  return 'ok'
}

interface StoredConfig {
  v: 1
  url: string
  deviceName: string
  paused: SyncPause
  /** base64 of safeStorage.encryptString(JSON {syncKey, token}). */
  secret: string
}

/**
 * The sync key and this device's token live in their own file, outside SQLite
 * and every backup: a restore must never hand one device another's credentials.
 */
export function loadSyncConfig(dir: string, file: string, safe: SafeStorageLike): SyncConfigLoad {
  const path = join(dir, file)
  if (!existsSync(path)) return { status: 'none' }
  if (syncAvailability(safe) !== 'ok') return { status: 'no-keychain' }
  try {
    const stored = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredConfig>
    if (stored.v !== 1 || typeof stored.url !== 'string' || typeof stored.secret !== 'string') {
      throw new Error('shape')
    }
    const secret = JSON.parse(safe.decryptString(Buffer.from(stored.secret, 'base64'))) as {
      syncKey?: unknown
      token?: unknown
    }
    if (typeof secret.syncKey !== 'string' || typeof secret.token !== 'string') {
      throw new Error('secret')
    }
    const syncKey = new Uint8Array(Buffer.from(secret.syncKey, 'base64'))
    if (syncKey.length !== 32) throw new Error('key length')
    const paused = stored.paused === 'restore' || stored.paused === 'join' ? stored.paused : null
    return {
      status: 'ok',
      config: {
        url: stored.url,
        syncKey,
        token: secret.token,
        deviceName: typeof stored.deviceName === 'string' ? stored.deviceName : '',
        paused
      }
    }
  } catch {
    log.warn('sync', 'config_corrupt')
    return { status: 'corrupt' }
  }
}

export function saveSyncConfig(
  dir: string,
  file: string,
  safe: SafeStorageLike,
  config: SyncConfig
): void {
  if (syncAvailability(safe) !== 'ok') throw new Error('OS keychain unavailable')
  const secret = safe.encryptString(
    JSON.stringify({ syncKey: Buffer.from(config.syncKey).toString('base64'), token: config.token })
  )
  const stored: StoredConfig = {
    v: 1,
    url: config.url,
    deviceName: config.deviceName,
    paused: config.paused,
    secret: secret.toString('base64')
  }
  const path = join(dir, file)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(stored, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

export function clearSyncConfig(dir: string, file: string): void {
  rmSync(join(dir, file), { force: true })
}
