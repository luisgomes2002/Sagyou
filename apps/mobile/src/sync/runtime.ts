import {
  createSyncEngine,
  type FetchLike,
  type SyncEngine,
  type SyncStatus
} from '@sagyou/core/sync/engine'
import type { RecordRepo } from '../data/records'
import type { SqlDb } from '../data/sql'
import type { MobileState } from '../data/state'
import { createMobileSyncStore } from '../data/sync-store'
import { createConfigStore, type SecureStoreLike } from './config-store'

export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void }
}

export interface NetInfoLike {
  addEventListener(listener: (state: { isConnected: boolean | null }) => void): () => void
}

export interface RuntimeDeps {
  db: SqlDb
  repo: RecordRepo
  secure: SecureStoreLike
  fetch: FetchLike
  appState: AppStateLike
  netInfo: NetInfoLike
  getState: () => MobileState
  onStatus: (status: SyncStatus) => void
  onRemote: (state: MobileState) => void
  /** After a remote wipe or "Desconectar": the app goes back to pairing. */
  onWiped: () => void
  now?: () => number
}

export interface SyncRuntime {
  engine: SyncEngine
  /** Delete every local row and the secrets (remote wipe and "Desconectar"). */
  wipeLocal(): void
  dispose(): void
}

const TABLES = [
  'records',
  'sync_records',
  'sync_state',
  'sync_conflicts',
  'sync_pending',
  'search_fts',
  'prefs'
]

/**
 * Wires the shared engine to the phone: the SQLite store, the secure store,
 * the global fetch and timers. It runs only while the app is in the
 * foreground (no background sync in v1) and syncs as soon as the network is back.
 */
export function createSyncRuntime(deps: RuntimeDeps): SyncRuntime {
  const store = createMobileSyncStore(deps.db, deps.repo, deps.getState)
  const config = createConfigStore(deps.secure)

  // Fail closed: the secret goes first (a synchronous sentinel), then what is
  // on screen, then the rows. Compacting the file is best effort; a failure
  // there must not leave the data visible or the device still paired.
  const wipeLocal = (): void => {
    config.clear()
    deps.onWiped()
    deps.db.tx(() => {
      for (const table of TABLES) deps.db.run(`DELETE FROM ${table}`)
    })
    deps.repo.resetDeviceId()
    for (const step of ['VACUUM', 'PRAGMA wal_checkpoint(TRUNCATE)']) {
      try {
        deps.db.exec(step)
      } catch {
        // Rows are gone and secure_delete zeroed their pages; this only shrinks the file.
      }
    }
  }

  const engine = createSyncEngine({
    store,
    config,
    fetch: deps.fetch,
    now: deps.now ?? Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    // The phone keeps no local backup in v1: its data is in the cloud and on the PCs.
    forcedBackup: async () => true,
    wipe: wipeLocal,
    emitStatus: deps.onStatus,
    emitRemoteChanges: (change) => deps.onRemote(change.state as MobileState)
  })

  let online: boolean | null = null
  const appSub = deps.appState.addEventListener('change', (state) => {
    if (state === 'active') engine.start()
    // Send what is waiting before stopping (an edit made < 5 s before leaving).
    else if (state === 'background') void engine.flush()
  })
  const netUnsub = deps.netInfo.addEventListener(({ isConnected }) => {
    const wasOffline = online === false
    online = isConnected
    if (isConnected && wasOffline) void engine.syncNow().catch(() => undefined)
  })

  return {
    engine,
    wipeLocal,
    dispose(): void {
      appSub.remove()
      netUnsub()
      engine.stop()
    }
  }
}
