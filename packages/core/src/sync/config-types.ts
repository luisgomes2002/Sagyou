/** What a device keeps about its sync (stored by each app in its own secret store). */
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
