import NetInfo from '@react-native-community/netinfo'
import * as Notifications from 'expo-notifications'
import * as ScreenCapture from 'expo-screen-capture'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { AppState } from 'react-native'
import { createControllerKeys } from './remote/keys'
import { configureRemote, useRemote } from './remote/store'
import { createRecordRepo } from './data/records'
import { migrate } from './data/schema'
import { rebuildSearchIndex, searchRecords } from './data/search'
import { openExpoDb } from './data/sql'
import { useNotifications } from './notifications/store'
import { useApp } from './store/app'
import { createSyncRuntime } from './sync/runtime'

let started = false

/** Opens the database and the engine once per app process. */
export function bootstrap(): void {
  if (started) return
  started = true
  // A push that arrives with the app open still shows ("PC ligado, Sagyou pronto").
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false
    })
  })
  // FLAG_SECURE: no screenshot, recording or Recents thumbnail of tasks and finances.
  void ScreenCapture.preventScreenCaptureAsync().catch(() => undefined)
  const db = openExpoDb()
  migrate(db)
  const repo = createRecordRepo(db, (_change, state) => rebuildSearchIndex(db, state))
  rebuildSearchIndex(db, repo.loadState())
  useNotifications.getState().load(repo)
  const runtime = createSyncRuntime({
    db,
    repo,
    secure: SecureStore,
    fetch: (url, init) => fetch(url, init),
    appState: AppState,
    netInfo: NetInfo,
    getState: () => useApp.getState().state,
    onStatus: (status) => useApp.getState().setStatus(status),
    onRemote: (state) => useApp.getState().receive(state),
    onWiped: () => {
      useApp.getState().wiped()
      // The wipe deletes every row (the history pref too): only the memory is left to drop.
      useNotifications.getState().reset()
    }
  })
  configureRemote({
    client: runtime.control,
    keys: createControllerKeys(SecureStore),
    now: Date.now,
    deviceName: () => runtime.engine.status().deviceName,
    authenticate: async () =>
      (
        await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirme para controlar o PC'
        })
      ).success,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  })
  void useRemote
    .getState()
    .init()
    .catch(() => undefined)
  // start() reads the secure store first; before it the engine always says 'off'.
  runtime.engine.start()
  const paired = runtime.engine.status().state !== 'off'
  useApp
    .getState()
    .init(
      { repo, runtime, search: (text, profileId) => searchRecords(db, text, profileId) },
      paired
    )
}
