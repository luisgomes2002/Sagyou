import NetInfo from '@react-native-community/netinfo'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import { createRecordRepo } from './data/records'
import { migrate } from './data/schema'
import { openExpoDb } from './data/sql'
import { useApp } from './store/app'
import { createSyncRuntime } from './sync/runtime'

let started = false

/** Opens the database and the engine once per app process. */
export function bootstrap(): void {
  if (started) return
  started = true
  const db = openExpoDb()
  migrate(db)
  const repo = createRecordRepo(db)
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
    onWiped: () => useApp.getState().wiped()
  })
  // start() reads the secure store first; before it the engine always says 'off'.
  runtime.engine.start()
  const paired = runtime.engine.status().state !== 'off'
  useApp.getState().init({ repo, runtime }, paired)
}
