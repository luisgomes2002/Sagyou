import { toBase64, toBase64Url, toHex } from '@sagyou/core/sync/bytes'
import { newSyncKey } from '@sagyou/core/sync/crypto'
import type { FetchLike, SyncStatus } from '@sagyou/core/sync/engine'
import { createRecordRepo, type RecordRepo } from '../../data/records'
import { migrate } from '../../data/schema'
import type { SqlDb } from '../../data/sql'
import { emptyState } from '../../data/state'
import { openNodeDb } from '../../data/__tests__/node-db'
import { SECURE_KEY, createConfigStore, type SecureStoreLike } from '../config-store'
import { createSyncRuntime, type SyncRuntime } from '../runtime'

const TOKEN = 'token-secreto-do-aparelho'

type FakeSecure = SecureStoreLike & { data: Map<string, string> }

function fakeSecure(): FakeSecure {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    deleteItemAsync: async (k) => {
      data.delete(k)
    }
  }
}

interface Emitter<T> {
  emit(value: T): void
  listeners: ((value: T) => void)[]
}

function emitter<T>(): Emitter<T> {
  const listeners: ((value: T) => void)[] = []
  return { listeners, emit: (value) => listeners.forEach((l) => l(value)) }
}

interface Setup {
  db: SqlDb
  repo: RecordRepo
  secure: FakeSecure
  runtime: SyncRuntime
  statuses: SyncStatus[]
  wiped: jest.Mock
  app: Emitter<string>
  net: Emitter<{ isConnected: boolean | null }>
  key: Uint8Array
}

function setup(fetch: FetchLike, wrap: (db: SqlDb) => SqlDb = (db) => db): Setup {
  const db = wrap(openNodeDb())
  migrate(db)
  const repo = createRecordRepo(db)
  const secure = fakeSecure()
  const key = newSyncKey()
  createConfigStore(secure).save({
    url: 'https://sync.exemplo.workers.dev',
    syncKey: key,
    token: TOKEN,
    deviceName: 'Pixel',
    paused: null
  })
  const statuses: SyncStatus[] = []
  const wiped = jest.fn()
  const app = emitter<string>()
  const net = emitter<{ isConnected: boolean | null }>()
  const state = emptyState()
  state.habits = [
    { id: 'h1', name: 'Água', color: '#000', completions: [], createdAt: 'x', updatedAt: 'x' }
  ]
  repo.save(state, Date.now())
  const runtime = createSyncRuntime({
    db,
    repo,
    secure,
    fetch,
    appState: {
      addEventListener: (_type, listener) => {
        app.listeners.push(listener)
        return { remove: () => undefined }
      }
    },
    netInfo: {
      addEventListener: (listener) => {
        net.listeners.push(listener)
        return () => undefined
      }
    },
    getState: () => state,
    onStatus: (s) => statuses.push(s),
    onRemote: () => undefined,
    onWiped: wiped
  })
  return { db, repo, secure, runtime, statuses, wiped, app, net, key }
}

const answer =
  (status: number, body: unknown): FetchLike =>
  async () => ({ status, json: async () => body })

const rows = (db: SqlDb, table: string): number =>
  db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0

describe('runtime do sync no celular', () => {
  it('revogado com apagar: banco vazio, cofre limpo e volta ao pareamento', async () => {
    const s = setup(answer(401, { revoked: true, wipe: true }))
    s.runtime.engine.start()
    await s.runtime.engine.syncNow().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rows(s.db, 'records')).toBe(0)
    expect(rows(s.db, 'sync_records')).toBe(0)
    expect(s.secure.data.has(SECURE_KEY)).toBe(false)
    expect(s.wiped).toHaveBeenCalled()
    s.runtime.dispose()
  })

  it('revogado sem apagar: os dados ficam e o estado vira desconectado', async () => {
    const s = setup(answer(401, { revoked: true, wipe: false }))
    s.runtime.engine.start()
    await s.runtime.engine.syncNow().catch(() => undefined)
    expect(rows(s.db, 'records')).toBeGreaterThan(0)
    expect(s.wiped).not.toHaveBeenCalled()
    expect(s.statuses.at(-1)?.state).toBe('disconnected')
    s.runtime.dispose()
  })

  it('a chave e o token nunca vão para o SQLite', async () => {
    const s = setup(answer(503, {}))
    s.runtime.engine.start()
    await s.runtime.engine.syncNow().catch(() => undefined)
    // Every encoding the key could leak in: base64 (secure store), base64url (pair code), hex.
    const secrets = [toBase64(s.key), toBase64Url(s.key), toHex(s.key), TOKEN]
    const tables = s.db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .map((t) => t.name)
    for (const table of tables) {
      const dump = JSON.stringify(s.db.all(`SELECT * FROM "${table}"`))
      for (const secret of secrets) expect(dump).not.toContain(secret)
    }
    s.runtime.dispose()
  })

  it('envia e para em segundo plano, volta em primeiro plano e sincroniza quando a rede volta', () => {
    const s = setup(answer(503, {}))
    const start = jest.spyOn(s.runtime.engine, 'start').mockImplementation(() => undefined)
    const stop = jest.spyOn(s.runtime.engine, 'stop').mockImplementation(() => undefined)
    const flush = jest.spyOn(s.runtime.engine, 'flush').mockImplementation(async () => undefined)
    const syncNow = jest
      .spyOn(s.runtime.engine, 'syncNow')
      .mockImplementation(async () => s.runtime.engine.status())
    s.app.emit('background')
    // Sends what is waiting before stopping, instead of dropping the timers.
    expect(flush).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    s.app.emit('active')
    expect(start).toHaveBeenCalledTimes(1)
    s.net.emit({ isConnected: false })
    expect(syncNow).not.toHaveBeenCalled()
    s.net.emit({ isConnected: true })
    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  // Review finding: the wipe deleted prefs.device_id but the repo kept the id
  // in memory. Pairing again in the same process used it, the next launch
  // minted another one, and every batch from the phone failed to decrypt.
  it('depois de apagar, o id usado no novo pareamento é o mesmo depois de reabrir', () => {
    const s = setup(answer(503, {}))
    const before = s.repo.deviceId()
    s.runtime.wipeLocal()
    const usedToPair = s.repo.deviceId()
    expect(usedToPair).not.toBe(before)
    expect(createRecordRepo(s.db).deviceId()).toBe(usedToPair)
  })

  it('se compactar o arquivo falha, o cofre e a tela já foram limpos', () => {
    const s = setup(answer(503, {}), (db) => ({
      ...db,
      exec: (sql: string) => {
        if (sql === 'VACUUM') throw new Error('SQLITE_FULL')
        db.exec(sql)
      }
    }))
    expect(() => s.runtime.wipeLocal()).not.toThrow()
    expect(createConfigStore(s.secure).load()).toEqual({ status: 'none' })
    expect(s.wiped).toHaveBeenCalled()
    expect(rows(s.db, 'records')).toBe(0)
  })

  it('a chave sai do cofre na hora, mesmo se a exclusão assíncrona falhar', () => {
    const secure = fakeSecure()
    secure.deleteItemAsync = async () => {
      throw new Error('keystore')
    }
    const store = createConfigStore(secure)
    store.save({
      url: 'https://sync.exemplo.workers.dev',
      syncKey: newSyncKey(),
      token: TOKEN,
      deviceName: 'Pixel',
      paused: null
    })
    store.clear()
    expect(secure.data.get(SECURE_KEY)).not.toContain(TOKEN)
    expect(createConfigStore(secure).load()).toEqual({ status: 'none' })
  })
})
