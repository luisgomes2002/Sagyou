import { fromBase64, toBase64 } from '@sagyou/core/sync/bytes'
import type { SyncConfig, SyncConfigLoad, SyncPause } from '@sagyou/core/sync/config-types'
import type { SyncConfigStore } from '@sagyou/core/sync/engine'

/** The slice of expo-secure-store used here (Android Keystore on the device). */
export interface SecureStoreLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  deleteItemAsync(key: string): Promise<void>
}

export const SECURE_KEY = 'sagyou.sync.config'

interface Stored {
  url: string
  syncKey: string
  token: string
  deviceName: string
  paused: SyncPause
}

const PAUSES: readonly SyncPause[] = [null, 'restore', 'join']

/**
 * The sync key and the device token live only in the secure store: never in
 * SQLite, AsyncStorage, the app state or the log.
 */
export function createConfigStore(secure: SecureStoreLike): SyncConfigStore {
  // deleteItemAsync is asynchronous; until it lands, a cleared config must read as none.
  let cleared = false
  return {
    availability: () => 'ok',

    load(): SyncConfigLoad {
      if (cleared) return { status: 'none' }
      const raw = secure.getItem(SECURE_KEY)
      if (!raw) return { status: 'none' }
      try {
        const s = JSON.parse(raw) as Partial<Stored>
        if (
          typeof s.url !== 'string' ||
          typeof s.syncKey !== 'string' ||
          typeof s.token !== 'string' ||
          typeof s.deviceName !== 'string' ||
          !PAUSES.includes(s.paused ?? null)
        )
          return { status: 'corrupt' }
        const syncKey = fromBase64(s.syncKey)
        if (syncKey.length !== 32) return { status: 'corrupt' }
        const config: SyncConfig = {
          url: s.url,
          syncKey,
          token: s.token,
          deviceName: s.deviceName,
          paused: s.paused ?? null
        }
        return { status: 'ok', config }
      } catch {
        return { status: 'corrupt' }
      }
    },

    save(config: SyncConfig): void {
      const stored: Stored = {
        url: config.url,
        syncKey: toBase64(config.syncKey),
        token: config.token,
        deviceName: config.deviceName,
        paused: config.paused
      }
      secure.setItem(SECURE_KEY, JSON.stringify(stored))
      cleared = false
    },

    clear(): void {
      cleared = true
      void secure.deleteItemAsync(SECURE_KEY).catch(() => undefined)
    }
  }
}
