/**
 * The sync engine: pairing, the push/pull rhythm, revocation and the remote wipe.
 *
 * Everything with an effect is injected (fetch, timers, the store, the config
 * file, the forced backup, the wipe), so the whole flow runs under vitest
 * without Electron or SQLite. The server only ever sees the opaque device id,
 * sealed batches and numbers: titles, amounts and record ids travel inside
 * `sealBatch`, and the log gets counts, seqs and ms only.
 *
 * Failure rules that protect data:
 * - a network error or a 5xx is "Sem conexão" plus backoff, never a 401;
 * - a 401 without `wipe` only forgets this device's sync config;
 * - only a 401 whose body says `{revoked: true, wipe: true}` wipes the device;
 * - a batch that does not decrypt is logged, skipped, and the cursor moves on.
 */
import { createHash, randomBytes, randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { resolve, sep } from 'path'
import { errorMessage, log } from '../logs/logger'
import { SYNC_DEVICE_FILE, SYNC_DEVICE_FILE_DEV } from './device-id'
import { parseHlc } from './hlc'
import type { ConflictType, IncomingRecord } from './sync-apply'
import {
  buildOutgoing,
  decodeBatch,
  encodeBatch,
  packBatches,
  recordKey,
  type OutgoingRow,
  type WireRecord
} from './sync-batch'
import {
  SYNC_CONFIG_FILE,
  SYNC_CONFIG_FILE_DEV,
  type SyncConfig,
  type SyncConfigLoad,
  type SyncPause
} from './sync-config'
import {
  deriveKeys,
  newSyncKey,
  opaqueDeviceId,
  openBatch,
  sealBatch,
  toRecoveryCode
} from './sync-crypto'
import type { SyncKind, SyncRecord } from './sync-records'

export const PUSH_DEBOUNCE_MS = 5000
export const POLL_MS = 60000
export const BASE_BACKOFF_MS = 5000
export const MAX_BACKOFF_MS = 900000
/** Pull page size: 20 batches of at most ~350 KB sealed keeps a response near 7 MB. */
export const PULL_PAGE_LIMIT = 20
export const REQUEST_TIMEOUT_MS = 30000
/** One /push body stays well under the Worker's 2 MB cap. */
const MAX_PUSH_BODY_CHARS = 1_500_000
const PAIR_PREFIX = 'sagyou-sync'
const PAIR_VERSION = '1'
const DEVICE_NAME_BATCH = 'device-name'
const UNKNOWN_DEVICE = 'outro aparelho'

// ── Public types ─────────────────────────────────────────────────────────────

export type SyncStateName = 'off' | 'no-keychain' | 'ok' | 'offline' | 'paused' | 'disconnected'

export interface SyncStatus {
  state: SyncStateName
  lastSyncAt: number | null
  pendingCount: number
  paused: SyncPause
  deviceName: string
  conflictCount: number
}

export interface SyncDevice {
  /** Opaque id, as the server knows it. */
  id: string
  name: string
  lastSeen: number
  revokedAt: number | null
  wipe: boolean
  current: boolean
}

export interface SyncVersionView {
  hlc: string | null
  /** Wall-clock ms of the edit, read off the HLC. */
  at: number | null
  deviceName: string
  deleted: boolean
  payload: Record<string, unknown> | null
}

export interface SyncConflictView {
  id: string
  type: ConflictType
  kind: SyncKind
  recordId: string
  createdAt: number
  /** The version this device made or holds. */
  local: SyncVersionView
  /** The version from another device. */
  remote: SyncVersionView
}

/**
 * Extra proof for /setup and revoke (Task 7b: key proof and TOTP). The engine
 * already threads it through; `extraHeaders` decides what it becomes.
 */
export interface SyncSecondFactor {
  totp?: string
}

/** What every sync IPC action answers: its result, or a message for the screen. */
export type SyncResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

/** A stored conflict as store.ts lists it. */
export interface SyncConflictRow {
  id: string
  kind: SyncKind
  recordId: string
  type: ConflictType
  loserCipher: string
  winnerHlc: string | null
  loserHlc: string
  loserDevice: string
  createdAt: number
}

export interface SyncApplyCtx {
  enc: Uint8Array
  opaqueId: string
  now?: number
}

export interface SyncStateChange {
  generation: number
  state: unknown | null
}

/** The slice of store.ts the engine uses. */
export interface SyncStoreLike {
  getSyncDeviceId(): string
  pendingOutgoing(): OutgoingRow[]
  pendingOutgoingCount(): number
  markPushed(
    seqLocalMax: number,
    serverSeqs: { kind: string; id: string; hlc: string; serverSeq: number }[]
  ): void
  currentSyncRecords(): Map<string, SyncRecord>
  applyRemoteRecords(
    records: IncomingRecord[],
    ctx: SyncApplyCtx
  ): SyncStateChange & { applied: number; memories: number; conflicts: number; pending: number }
  replaceWithRemoteRecords(
    records: IncomingRecord[],
    ctx: SyncApplyCtx
  ): SyncStateChange & { records: number }
  readSyncState(key: string): string | null
  writeSyncState(key: string, value: string): void
  listSyncConflicts(now: number): SyncConflictRow[]
  openSyncConflictCount(now: number): number
  markSyncConflictResolved(id: string, now: number): void
  adoptSyncVersion(record: WireRecord, now: number): SyncStateChange
  syncRecordVersion(
    kind: string,
    id: string
  ): { hlc: string; deviceId: string; deleted: boolean } | null
  syncRecordOrigins(kind: string): Map<string, string>
}

export interface SyncConfigStore {
  availability(): 'ok' | 'no-keychain'
  load(): SyncConfigLoad
  save(config: SyncConfig): void
  clear(): void
}

export interface FetchInit {
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type FetchLike = (
  url: string,
  init: FetchInit
) => Promise<{ status: number; json(): Promise<unknown> }>

export interface SyncEngineDeps {
  store: SyncStoreLike
  config: SyncConfigStore
  fetch: FetchLike
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** The existing forced snapshot (`backup:auto-save` with force); false = failed. */
  forcedBackup: () => Promise<boolean>
  /** Close the database, delete this device's data (wipeLocalData) and relaunch. */
  wipe: () => void
  emitStatus: (status: SyncStatus) => void
  emitRemoteChanges: (change: { generation: number; state: unknown }) => void
  /** Headers added to /setup and revoke; Task 7b fills these with the key proof and TOTP. */
  extraHeaders?: (
    route: 'setup' | 'revoke',
    ctx: { idKey: Uint8Array; factor?: SyncSecondFactor }
  ) => Record<string, string>
}

export interface SyncEngine {
  start(): void
  stop(): void
  notifySaved(): void
  syncNow(): Promise<SyncStatus>
  status(): SyncStatus
  activate(
    url: string,
    setupToken: string,
    deviceName: string,
    factor?: SyncSecondFactor
  ): Promise<{ recoveryCode: string }>
  createInvite(): Promise<{ code: string; expiresAt: number }>
  join(code: string, mode: 'merge' | 'replace', deviceName: string): Promise<SyncStatus>
  devices(): Promise<SyncDevice[]>
  revoke(id: string, wipe: boolean, factor?: SyncSecondFactor): Promise<void>
  conflicts(): SyncConflictView[]
  resolve(conflictId: string, choice: 'local' | 'remote'): void
  recoveryCode(): string
  disable(): Promise<void>
  resume(choice: 'push-local' | 'take-cloud'): Promise<SyncStatus>
  afterRestore(choice: 'propagate' | 'pause'): Promise<SyncStatus>
  fileAvailability(
    files: { id: string; ext: string }[],
    hasBytes: (id: string, ext: string) => boolean
  ): Promise<Record<string, string | null>>
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** An error whose message (pt-BR) is meant for the screen as is. */
export class SyncUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncUserError'
  }
}

/** 2^n·5 s after the n-th consecutive failure, capped at 15 min. */
export function backoffDelay(failures: number): number {
  if (failures <= 0) return POLL_MS
  return Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS)
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('invalid base64url')
  return new Uint8Array(Buffer.from(text, 'base64url'))
}

/** https only (http just for a local `wrangler dev`), no credentials, query or fragment. */
export function normalizeServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new SyncUserError('URL do servidor inválida.')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new SyncUserError('A URL do servidor precisa começar com https://.')
  if (url.username || url.password || url.search || url.hash)
    throw new SyncUserError('URL do servidor inválida.')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function encodePairCode(url: string, syncKey: Uint8Array, invite: string): string {
  return [
    PAIR_PREFIX,
    PAIR_VERSION,
    toBase64Url(new TextEncoder().encode(url)),
    toBase64Url(syncKey),
    invite
  ].join(':')
}

export function parsePairCode(text: string): { url: string; syncKey: Uint8Array; invite: string } {
  const parts = text.trim().split(':')
  if (parts.length !== 5 || parts[0] !== PAIR_PREFIX || parts[1] !== PAIR_VERSION)
    throw new SyncUserError('Código de pareamento inválido.')
  try {
    const url = normalizeServerUrl(Buffer.from(fromBase64Url(parts[2])).toString('utf8'))
    const syncKey = fromBase64Url(parts[3])
    if (syncKey.length !== 32) throw new Error('key')
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(parts[4])) throw new Error('invite')
    return { url, syncKey, invite: parts[4] }
  } catch {
    throw new SyncUserError('Código de pareamento inválido.')
  }
}

/** What a remote wipe deletes, relative to userData. ai-config.json holds no data and stays. */
export function wipeTargets(dev: boolean): string[] {
  if (dev) {
    // Development shares userData with the installed app: only the files with
    // a dev name are its own. files/, backups/ and the rest belong to the app.
    return [
      'kanban-dev.db',
      'kanban-dev.db-wal',
      'kanban-dev.db-shm',
      SYNC_CONFIG_FILE_DEV,
      SYNC_DEVICE_FILE_DEV
    ]
  }
  return [
    'kanban.db',
    'kanban.db-wal',
    'kanban.db-shm',
    'files',
    'task-images',
    'backups',
    'agent-runs',
    SYNC_CONFIG_FILE,
    SYNC_DEVICE_FILE
  ]
}

/**
 * Delete this device's data after a revoke with wipe. No backup first, by
 * decision: the data stays in the cloud and on the other devices. Every path
 * is checked to sit inside userData before it is removed. The sync config and
 * device files go last, and only when everything before them went: a partial
 * wipe keeps the revoked token, so the next launch gets the 401 and finishes it.
 */
export function wipeLocalData(
  userDataDir: string,
  dev: boolean,
  remove: (path: string) => void = (path) => rmSync(path, { recursive: true, force: true })
): { removed: string[]; failed: number } {
  const root = resolve(userDataDir)
  const identity = new Set<string>([
    dev ? SYNC_CONFIG_FILE_DEV : SYNC_CONFIG_FILE,
    dev ? SYNC_DEVICE_FILE_DEV : SYNC_DEVICE_FILE
  ])
  const targets = wipeTargets(dev)
  const ordered = [
    ...targets.filter((name) => !identity.has(name)),
    ...targets.filter((name) => identity.has(name))
  ]
  const removed: string[] = []
  let failed = 0
  for (const name of ordered) {
    if (failed && identity.has(name)) break
    const path = resolve(root, name)
    if (!path.startsWith(root + sep)) continue
    try {
      remove(path)
      removed.push(path)
    } catch {
      failed += 1
    }
  }
  return { removed, failed }
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** The server answered 401: this device's token is no longer valid. */
class SyncAuthError extends Error {
  constructor(readonly wipe: boolean) {
    super('sync unauthorized')
  }
}

/** No answer, a timeout or a 5xx: the device is offline as far as sync goes. */
class SyncOfflineError extends Error {
  constructor(readonly status: number | null) {
    super('sync offline')
  }
}

class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(`sync http ${status}`)
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isPullChange(
  value: unknown
): value is { seq: number; device: string; batchId: string; ciphertext: string } {
  const c = asObject(value)
  return (
    typeof c.seq === 'number' &&
    typeof c.device === 'string' &&
    typeof c.batchId === 'string' &&
    typeof c.ciphertext === 'string'
  )
}

// ── Engine ───────────────────────────────────────────────────────────────────

interface Session {
  config: SyncConfig
  enc: Uint8Array
  idKey: Uint8Array
  opaqueId: string
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { store } = deps
  let session: Session | null = null
  let loadState: SyncConfigLoad['status'] = 'none'
  let started = false
  let disconnected = false
  let wiped = false
  let offline = false
  let failures = 0
  let lastSyncAt: number | null = null
  let pollTimer: unknown = null
  let debounceTimer: unknown = null
  let inflight: Promise<void> | null = null
  let rerun = false
  /** Pairing or a take-cloud is running: the regular cycle stays out of its way. */
  let holding = 0
  let lastEmitted = ''
  const deviceNames = new Map<string, string>()

  const sessionFrom = (config: SyncConfig): Session => {
    const keys = deriveKeys(config.syncKey)
    return {
      config,
      enc: keys.enc,
      idKey: keys.id,
      opaqueId: opaqueDeviceId(keys.id, store.getSyncDeviceId())
    }
  }

  const ctxOf = (s: Session): SyncApplyCtx => ({
    enc: s.enc,
    opaqueId: s.opaqueId,
    now: deps.now()
  })

  const loadSession = (): void => {
    const loaded = deps.config.load()
    loadState = loaded.status
    session = loaded.status === 'ok' ? sessionFrom(loaded.config) : null
    if (loaded.status === 'corrupt') disconnected = true
  }

  // ── status ──

  const status = (): SyncStatus => {
    let state: SyncStateName
    if (!session) {
      if (disconnected) state = 'disconnected'
      else if (loadState === 'no-keychain' || deps.config.availability() !== 'ok')
        state = 'no-keychain'
      else state = 'off'
    } else if (session.config.paused) state = 'paused'
    else if (offline) state = 'offline'
    else state = 'ok'
    const now = deps.now()
    return {
      state,
      lastSyncAt: session ? lastSyncAt : null,
      pendingCount: session ? store.pendingOutgoingCount() : 0,
      paused: session?.config.paused ?? null,
      deviceName: session?.config.deviceName ?? '',
      conflictCount: session ? store.openSyncConflictCount(now) : 0
    }
  }

  const publish = (): SyncStatus => {
    const current = status()
    const text = JSON.stringify(current)
    if (text !== lastEmitted) {
      lastEmitted = text
      deps.emitStatus(current)
    }
    return current
  }

  // ── timers ──

  const clearTimers = (): void => {
    if (pollTimer !== null) deps.clearTimer(pollTimer)
    if (debounceTimer !== null) deps.clearTimer(debounceTimer)
    pollTimer = null
    debounceTimer = null
  }

  const schedule = (ms: number): void => {
    if (pollTimer !== null) deps.clearTimer(pollTimer)
    pollTimer = null
    if (!started || wiped || !session || session.config.paused) return
    pollTimer = deps.setTimer(() => {
      pollTimer = null
      void cycle()
    }, ms)
  }

  // ── HTTP ──

  const request = async (
    base: string,
    path: string,
    init: {
      method: 'GET' | 'POST'
      token?: string
      headers?: Record<string, string>
      body?: unknown
    }
  ): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers }
    if (init.token) headers.authorization = `Bearer ${init.token}`
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    let res: { status: number; json(): Promise<unknown> }
    try {
      res = await deps.fetch(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw new SyncOfflineError(null)
    }
    const body = asObject(await res.json().catch(() => ({})))
    if (res.status === 401) throw new SyncAuthError(body.revoked === true && body.wipe === true)
    if (res.status >= 500) throw new SyncOfflineError(res.status)
    if (res.status < 200 || res.status >= 300) throw new SyncHttpError(res.status, body)
    return body
  }

  const authed = (
    s: Session,
    path: string,
    init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown }
  ): Promise<Record<string, unknown>> =>
    request(s.config.url, path, { ...init, token: s.config.token })

  // ── push / pull ──

  const push = async (s: Session): Promise<number> => {
    const rows = [...store.pendingOutgoing()].sort((a, b) => a.seq - b.seq)
    if (!rows.length) return 0
    // buildOutgoing keeps the seq order, so wire[i] is rows[i].
    const wire = buildOutgoing(rows, store.currentSyncRecords())
    let offset = 0
    const sealed = packBatches(wire).map((batch) => {
      const batchId = randomUUID()
      offset += batch.records.length
      return {
        batchId,
        ciphertext: sealBatch(s.enc, s.opaqueId, batchId, encodeBatch(batch.records)),
        records: batch.records,
        seqMax: rows[offset - 1].seq
      }
    })
    const groups: (typeof sealed)[] = []
    let size = 0
    for (const batch of sealed) {
      const last = groups[groups.length - 1]
      if (last && size + batch.ciphertext.length <= MAX_PUSH_BODY_CHARS) {
        last.push(batch)
        size += batch.ciphertext.length
      } else {
        groups.push([batch])
        size = batch.ciphertext.length
      }
    }
    for (const group of groups) {
      const res = await authed(s, '/push', {
        method: 'POST',
        body: { batches: group.map((b) => ({ batchId: b.batchId, ciphertext: b.ciphertext })) }
      })
      const seqs = res.seqs
      if (
        !Array.isArray(seqs) ||
        seqs.length !== group.length ||
        !seqs.every((n) => typeof n === 'number')
      )
        throw new SyncHttpError(200, {})
      // Marked group by group: a failure later re-sends only what did not go.
      store.markPushed(
        group[group.length - 1].seqMax,
        group.flatMap((b, i) =>
          b.records.map((r) => ({
            kind: r.kind,
            id: r.id,
            hlc: r.hlc,
            serverSeq: seqs[i] as number
          }))
        )
      )
    }
    return rows.length
  }

  /** Every page since `since`; each page is decrypted and handed over with its cursor. */
  const pullPages = async (
    s: Session,
    since: number,
    onPage: (items: IncomingRecord[], cursor: number) => void
  ): Promise<{ batches: number; failed: number }> => {
    let cursor = since
    let batches = 0
    let failed = 0
    for (;;) {
      const res = await authed(s, `/pull?since=${cursor}&limit=${PULL_PAGE_LIMIT}`, {
        method: 'GET'
      })
      const changes = Array.isArray(res.changes) ? res.changes.filter(isPullChange) : []
      const next =
        typeof res.cursor === 'number' && Number.isSafeInteger(res.cursor) ? res.cursor : cursor
      const items: IncomingRecord[] = []
      for (const change of changes) {
        batches += 1
        try {
          // The sender's opaque id is the AAD: a server that swaps it only breaks decryption.
          const records = decodeBatch(
            openBatch(s.enc, change.device, change.batchId, change.ciphertext)
          )
          for (const record of records)
            items.push({ record, device: change.device, serverSeq: change.seq })
        } catch {
          failed += 1
          log.warn('sync', 'decrypt_failed', { seq: change.seq })
        }
      }
      onPage(items, Math.max(cursor, next))
      // A page that does not move the cursor would loop forever.
      if (res.more !== true || next <= cursor) break
      cursor = next
    }
    return { batches, failed }
  }

  const emitChange = (change: SyncStateChange): void => {
    if (change.state !== null)
      deps.emitRemoteChanges({ generation: change.generation, state: change.state })
  }

  const pull = async (s: Session): Promise<number> => {
    const since = Number(store.readSyncState('pull_cursor') ?? 0) || 0
    let applied = 0
    await pullPages(s, since, (items, cursor) => {
      if (items.length) {
        const result = store.applyRemoteRecords(items, ctxOf(s))
        applied += result.applied + result.memories
        emitChange(result)
      }
      store.writeSyncState('pull_cursor', String(cursor))
    })
    return applied
  }

  /** "A nuvem manda": everything from seq 0, then the local syncable data is replaced. */
  const takeCloud = async (s: Session): Promise<void> => {
    const all: IncomingRecord[] = []
    let last = 0
    await pullPages(s, 0, (items, cursor) => {
      all.push(...items)
      last = cursor
    })
    const result = store.replaceWithRemoteRecords(all, ctxOf(s))
    store.writeSyncState('pull_cursor', String(last))
    emitChange(result)
    log.info('sync', 'took_cloud', { records: result.records })
  }

  // ── failure handling ──

  const forget = (): void => {
    clearTimers()
    deps.config.clear()
    session = null
    deviceNames.clear()
  }

  /** Returns true when the failure ended the session (401). */
  const handleFailure = (err: unknown): boolean => {
    if (err instanceof SyncAuthError) {
      if (err.wipe) {
        log.warn('sync', 'remote_wipe')
        wiped = true
        clearTimers()
        session = null
        deps.wipe()
        return true
      }
      log.warn('sync', 'disconnected')
      forget()
      disconnected = true
      return true
    }
    failures += 1
    offline = true
    if (err instanceof SyncOfflineError || err instanceof SyncHttpError)
      log.warn('sync', 'cycle_failed', { status: err.status, failures })
    else
      log.error('sync', 'cycle_error', {
        name: err instanceof Error ? err.name : 'unknown',
        failures
      })
    return false
  }

  // ── cycle ──

  const runOnce = async (): Promise<boolean> => {
    const s = session
    if (!s || s.config.paused || holding || wiped) return false
    const t0 = deps.now()
    try {
      // Received first, then local: "Juntar" applies the cloud by the rule, then sends.
      const pulled = await pull(s)
      const pushed = await push(s)
      failures = 0
      offline = false
      lastSyncAt = deps.now()
      store.writeSyncState('last_sync_at', String(lastSyncAt))
      if (pulled || pushed) log.info('sync', 'cycle', { pulled, pushed, ms: deps.now() - t0 })
      return true
    } catch (err) {
      handleFailure(err)
      return false
    }
  }

  const cycle = (): Promise<void> => {
    if (inflight) {
      rerun = true
      return inflight
    }
    inflight = (async (): Promise<void> => {
      let ok = true
      do {
        rerun = false
        ok = await runOnce()
      } while (ok && rerun)
    })().finally(() => {
      inflight = null
      if (!wiped) {
        schedule(failures ? backoffDelay(failures) : POLL_MS)
        publish()
      }
    })
    return inflight
  }

  /** Run a pairing step alone: the regular cycle waits, then resumes. */
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    holding += 1
    try {
      if (inflight) await inflight
      return await fn()
    } finally {
      holding -= 1
    }
  }

  const requireSession = (): Session => {
    if (!session) throw new SyncUserError('A sincronização não está ativa.')
    return session
  }

  const saveConfig = (s: Session, patch: Partial<SyncConfig>): void => {
    s.config = { ...s.config, ...patch }
    deps.config.save(s.config)
  }

  const nameCipher = (enc: Uint8Array, opaqueId: string, name: string): string =>
    sealBatch(enc, opaqueId, DEVICE_NAME_BATCH, new TextEncoder().encode(name))

  /** Errors of an action the user started: a message for the screen, never a wipe. */
  const userError = (err: unknown, fallback: string): SyncUserError => {
    if (err instanceof SyncUserError) return err
    if (err instanceof SyncOfflineError)
      return new SyncUserError('Sem conexão com o servidor de sincronização.')
    if (err instanceof SyncAuthError) return new SyncUserError('O servidor recusou o acesso.')
    if (err instanceof SyncHttpError && err.status === 410)
      return new SyncUserError('O convite expirou ou já foi usado.')
    return new SyncUserError(fallback)
  }

  const resetCursors = (): void => {
    store.writeSyncState('pull_cursor', '0')
    // Everything this device minted goes up again (the server drops nothing; the rule skips equals).
    store.writeSyncState('pushed_seq', '0')
  }

  const refreshDevices = async (s: Session): Promise<SyncDevice[]> => {
    const res = await authed(s, '/devices', { method: 'GET' })
    const list = Array.isArray(res.devices) ? res.devices.map(asObject) : []
    const devices = list
      .filter((d) => typeof d.id === 'string')
      .map((d): SyncDevice => {
        const id = d.id as string
        let name = UNKNOWN_DEVICE
        try {
          if (typeof d.nameCipher === 'string')
            name = new TextDecoder().decode(openBatch(s.enc, id, DEVICE_NAME_BATCH, d.nameCipher))
        } catch {
          // Another key or a tampered name: shown as unknown.
        }
        return {
          id,
          name,
          lastSeen: typeof d.lastSeen === 'number' ? d.lastSeen : 0,
          revokedAt: typeof d.revokedAt === 'number' ? d.revokedAt : null,
          wipe: d.wipe === true,
          current: d.current === true
        }
      })
    deviceNames.clear()
    for (const d of devices) deviceNames.set(d.id, d.name)
    return devices
  }

  const nameOf = (s: Session | null, device: string | null): string => {
    if (!device) return UNKNOWN_DEVICE
    if (device === store.getSyncDeviceId() || (s && device === s.opaqueId))
      return s?.config.deviceName || 'este aparelho'
    return deviceNames.get(device) ?? UNKNOWN_DEVICE
  }

  const versionView = (
    s: Session,
    record: WireRecord | null,
    hlc: string | null,
    device: string | null
  ): SyncVersionView => ({
    hlc,
    at: hlc ? (parseHlc(hlc)?.ms ?? null) : null,
    deviceName: nameOf(s, device),
    deleted: !record || record.deleted,
    payload: record && !record.deleted && record.payload ? record.payload : null
  })

  const openConflict = (s: Session, row: SyncConflictRow): WireRecord | null => {
    try {
      const [loser] = decodeBatch(
        openBatch(s.enc, s.opaqueId, `conflict:${row.id}`, row.loserCipher)
      )
      return loser ?? null
    } catch {
      return null
    }
  }

  const localSide = (s: Session, row: SyncConflictRow): 'kept-is-local' | 'current-is-local' =>
    row.loserDevice === store.getSyncDeviceId() || row.loserDevice === s.opaqueId
      ? 'kept-is-local'
      : 'current-is-local'

  const notifySaved = (): void => {
    if (!started || !session || session.config.paused || wiped) return
    if (debounceTimer !== null) deps.clearTimer(debounceTimer)
    debounceTimer = deps.setTimer(() => {
      debounceTimer = null
      // While backing off, a save does not shorten the wait.
      if (!failures) void cycle()
    }, PUSH_DEBOUNCE_MS)
    publish()
  }

  // ── API ──

  return {
    start(): void {
      if (started) return
      started = true
      loadSession()
      if (session) {
        const saved = Number(store.readSyncState('last_sync_at'))
        lastSyncAt = Number.isFinite(saved) && saved > 0 ? saved : null
        schedule(0)
      }
      publish()
    },

    stop(): void {
      started = false
      clearTimers()
    },

    notifySaved,

    async syncNow(): Promise<SyncStatus> {
      if (session && !session.config.paused) {
        failures = 0
        await cycle()
      }
      return publish()
    },

    status,

    async activate(url, setupToken, deviceName, factor): Promise<{ recoveryCode: string }> {
      if (session) throw new SyncUserError('A sincronização já está ativa neste aparelho.')
      if (deps.config.availability() !== 'ok')
        throw new SyncUserError(
          'O chaveiro do sistema não está disponível; a sincronização não liga.'
        )
      const base = normalizeServerUrl(url)
      const name = deviceName.trim().slice(0, 80) || 'Aparelho'
      return exclusive(async () => {
        const syncKey = newSyncKey()
        const keys = deriveKeys(syncKey)
        const opaqueId = opaqueDeviceId(keys.id, store.getSyncDeviceId())
        let res: Record<string, unknown>
        try {
          res = await request(base, '/setup', {
            method: 'POST',
            headers: {
              'x-setup-token': setupToken,
              ...deps.extraHeaders?.('setup', { idKey: keys.id, factor })
            },
            body: { deviceId: opaqueId, nameCipher: nameCipher(keys.enc, opaqueId, name) }
          })
        } catch (err) {
          throw userError(err, 'Não foi possível ativar a sincronização.')
        }
        if (typeof res.token !== 'string') throw new SyncUserError('Resposta inválida do servidor.')
        const config: SyncConfig = {
          url: base,
          syncKey,
          token: res.token,
          deviceName: name,
          paused: null
        }
        deps.config.save(config)
        resetCursors()
        session = sessionFrom(config)
        disconnected = false
        loadState = 'ok'
        log.info('sync', 'activated')
        return { recoveryCode: toRecoveryCode(syncKey, base) }
      }).finally(() => {
        if (session && started) schedule(0)
        publish()
      })
    },

    async createInvite(): Promise<{ code: string; expiresAt: number }> {
      const s = requireSession()
      const invite = toBase64Url(new Uint8Array(randomBytes(32)))
      const inviteHash = createHash('sha256').update(invite, 'utf8').digest('hex')
      let res: Record<string, unknown>
      try {
        res = await authed(s, '/invites', { method: 'POST', body: { inviteHash } })
      } catch (err) {
        if (err instanceof SyncAuthError) {
          handleFailure(err)
          publish()
        }
        throw userError(err, 'Não foi possível criar o convite.')
      }
      return {
        code: encodePairCode(s.config.url, s.config.syncKey, invite),
        expiresAt: typeof res.expiresAt === 'number' ? res.expiresAt : deps.now() + 600000
      }
    },

    async join(code, mode, deviceName): Promise<SyncStatus> {
      if (session) throw new SyncUserError('A sincronização já está ativa neste aparelho.')
      if (deps.config.availability() !== 'ok')
        throw new SyncUserError(
          'O chaveiro do sistema não está disponível; a sincronização não liga.'
        )
      const { url, syncKey, invite } = parsePairCode(code)
      const name = deviceName.trim().slice(0, 80) || 'Aparelho'
      await exclusive(async () => {
        // The backup comes before the invite is spent: if it fails, nothing changed.
        if (mode === 'replace' && !(await deps.forcedBackup()))
          throw new SyncUserError(
            'Não foi possível fazer o backup antes de substituir. Nada foi alterado.'
          )
        const keys = deriveKeys(syncKey)
        const opaqueId = opaqueDeviceId(keys.id, store.getSyncDeviceId())
        let res: Record<string, unknown>
        try {
          res = await request(url, '/pair', {
            method: 'POST',
            body: { invite, deviceId: opaqueId, nameCipher: nameCipher(keys.enc, opaqueId, name) }
          })
        } catch (err) {
          throw userError(err, 'Não foi possível parear este aparelho.')
        }
        if (typeof res.token !== 'string') throw new SyncUserError('Resposta inválida do servidor.')
        // A replace that cannot finish now stays paused as 'join': the next
        // regular cycle must never merge (and push) what was meant to be replaced.
        const config: SyncConfig = {
          url,
          syncKey,
          token: res.token,
          deviceName: name,
          paused: mode === 'replace' ? 'join' : null
        }
        deps.config.save(config)
        resetCursors()
        const s = sessionFrom(config)
        session = s
        disconnected = false
        loadState = 'ok'
        log.info('sync', 'paired', { mode })
        if (mode === 'replace') {
          try {
            await takeCloud(s)
            saveConfig(s, { paused: null })
          } catch (err) {
            handleFailure(err)
          }
        }
      })
      // Assigned inside the closure above, which TypeScript's narrowing does not see.
      const joined = session as Session | null
      if (joined && !joined.config.paused) await cycle()
      return publish()
    },

    async devices(): Promise<SyncDevice[]> {
      const s = requireSession()
      try {
        return await refreshDevices(s)
      } catch (err) {
        if (err instanceof SyncAuthError) {
          handleFailure(err)
          publish()
        }
        throw userError(err, 'Não foi possível listar os aparelhos.')
      }
    },

    async revoke(id, wipe, factor): Promise<void> {
      const s = requireSession()
      if (!/^[0-9a-f]{32}$/.test(id)) throw new SyncUserError('Aparelho inválido.')
      if (id === s.opaqueId)
        throw new SyncUserError('Para este aparelho, use "Desativar sincronização".')
      try {
        await authed(s, `/devices/${id}/revoke`, {
          method: 'POST',
          headers: deps.extraHeaders?.('revoke', { idKey: s.idKey, factor }),
          body: { wipe }
        })
      } catch (err) {
        if (err instanceof SyncAuthError) {
          handleFailure(err)
          publish()
        }
        throw userError(err, 'Não foi possível revogar o aparelho.')
      }
      log.info('sync', 'revoked', { wipe })
      await refreshDevices(s).catch(() => undefined)
    },

    conflicts(): SyncConflictView[] {
      const s = requireSession()
      const rows = store.listSyncConflicts(deps.now())
      if (!rows.length) return []
      const current = store.currentSyncRecords()
      return rows.map((row) => {
        const kept = openConflict(s, row)
        const version = store.syncRecordVersion(row.kind, row.recordId)
        const live = current.get(recordKey(row.kind, row.recordId))
        const currentWire: WireRecord | null = live
          ? {
              kind: row.kind,
              id: row.recordId,
              hlc: version?.hlc ?? '',
              baseHlc: null,
              deleted: false,
              payload: live.payload
            }
          : null
        const keptView = versionView(s, kept, row.loserHlc, row.loserDevice)
        const currentView = versionView(
          s,
          currentWire,
          version?.hlc ?? null,
          version?.deviceId ?? null
        )
        const keptIsLocal = localSide(s, row) === 'kept-is-local'
        return {
          id: row.id,
          type: row.type,
          kind: row.kind,
          recordId: row.recordId,
          createdAt: row.createdAt,
          local: keptIsLocal ? keptView : currentView,
          remote: keptIsLocal ? currentView : keptView
        }
      })
    },

    resolve(conflictId, choice): void {
      const s = requireSession()
      const now = deps.now()
      const row = store.listSyncConflicts(now).find((c) => c.id === conflictId)
      if (!row) throw new SyncUserError('Conflito não encontrado.')
      const keptIsLocal = localSide(s, row) === 'kept-is-local'
      const adoptKept = (choice === 'local') === keptIsLocal
      if (adoptKept) {
        if (row.type === 'orphan')
          throw new SyncUserError('O item de origem foi apagado; só dá para dispensar.')
        const kept = openConflict(s, row)
        if (!kept) throw new SyncUserError('Não foi possível ler a versão guardada.')
        try {
          emitChange(store.adoptSyncVersion(kept, now))
        } catch (err) {
          log.warn('sync', 'adopt_failed', { name: err instanceof Error ? err.name : 'unknown' })
          throw new SyncUserError('Não foi possível usar esta versão.')
        }
      }
      store.markSyncConflictResolved(conflictId, now)
      log.info('sync', 'conflict_resolved', { adopted: adoptKept })
      if (adoptKept) notifySaved()
      publish()
    },

    recoveryCode(): string {
      const s = requireSession()
      return toRecoveryCode(s.config.syncKey, s.config.url)
    },

    async disable(): Promise<void> {
      const s = session
      if (s) {
        // Best effort: a device that stays registered holds the server's cleanup back.
        await exclusive(() =>
          authed(s, `/devices/${s.opaqueId}/revoke`, {
            method: 'POST',
            headers: deps.extraHeaders?.('revoke', { idKey: s.idKey }),
            body: { wipe: false }
          }).catch((err) => log.warn('sync', 'self_revoke_failed', { msg: errorMessage(err) }))
        )
      }
      forget()
      disconnected = false
      offline = false
      failures = 0
      resetCursors()
      log.info('sync', 'disabled')
      publish()
    },

    async resume(choice): Promise<SyncStatus> {
      const s = requireSession()
      if (choice === 'take-cloud') {
        if (!(await deps.forcedBackup()))
          throw new SyncUserError(
            'Não foi possível fazer o backup antes de baixar da nuvem. Nada foi alterado.'
          )
        try {
          await exclusive(() => takeCloud(s))
        } catch (err) {
          const ended = handleFailure(err)
          publish()
          if (!ended) throw userError(err, 'Não foi possível baixar da nuvem.')
          return status()
        }
      } else {
        store.writeSyncState('pushed_seq', '0')
      }
      saveConfig(s, { paused: null })
      failures = 0
      await cycle()
      return publish()
    },

    async afterRestore(choice): Promise<SyncStatus> {
      const s = session
      if (!s) return publish()
      if (choice === 'pause') {
        clearTimers()
        saveConfig(s, { paused: 'restore' })
        log.info('sync', 'paused', { reason: 'restore' })
        return publish()
      }
      // The restore's own capture already minted new versions: just send them.
      failures = 0
      await cycle()
      return publish()
    },

    async fileAvailability(files, hasBytes): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {}
      const missing = files.filter((f) => !hasBytes(f.id, f.ext))
      for (const f of files) out[f.id] = null
      if (!missing.length) return out
      const origins = store.syncRecordOrigins('file')
      const s = session
      if (s && !deviceNames.size) await refreshDevices(s).catch(() => undefined)
      for (const f of missing) {
        const origin = origins.get(f.id)
        // Minted here (bytes lost locally) or unknown: no other device to point at.
        if (!origin || origin === store.getSyncDeviceId()) continue
        out[f.id] = nameOf(s, origin)
      }
      return out
    }
  }
}

/** The sync config file name, split like the database between dev and the installed app. */
export function syncConfigFileName(dev: boolean): string {
  return dev ? SYNC_CONFIG_FILE_DEV : SYNC_CONFIG_FILE
}
