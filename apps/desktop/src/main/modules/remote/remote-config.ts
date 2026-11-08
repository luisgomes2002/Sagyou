// This PC's remote-control configuration (spec docs/specs/2026-11-03-controle-remoto-app.md).
//
// Lives in its own file in userData, outside SQLite, every backup and the sync
// (a restore must never hand a PC another's authorized phones or keys), mode
// 0600, written .tmp + rename, and deleted by a remote wipe (wipe.ts). The PC's
// Ed25519 private key and the ESP32 key are stored encrypted with safeStorage.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SafeStorageLike } from '../sync/sync-config'
import { syncAvailability } from '../sync/sync-config'
import { log } from '../logs/logger'

export const REMOTE_CONFIG_FILE = 'remote-control.json'
export const REMOTE_CONFIG_FILE_DEV = 'remote-control-dev.json'

export interface RemoteController {
  /** Opaque device id. */
  id: string
  name: string
  /** base64 Ed25519 public key. */
  publicKey: string
  since: string
}

export interface RemoteConfig {
  enabled: boolean
  /** publicKey base64; privateCipher = base64 of safeStorage.encryptString(base64 private key). */
  pcKeys: { publicKey: string; privateCipher: string } | null
  controllers: RemoteController[]
  /** Names passed to `claude remote-control --name`, in the order shown. */
  servers: string[]
  /** base64 of safeStorage.encryptString(base64 ESP32 key). */
  esp32KeyCipher: string | null
  failures: number
  suspendedUntil: number | null
  /** Nonces of accepted requests, kept until they expire (survives a restart). */
  seenNonces: { nonce: string; until: number }[]
  /**
   * When the phone's "Cortar acesso" was accepted (ms), or null. While set, the
   * external token is suspended and every Remote Control server is ended
   * (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md).
   */
  accessCutAt: number | null
}

export function defaultRemoteConfig(): RemoteConfig {
  return {
    enabled: false,
    pcKeys: null,
    controllers: [],
    servers: [],
    esp32KeyCipher: null,
    failures: 0,
    suspendedUntil: null,
    seenNonces: [],
    accessCutAt: null
  }
}

export function remoteConfigFileName(dev: boolean): string {
  return dev ? REMOTE_CONFIG_FILE_DEV : REMOTE_CONFIG_FILE
}

const isString = (v: unknown): v is string => typeof v === 'string'

function parse(raw: unknown): RemoteConfig {
  const base = defaultRemoteConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const keys = r.pcKeys as Record<string, unknown> | null | undefined
  return {
    enabled: r.enabled === true,
    pcKeys:
      keys && isString(keys.publicKey) && isString(keys.privateCipher)
        ? { publicKey: keys.publicKey, privateCipher: keys.privateCipher }
        : null,
    controllers: Array.isArray(r.controllers)
      ? (r.controllers as Record<string, unknown>[]).flatMap((c) =>
          c && isString(c.id) && isString(c.name) && isString(c.publicKey) && isString(c.since)
            ? [{ id: c.id, name: c.name, publicKey: c.publicKey, since: c.since }]
            : []
        )
      : [],
    servers: Array.isArray(r.servers) ? (r.servers as unknown[]).filter(isString).slice(0, 50) : [],
    esp32KeyCipher: isString(r.esp32KeyCipher) ? r.esp32KeyCipher : null,
    failures:
      Number.isSafeInteger(r.failures) && (r.failures as number) >= 0 ? (r.failures as number) : 0,
    suspendedUntil: Number.isSafeInteger(r.suspendedUntil) ? (r.suspendedUntil as number) : null,
    seenNonces: Array.isArray(r.seenNonces)
      ? (r.seenNonces as Record<string, unknown>[]).flatMap((n) =>
          n && isString(n.nonce) && Number.isSafeInteger(n.until)
            ? [{ nonce: n.nonce, until: n.until as number }]
            : []
        )
      : [],
    // A file from before this field reads as "not cut".
    accessCutAt: Number.isSafeInteger(r.accessCutAt) ? (r.accessCutAt as number) : null
  }
}

/** Missing or unreadable means the default (off): nothing remote works until set up again. */
export function loadRemoteConfig(dir: string, file: string): RemoteConfig {
  const path = join(dir, file)
  if (!existsSync(path)) return defaultRemoteConfig()
  try {
    return parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    log.warn('remote', 'config_corrupt')
    return defaultRemoteConfig()
  }
}

export function saveRemoteConfig(
  dir: string,
  file: string,
  config: RemoteConfig,
  now = Date.now()
): void {
  const pruned: RemoteConfig = {
    ...config,
    seenNonces: config.seenNonces.filter((n) => n.until > now)
  }
  const path = join(dir, file)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(pruned, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

export function sealSecret(safe: SafeStorageLike, bytes: Uint8Array): string {
  if (syncAvailability(safe) !== 'ok') throw new Error('OS keychain unavailable')
  return safe.encryptString(Buffer.from(bytes).toString('base64')).toString('base64')
}

export function openSecret(safe: SafeStorageLike, cipher: string | null): Uint8Array | null {
  if (!cipher || syncAvailability(safe) !== 'ok') return null
  try {
    const bytes = new Uint8Array(
      Buffer.from(safe.decryptString(Buffer.from(cipher, 'base64')), 'base64')
    )
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

export function pcPrivateKey(config: RemoteConfig, safe: SafeStorageLike): Uint8Array | null {
  return openSecret(safe, config.pcKeys?.privateCipher ?? null)
}

export function esp32Key(config: RemoteConfig, safe: SafeStorageLike): Uint8Array | null {
  return openSecret(safe, config.esp32KeyCipher)
}
