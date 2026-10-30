// @vitest-environment node
//
// The sync engine end to end, with every effect faked: an in-memory server
// with the Worker's routes and answers, a store built on the same pure
// functions store.ts uses (capture, conflict rule, rebuild), a manual clock
// and an in-memory config. Two engines over one server must converge, a
// network failure must never be taken for a revocation, and nothing readable
// may reach the server.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const logged = vi.hoisted(() => [] as { level: string; event: string; data?: unknown }[])
vi.mock('../modules/logs/logger', () => ({
  log: {
    info: (_area: string, event: string, data?: unknown) =>
      logged.push({ level: 'info', event, data }),
    warn: (_area: string, event: string, data?: unknown) =>
      logged.push({ level: 'warn', event, data }),
    error: (_area: string, event: string, data?: unknown) =>
      logged.push({ level: 'error', event, data })
  },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err))
}))

import {
  backoffDelay,
  createSyncEngine,
  encodePairCode,
  MAX_BACKOFF_MS,
  parsePairCode,
  POLL_MS,
  PUSH_DEBOUNCE_MS,
  wipeLocalData,
  wipeTargets,
  type FetchInit,
  type SyncApplyCtx,
  type SyncConflictRow,
  type SyncEngine,
  type SyncStatus,
  type SyncStoreLike
} from '../modules/sync/sync-engine'
import type { SyncConfig, SyncConfigLoad } from '../modules/sync/sync-config'
import {
  applyRecordsToState,
  planRemoteApply,
  type IncomingRecord,
  type StoredSyncVersion,
  type SyncableState
} from '../modules/sync/sync-apply'
import {
  encodeBatch,
  recordKey,
  type OutgoingRow,
  type WireRecord
} from '../modules/sync/sync-batch'
import { deriveKeys, keyProof, sealBatch } from '../modules/sync/sync-crypto'
import { buildSyncRows, planSyncChanges } from '../modules/sync/sync-plan'
import { latestVersions, replaceSyncableState } from '../modules/sync/sync-replace'
import {
  DATA_KINDS,
  extractDataRecords,
  hashPayload,
  type SyncRecord
} from '../modules/sync/sync-records'

type Row = Record<string, unknown>

const T = '2026-10-30T12:00:00.000Z'
const SERVER_URL = 'https://sync.example.workers.dev'
const SETUP = 'segredo-de-setup'

// ── Manual clock ─────────────────────────────────────────────────────────────

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}

class Clock {
  t = 1_800_000_000_000
  private nextId = 1
  timers: { id: number; at: number; ms: number; fn: () => void }[] = []
  now = (): number => this.t
  set = (fn: () => void, ms: number): number => {
    const id = this.nextId++
    this.timers.push({ id, at: this.t + ms, ms, fn })
    return id
  }
  clear = (id: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== id)
  }
  /** Delay of every pending timer, for asserting the schedule. */
  pending(): number[] {
    return this.timers.map((t) => t.ms)
  }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms
    for (;;) {
      await flush()
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.t = due.at
      this.timers = this.timers.filter((t) => t !== due)
      due.fn()
    }
    this.t = end
    await flush()
  }
}

// ── Fake server: the Worker's routes and answers ──────────────────────────────

interface FakeDevice {
  id: string
  token: string
  nameCipher: string
  revoked: boolean
  wipe: boolean
  cursor: number
}

class FakeServer {
  devices: FakeDevice[] = []
  invites = new Set<string>()
  changes: { seq: number; device: string; batchId: string; ciphertext: string }[] = []
  /** Every request as sent: URL, headers and body, for the leak test. */
  requests: { url: string; init: FetchInit }[] = []
  mode: 'up' | 'down' | 'error500' | 'unauthorized' = 'up'
  private seq = 0
  snapshot: { id: string; seqUntil: number; device: string; parts: string[] } | null = null
  pendingParts = new Map<string, { device: string; parts: Map<number, string> }>()

  pushes(): number {
    return this.requests.filter((r) => r.url.endsWith('/push')).length
  }

  injectChange(device: string, batchId: string, ciphertext: string): void {
    this.changes.push({ seq: ++this.seq, device, batchId, ciphertext })
  }

  fetch = async (
    url: string,
    init: FetchInit
  ): Promise<{ status: number; json(): Promise<unknown> }> => {
    this.requests.push({ url, init })
    if (this.mode === 'down') throw new TypeError('fetch failed')
    const reply = (
      status: number,
      body: unknown
    ): { status: number; json(): Promise<unknown> } => ({
      status,
      json: async () => body
    })
    if (this.mode === 'error500') return reply(500, { error: 'internal error' })
    if (this.mode === 'unauthorized') return reply(401, { error: 'invalid factor' })
    const u = new URL(url)
    const body = init.body ? (JSON.parse(init.body) as Row) : {}
    const register = (
      id: string,
      nameCipher: string
    ): { status: number; json(): Promise<unknown> } => {
      const token = randomUUID().replace(/-/g, '')
      this.devices = this.devices.filter((d) => d.id !== id)
      this.devices.push({ id, token, nameCipher, revoked: false, wipe: false, cursor: 0 })
      return reply(200, { token })
    }
    if (u.pathname === '/setup') {
      if (init.headers['x-setup-token'] !== SETUP) return reply(401, { error: 'unauthorized' })
      return register(String(body.deviceId), String(body.nameCipher))
    }
    if (u.pathname === '/pair') {
      const hash = createHash('sha256').update(String(body.invite), 'utf8').digest('hex')
      if (!this.invites.delete(hash)) return reply(410, { error: 'invite expired or used' })
      return register(String(body.deviceId), String(body.nameCipher))
    }
    const auth = /^Bearer (.+)$/.exec(init.headers.authorization ?? '')
    const me = auth ? this.devices.find((d) => d.token === auth[1]) : undefined
    if (!me) return reply(401, { error: 'unauthorized' })
    if (me.revoked) return reply(401, { revoked: true, wipe: me.wipe })
    if (u.pathname === '/invites') {
      this.invites.add(String(body.inviteHash))
      return reply(200, { expiresAt: 0 })
    }
    if (u.pathname === '/totp/enroll')
      return reply(200, { uri: 'otpauth://totp/Sagyou?secret=AAAAAAAA&issuer=Sagyou' })
    if (u.pathname === '/totp/confirm') return reply(200, { backupCodes: ['ABCDEF0123456789'] })
    if (u.pathname === '/push') {
      const seqs = (body.batches as Row[]).map((b) => {
        this.changes.push({
          seq: ++this.seq,
          device: me.id,
          batchId: String(b.batchId),
          ciphertext: String(b.ciphertext)
        })
        return this.seq
      })
      return reply(200, { seqs })
    }
    if (u.pathname === '/pull') {
      const since = Number(u.searchParams.get('since'))
      const limit = Number(u.searchParams.get('limit'))
      const rows = this.changes.filter((c) => c.seq > since && c.device !== me.id)
      const more = rows.length > limit
      const page = rows.slice(0, limit)
      const cursor = more ? page[page.length - 1].seq : this.seq
      me.cursor = cursor
      return reply(200, { changes: page, more, cursor })
    }
    if (u.pathname === '/devices') {
      return reply(200, {
        devices: this.devices.map((d) => ({
          id: d.id,
          nameCipher: d.nameCipher,
          lastSeen: 0,
          revokedAt: d.revoked ? 1 : null,
          wipe: d.wipe,
          cursor: d.cursor,
          current: d.id === me.id
        }))
      })
    }
    if (u.pathname === '/snapshot' && init.method === 'GET') {
      if (!this.snapshot) return reply(404, { error: 'no snapshot' })
      return reply(200, {
        snapshotId: this.snapshot.id,
        seqUntil: this.snapshot.seqUntil,
        device: this.snapshot.device,
        parts: this.snapshot.parts.length
      })
    }
    if (u.pathname === '/snapshot/parts' && init.method === 'POST') {
      const id = String(body.snapshotId)
      const pending = this.pendingParts.get(id) ?? {
        device: me.id,
        parts: new Map<number, string>()
      }
      pending.parts.set(Number(body.index), String(body.ciphertext))
      this.pendingParts.set(id, pending)
      return reply(200, { ok: true })
    }
    if (u.pathname === '/snapshot/commit' && init.method === 'POST') {
      const pending = this.pendingParts.get(String(body.snapshotId))
      if (!pending || pending.parts.size !== Number(body.parts))
        return reply(409, { error: 'incomplete' })
      this.snapshot = {
        id: String(body.snapshotId),
        seqUntil: Number(body.seqUntil),
        device: pending.device,
        parts: [...pending.parts].sort((a, b) => a[0] - b[0]).map((item) => item[1])
      }
      return reply(200, { ok: true })
    }
    const part = /^\/snapshot\/parts\/(\d+)$/.exec(u.pathname)
    if (part && init.method === 'GET' && this.snapshot)
      return reply(200, { ciphertext: this.snapshot.parts[Number(part[1])] })
    const revoke = /^\/devices\/([0-9a-f]{32})\/revoke$/.exec(u.pathname)
    if (revoke) {
      const target = this.devices.find((d) => d.id === revoke[1])
      if (!target) return reply(404, { error: 'not found' })
      target.revoked = true
      target.wipe = body.wipe === true
      return reply(200, { ok: true })
    }
    return reply(404, { error: 'not found' })
  }
}

// ── Fake store: the same pure rules store.ts runs, without SQLite ─────────────

interface State extends SyncableState {
  projects: Row[]
  tasks: Row[]
  sprints: Row[]
  notes: Row[]
  goals: Row[]
  habits: Row[]
  lists: Row[]
  files: Row[]
  financialProfiles: Row[]
}

interface Version extends StoredSyncVersion {
  kind: SyncRecord['kind']
  id: string
  seq: number
  serverSeq: number | null
}

const emptyState = (): State => ({
  projects: [],
  tasks: [],
  sprints: [],
  notes: [],
  goals: [],
  habits: [],
  lists: [],
  files: [],
  financialProfiles: []
})

class FakeStore implements SyncStoreLike {
  state: State = emptyState()
  versions = new Map<string, Version>()
  kv = new Map<string, string>()
  conflicts: (SyncConflictRow & { resolvedAt: number | null })[] = []
  pending: IncomingRecord[] = []
  seq = 0
  generation = 0

  constructor(
    readonly deviceId: string,
    readonly now: () => number
  ) {}

  /** A local save, captured like store.saveData. */
  save(next: State): void {
    this.state = structuredClone(next)
    this.capture()
  }

  private capture(): void {
    const stored = [...this.versions.values()].map((v) => ({
      kind: v.kind,
      id: v.id,
      hash: v.hash,
      deleted: v.deleted
    }))
    const plan = planSyncChanges(extractDataRecords(this.state), stored, {
      kinds: DATA_KINDS,
      complete: true
    })
    let maxHlc: string | null = null
    for (const v of this.versions.values()) if (maxHlc === null || v.hlc > maxHlc) maxHlc = v.hlc
    for (const row of buildSyncRows(
      plan,
      { maxHlc, maxSeq: this.seq },
      this.deviceId,
      this.now()
    )) {
      const key = recordKey(row.kind, row.id)
      this.versions.set(key, {
        kind: row.kind,
        id: row.id,
        hlc: row.hlc,
        hash: row.hash,
        deleted: row.deleted,
        deviceId: this.deviceId,
        baseHlc: this.versions.get(key)?.hlc ?? null,
        seq: row.seq,
        serverSeq: null
      })
      this.seq = row.seq
    }
  }

  getSyncDeviceId(): string {
    return this.deviceId
  }

  pendingOutgoing(): OutgoingRow[] {
    const pushed = Number(this.kv.get('pushed_seq') ?? 0)
    return [...this.versions.values()]
      .filter((v) => v.deviceId === this.deviceId && v.seq > pushed)
      .sort((a, b) => a.seq - b.seq)
      .map((v) => ({
        kind: v.kind,
        id: v.id,
        hlc: v.hlc,
        baseHlc: v.baseHlc,
        deleted: v.deleted,
        seq: v.seq
      }))
  }

  pendingOutgoingCount(): number {
    return this.pendingOutgoing().length
  }

  snapshotRecords(): WireRecord[] {
    const current = this.currentSyncRecords()
    return [...this.versions.values()].map((v) => ({
      kind: v.kind,
      id: v.id,
      hlc: v.hlc,
      baseHlc: v.baseHlc,
      deleted: v.deleted,
      ...(v.deleted ? {} : { payload: current.get(recordKey(v.kind, v.id))?.payload })
    }))
  }

  pruneSyncTombstones(minCursor: number, nowMs: number): number {
    let count = 0
    for (const [key, v] of this.versions) {
      if (
        v.deleted &&
        v.serverSeq !== null &&
        v.serverSeq <= minCursor &&
        Number(v.hlc.slice(0, 15)) < nowMs - 90 * 86400000
      ) {
        this.versions.delete(key)
        count++
      }
    }
    return count
  }

  markPushed(
    seqLocalMax: number,
    serverSeqs: { kind: string; id: string; hlc: string; serverSeq: number }[]
  ): void {
    for (const s of serverSeqs) {
      const v = this.versions.get(recordKey(s.kind, s.id))
      if (v && v.hlc === s.hlc) v.serverSeq = s.serverSeq
    }
    if (seqLocalMax > Number(this.kv.get('pushed_seq') ?? 0))
      this.kv.set('pushed_seq', String(seqLocalMax))
  }

  currentSyncRecords(): Map<string, SyncRecord> {
    return new Map(extractDataRecords(this.state).map((r) => [recordKey(r.kind, r.id), r]))
  }

  private writeVersions(
    list: {
      kind: SyncRecord['kind']
      id: string
      hlc: string
      baseHlc: string | null
      deviceId: string
      hash: string
      deleted: boolean
      serverSeq: number | null
    }[]
  ): void {
    for (const v of list) {
      this.seq += 1
      this.versions.set(recordKey(v.kind, v.id), { ...v, seq: this.seq })
    }
  }

  applyRemoteRecords(
    records: IncomingRecord[],
    ctx: SyncApplyCtx
  ): {
    applied: number
    memories: number
    conflicts: number
    pending: number
    generation: number
    state: unknown | null
  } {
    const items = [...this.pending, ...records]
    this.pending = []
    const stored = new Map<string, StoredSyncVersion>(
      [...this.versions.entries()].map(([k, v]) => [
        k,
        { hlc: v.hlc, hash: v.hash, deleted: v.deleted, deviceId: v.deviceId, baseHlc: v.baseHlc }
      ])
    )
    const plan = planRemoteApply(this.state, items, stored)
    this.state = plan.state
    this.writeVersions(plan.versions)
    for (const c of plan.conflicts) {
      const id = randomUUID()
      this.conflicts.push({
        id,
        kind: c.kind,
        recordId: c.recordId,
        type: c.type,
        loserCipher: sealBatch(ctx.enc, ctx.opaqueId, `conflict:${id}`, encodeBatch([c.loser])),
        winnerHlc: c.winnerHlc,
        loserHlc: c.loserHlc,
        loserDevice: c.loserDevice,
        createdAt: this.now(),
        resolvedAt: null
      })
    }
    this.pending = plan.pending
    if (plan.applied.length) this.generation += 1
    return {
      applied: plan.applied.length,
      memories: 0,
      conflicts: plan.conflicts.length,
      pending: plan.pending.length,
      generation: this.generation,
      state: plan.applied.length ? this.state : null
    }
  }

  replaceWithRemoteRecords(records: IncomingRecord[]): {
    generation: number
    state: unknown | null
    records: number
  } {
    const latest = latestVersions(records)
    this.state = replaceSyncableState(
      this.state,
      latest.map((i) => i.record)
    )
    this.versions.clear()
    this.pending = []
    this.writeVersions(
      latest.map((i) => ({
        kind: i.record.kind,
        id: i.record.id,
        hlc: i.record.hlc,
        baseHlc: i.record.baseHlc,
        deviceId: i.device,
        hash: i.record.payload ? hashPayload(i.record.payload) : '',
        deleted: i.record.deleted,
        serverSeq: i.serverSeq
      }))
    )
    this.generation += 1
    return { generation: this.generation, state: this.state, records: latest.length }
  }

  readSyncState(key: string): string | null {
    return this.kv.get(key) ?? null
  }

  writeSyncState(key: string, value: string): void {
    this.kv.set(key, value)
  }

  listSyncConflicts(): SyncConflictRow[] {
    return this.conflicts.filter((c) => c.resolvedAt === null)
  }

  openSyncConflictCount(): number {
    return this.listSyncConflicts().length
  }

  markSyncConflictResolved(id: string, now: number): void {
    const c = this.conflicts.find((x) => x.id === id)
    if (c) c.resolvedAt = now
  }

  adoptSyncVersion(record: WireRecord): { generation: number; state: unknown | null } {
    this.save(applyRecordsToState(this.state, [record]))
    this.generation += 1
    return { generation: this.generation, state: this.state }
  }

  syncRecordVersion(
    kind: string,
    id: string
  ): { hlc: string; deviceId: string; deleted: boolean } | null {
    const v = this.versions.get(recordKey(kind, id))
    return v ? { hlc: v.hlc, deviceId: v.deviceId, deleted: v.deleted } : null
  }

  syncRecordOrigins(kind: string): Map<string, string> {
    return new Map(
      [...this.versions.values()].filter((v) => v.kind === kind).map((v) => [v.id, v.deviceId])
    )
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const project = (id: string, name: string): Row => ({
  id,
  name,
  color: '#6366f1',
  order: 0,
  createdAt: T,
  updatedAt: T,
  columns: [{ id: `${id}-col`, name: 'Backlog', order: 0 }],
  links: []
})

const task = (id: string, projectId: string, title: string): Row => ({
  id,
  projectId,
  columnId: `${projectId}-col`,
  title,
  priority: 'medium',
  tags: [],
  order: 0,
  createdAt: T,
  updatedAt: T
})

const table = (id: string, amount: string): Row => ({
  id,
  name: 'Conta',
  currency: 'BRL',
  profileId: 'personal',
  createdAt: T,
  updatedAt: T,
  items: [],
  transactions: [
    { id: `${id}-tx`, description: 'Aluguel secreto', amount, type: 'expense', date: '2026-10-01' }
  ],
  goals: [],
  debts: [],
  yieldSources: [],
  yieldEntries: []
})

const withData = (patch: Partial<State>): State => ({ ...emptyState(), ...patch })

const dataHashes = (store: FakeStore): string[] =>
  extractDataRecords(store.state)
    .map((r) => `${recordKey(r.kind, r.id)}=${r.hash}`)
    .sort()

// ── Device harness ───────────────────────────────────────────────────────────

interface Device {
  store: FakeStore
  engine: SyncEngine
  config: { stored: SyncConfig | null }
  statuses: SyncStatus[]
  remote: { generation: number; state: unknown }[]
  wipe: Mock<() => void>
  backup: Mock<() => Promise<boolean>>
}

function device(server: FakeServer, clock: Clock, localId: string): Device {
  const store = new FakeStore(localId, clock.now)
  const config: { stored: SyncConfig | null } = { stored: null }
  const statuses: SyncStatus[] = []
  const remote: { generation: number; state: unknown }[] = []
  const wipe = vi.fn<() => void>()
  const backup = vi.fn<() => Promise<boolean>>(async () => true)
  const engine = createSyncEngine({
    store,
    config: {
      availability: () => 'ok',
      load: (): SyncConfigLoad =>
        config.stored ? { status: 'ok', config: config.stored } : { status: 'none' },
      save: (c) => {
        config.stored = structuredClone(c)
      },
      clear: () => {
        config.stored = null
      }
    },
    fetch: server.fetch,
    now: clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    forcedBackup: backup,
    wipe,
    emitStatus: (s) => statuses.push(s),
    emitRemoteChanges: (c) => remote.push(c)
  })
  engine.start()
  return { store, engine, config, statuses, remote, wipe, backup }
}

const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)

let clock: Clock
let server: FakeServer

beforeEach(() => {
  clock = new Clock()
  server = new FakeServer()
  logged.length = 0
})

/** A active with its data, B paired by an invite (merge). */
async function pairedDevices(
  dataA: State,
  dataB: State = emptyState()
): Promise<{ a: Device; b: Device }> {
  const a = device(server, clock, ID_A)
  a.store.save(dataA)
  await a.engine.activate(SERVER_URL, SETUP, 'PC de casa')
  await clock.advance(0)
  const b = device(server, clock, ID_B)
  b.store.save(dataB)
  const { code } = await a.engine.createInvite()
  await b.engine.join(code, 'merge', 'PC do trabalho')
  await clock.advance(0)
  return { a, b }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pareamento e convergência', () => {
  it('recupera com a mesma chave e envia a prova mais o segundo fator', async () => {
    const { a } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const c = device(server, clock, 'c'.repeat(32))
    await c.engine.recover(a.engine.recoveryCode(), SETUP, 'PC novo', { totp: '123456' })
    expect(
      Buffer.from(c.config.stored!.syncKey).equals(Buffer.from(a.config.stored!.syncKey))
    ).toBe(true)
    const request = server.requests.findLast((r) => r.url.endsWith('/setup'))
    expect(request?.init.headers['x-key-proof']).toBe(
      keyProof(deriveKeys(a.config.stored!.syncKey).id)
    )
    expect(request?.init.headers['x-totp-code']).toBe('123456')
  })

  it('push seguido de pull entre dois motores sobre o mesmo servidor converge', async () => {
    const { a, b } = await pairedDevices(
      withData({ projects: [project('p1', 'Casa')], tasks: [task('t1', 'p1', 'Lavar')] })
    )
    // B got A's data on join.
    expect(dataHashes(b.store)).toEqual(dataHashes(a.store))
    expect(b.remote.length).toBeGreaterThan(0)

    // An edit on B reaches A on A's next poll.
    b.store.save({ ...b.store.state, tasks: [task('t1', 'p1', 'Lavar a louça')] })
    b.engine.notifySaved()
    await clock.advance(PUSH_DEBOUNCE_MS)
    await clock.advance(POLL_MS)
    expect((a.store.state.tasks[0] as Row).title).toBe('Lavar a louça')
    expect(dataHashes(a.store)).toEqual(dataHashes(b.store))
    // Neither side sends the other's versions back.
    expect(a.store.pendingOutgoingCount()).toBe(0)
    expect(b.store.pendingOutgoingCount()).toBe(0)
    expect(a.engine.status().state).toBe('ok')
  })

  it('"Juntar" mantém os registros dos dois lados, e iguais não viram conflito', async () => {
    const shared = project('p-shared', 'Compartilhado')
    const { a, b } = await pairedDevices(
      withData({ projects: [shared, project('pa', 'Só em A')], tasks: [task('ta', 'pa', 'De A')] }),
      withData({ projects: [shared, project('pb', 'Só em B')], tasks: [task('tb', 'pb', 'De B')] })
    )
    await clock.advance(POLL_MS)
    const ids = (s: FakeStore): string[] => s.state.tasks.map((t) => String(t.id)).sort()
    expect(ids(b.store)).toEqual(['ta', 'tb'])
    expect(ids(a.store)).toEqual(['ta', 'tb'])
    expect(a.store.state.projects.map((p) => p.id).sort()).toEqual(['p-shared', 'pa', 'pb'])
    expect(dataHashes(a.store)).toEqual(dataHashes(b.store))
    // Same content minted on both sides is not a conflict.
    expect(a.engine.conflicts()).toEqual([])
    expect(b.engine.conflicts()).toEqual([])
  })

  it('o texto de pareamento leva URL, chave e convite e volta igual', () => {
    const key = new Uint8Array(32).fill(7)
    const code = encodePairCode(SERVER_URL, key, 'convite_abcdefghijklmnop')
    expect(code.startsWith('sagyou-sync:1:')).toBe(true)
    const parsed = parsePairCode(code)
    expect(parsed.url).toBe(SERVER_URL)
    expect([...parsed.syncKey]).toEqual([...key])
    expect(parsed.invite).toBe('convite_abcdefghijklmnop')
    expect(() => parsePairCode('sagyou-sync:1:xx')).toThrow('Código de pareamento inválido.')
  })
})

describe('retrato e retenção', () => {
  it('não reaplica o retrato em ciclos posteriores quando o cursor ainda é zero', async () => {
    const { a } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    expect(a.store.readSyncState('pull_cursor')).toBe('0')
    const snapshotsRead = (): number =>
      server.requests.filter((r) => r.url.endsWith('/snapshot') && r.init.method === 'GET').length
    const before = snapshotsRead()
    await a.engine.syncNow()
    expect(snapshotsRead()).toBe(before)
  })

  it('publica um novo retrato depois de 30 dias mesmo sem novas edições', async () => {
    const { a } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const before = server.snapshot?.id
    expect(before).toBeDefined()
    clock.t += 30 * 86400000 + 1
    await a.engine.syncNow()
    expect(server.snapshot?.id).not.toBe(before)
  })

  it('um aparelho novo recebe o retrato mesmo depois de o histórico antigo ser apagado', async () => {
    const a = device(server, clock, ID_A)
    a.store.save(
      withData({ projects: [project('p1', 'Casa')], tasks: [task('t1', 'p1', 'Lavar')] })
    )
    await a.engine.activate(SERVER_URL, SETUP, 'PC de casa')
    await clock.advance(0)
    expect(server.snapshot).not.toBeNull()
    server.changes = []
    a.store.save(
      withData({
        projects: [project('p1', 'Casa')],
        tasks: [task('t1', 'p1', 'Lavar'), task('t2', 'p1', 'Secar')]
      })
    )
    await a.engine.syncNow()
    const b = device(server, clock, ID_B)
    const { code } = await a.engine.createInvite()
    await b.engine.join(code, 'merge', 'PC do trabalho')
    expect(dataHashes(b.store)).toEqual(dataHashes(a.store))
  })

  it('só remove tombstone antigo confirmado por todos os cursores', () => {
    const store = new FakeStore(ID_A, clock.now)
    const version = (id: string, ageDays: number, serverSeq: number | null): Version => ({
      kind: 'project',
      id,
      hlc: `${String(clock.now() - ageDays * 86400000).padStart(15, '0')}-0000-${ID_A}`,
      baseHlc: null,
      hash: '',
      deleted: true,
      deviceId: ID_A,
      seq: 1,
      serverSeq
    })
    store.versions.set('project:novo', version('novo', 89, 10))
    store.versions.set('project:antigo', version('antigo', 91, 10))
    store.versions.set('project:sem-confirmacao', version('sem-confirmacao', 91, null))
    expect(store.pruneSyncTombstones(9, clock.now())).toBe(0)
    expect(store.pruneSyncTombstones(10, clock.now())).toBe(1)
    expect([...store.versions.keys()].sort()).toEqual(['project:novo', 'project:sem-confirmacao'])
  })
})

describe('ritmo', () => {
  it('5 s depois de notifySaved sai um push só, mesmo com 10 chamadas', async () => {
    const { a } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    await clock.advance(1000)
    const before = server.pushes()
    for (let i = 0; i < 10; i++) {
      await clock.advance(100)
      a.store.save({ ...a.store.state, tasks: [task('t1', 'p1', `Versão ${i}`)] })
      a.engine.notifySaved()
    }
    // Counted from the last save: the earlier ones only restarted the wait.
    await clock.advance(PUSH_DEBOUNCE_MS - 1)
    expect(server.pushes()).toBe(before)
    await clock.advance(1)
    expect(server.pushes()).toBe(before + 1)
  })

  it('o backoff dobra até 15 min e volta a 60 s depois de um sucesso', async () => {
    expect([1, 2, 3, 4].map(backoffDelay)).toEqual([5000, 10000, 20000, 40000])
    expect(backoffDelay(20)).toBe(MAX_BACKOFF_MS)

    // One device only, so every pending timer is its own.
    const a = device(server, clock, ID_A)
    a.store.save(withData({ projects: [project('p1', 'Casa')] }))
    await a.engine.activate(SERVER_URL, SETUP, 'PC de casa')
    await clock.advance(0)
    expect(clock.pending()).toEqual([POLL_MS])
    server.mode = 'down'
    const delays: number[] = []
    await a.engine.syncNow()
    for (let i = 0; i < 10; i++) {
      const [delay] = clock.pending()
      delays.push(delay)
      await clock.advance(delay)
    }
    expect(delays).toEqual([
      5000, 10000, 20000, 40000, 80000, 160000, 320000, 640000, 900000, 900000
    ])
    expect(a.engine.status().state).toBe('offline')

    server.mode = 'up'
    await clock.advance(clock.pending()[0])
    expect(clock.pending()).toEqual([POLL_MS])
    expect(a.engine.status().state).toBe('ok')
  })
})

describe('revogar e apagar', () => {
  it('manda a prova da chave e o código somente na ação protegida', async () => {
    const { a, b } = await pairedDevices(withData({}))
    const key = deriveKeys(a.config.stored!.syncKey).id
    const setup = server.requests.find((r) => r.url.endsWith('/setup'))
    expect(setup?.init.headers['x-key-proof']).toBe(keyProof(key))
    expect(setup?.init.body).not.toContain(keyProof(key))
    const other = (await a.engine.devices()).find((d) => !d.current)
    await a.engine.revoke(other!.id, true, { totp: '123456' })
    const request = server.requests.findLast((r) => r.url.endsWith('/revoke'))
    expect(request?.init.headers['x-key-proof']).toBe(keyProof(key))
    expect(request?.init.headers['x-totp-code']).toBe('123456')
    expect(request?.init.body).not.toContain('123456')
    expect(b.config.stored).not.toBeNull()
  })

  it('401 por código errado não desconecta nem apaga o aparelho', async () => {
    const { a } = await pairedDevices(withData({}))
    const other = (await a.engine.devices()).find((d) => !d.current)
    server.mode = 'unauthorized'
    await expect(a.engine.revoke(other!.id, true, { totp: '000000' })).rejects.toThrow()
    expect(a.config.stored).not.toBeNull()
    expect(a.wipe).not.toHaveBeenCalled()
    expect(a.engine.status().state).toBe('ok')
  })

  it('401 no sync normal desconecta quando o token deixou de valer', async () => {
    const { a } = await pairedDevices(withData({}))
    server.mode = 'unauthorized'
    await a.engine.syncNow()
    expect(a.config.stored).toBeNull()
    expect(a.engine.status().state).toBe('disconnected')
  })

  it('cadastro do autenticador entrega QR e códigos reserva ao confirmar', async () => {
    const { a } = await pairedDevices(withData({}))
    expect(await a.engine.enrollTotp()).toContain('otpauth://totp/')
    expect(await a.engine.confirmTotp('123456')).toEqual(['ABCDEF0123456789'])
  })

  it('um TypeError de rede ou um 5xx nunca apaga nada', async () => {
    const { a } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const before = dataHashes(a.store)
    server.mode = 'down'
    await a.engine.syncNow()
    server.mode = 'error500'
    await a.engine.syncNow()
    expect(a.wipe).not.toHaveBeenCalled()
    expect(a.config.stored).not.toBeNull()
    expect(dataHashes(a.store)).toEqual(before)
    expect(a.engine.status().state).toBe('offline')
  })

  it('401 sem wipe só esquece a configuração e mostra desconectado', async () => {
    const { a, b } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const list = await a.engine.devices()
    expect(list.find((d) => d.current)?.name).toBe('PC de casa')
    const other = list.find((d) => !d.current)
    expect(other?.name).toBe('PC do trabalho')
    await a.engine.revoke(other!.id, false)
    const before = dataHashes(b.store)
    await b.engine.syncNow()
    expect(b.wipe).not.toHaveBeenCalled()
    expect(b.config.stored).toBeNull()
    expect(b.engine.status().state).toBe('disconnected')
    expect(dataHashes(b.store)).toEqual(before)
  })

  it('401 com wipe dispara o apagar', async () => {
    const { a, b } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const other = (await a.engine.devices()).find((d) => !d.current)
    await a.engine.revoke(other!.id, true)
    const fromB = (): number =>
      server.requests.filter(
        (r) => r.init.headers.authorization === `Bearer ${b.config.stored?.token}`
      ).length
    await b.engine.syncNow()
    expect(b.wipe).toHaveBeenCalledTimes(1)
    // B stops: no request of its own after the wipe.
    const count = fromB()
    b.engine.notifySaved()
    await clock.advance(POLL_MS * 3)
    expect(fromB()).toBe(count)
  })

  it('revogar a si mesmo é recusado (use Desativar)', async () => {
    const { a } = await pairedDevices(withData({}))
    const me = (await a.engine.devices()).find((d) => d.current)
    await expect(a.engine.revoke(me!.id, true)).rejects.toThrow('Desativar sincronização')
  })
})

describe('wipeLocalData', () => {
  let parent: string
  let userData: string

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), 'sagyou-wipe-'))
    userData = join(parent, 'userData')
    mkdirSync(userData)
    for (const name of ['kanban.db', 'kanban.db-wal', 'sync-config.json', 'sync-device.json'])
      writeFileSync(join(userData, name), 'x')
    for (const dir of ['files', 'task-images', 'backups', 'agent-runs', 'logs', 'skills']) {
      mkdirSync(join(userData, dir))
      writeFileSync(join(userData, dir, 'item'), 'x')
    }
    writeFileSync(join(userData, 'ai-config.json'), '{}')
    writeFileSync(join(userData, 'kanban-dev.db'), 'x')
    // Outside userData: never touched.
    mkdirSync(join(parent, 'files'))
    writeFileSync(join(parent, 'kanban.db'), 'x')
  })

  afterEach(() => rmSync(parent, { recursive: true, force: true }))

  it('apaga exatamente a lista, mantém ai-config.json e nada fora de userData', () => {
    const result = wipeLocalData(userData, false)
    expect(result.failed).toBe(0)
    for (const name of wipeTargets(false)) expect(existsSync(join(userData, name))).toBe(false)
    expect(wipeTargets(false).sort()).toEqual(
      [
        'agent-runs',
        'backups',
        'files',
        'kanban.db',
        'kanban.db-shm',
        'kanban.db-wal',
        'sync-config.json',
        'sync-device.json',
        'task-images'
      ].sort()
    )
    expect(existsSync(join(userData, 'ai-config.json'))).toBe(true)
    expect(existsSync(join(userData, 'logs', 'item'))).toBe(true)
    expect(existsSync(join(userData, 'skills', 'item'))).toBe(true)
    expect(existsSync(join(userData, 'kanban-dev.db'))).toBe(true)
    expect(existsSync(join(parent, 'files'))).toBe(true)
    expect(existsSync(join(parent, 'kanban.db'))).toBe(true)
    for (const path of result.removed) expect(path.startsWith(userData)).toBe(true)
  })

  it('em dev só apaga os arquivos com nome de dev (files/ e backups/ são do app instalado)', () => {
    wipeLocalData(userData, true)
    expect(existsSync(join(userData, 'kanban-dev.db'))).toBe(false)
    expect(existsSync(join(userData, 'kanban.db'))).toBe(true)
    expect(existsSync(join(userData, 'files', 'item'))).toBe(true)
    expect(existsSync(join(userData, 'backups', 'item'))).toBe(true)
  })

  it('se algo falha, a configuração do sync fica para a próxima abertura terminar', () => {
    const result = wipeLocalData(userData, false, (path) => {
      if (path.endsWith('files')) throw new Error('EBUSY')
      rmSync(path, { recursive: true, force: true })
    })
    expect(result.failed).toBe(1)
    expect(existsSync(join(userData, 'kanban.db'))).toBe(false)
    expect(existsSync(join(userData, 'sync-config.json'))).toBe(true)
  })
})

describe('substituir', () => {
  it('um backup forçado que falha impede o replace e não gasta o convite', async () => {
    const a = device(server, clock, ID_A)
    a.store.save(withData({ projects: [project('p1', 'Casa')] }))
    await a.engine.activate(SERVER_URL, SETUP, 'PC de casa')
    await clock.advance(0)
    const b = device(server, clock, ID_B)
    b.store.save(withData({ projects: [project('pb', 'Só em B')] }))
    const before = dataHashes(b.store)
    b.backup.mockResolvedValue(false)
    const { code } = await a.engine.createInvite()
    await expect(b.engine.join(code, 'replace', 'PC do trabalho')).rejects.toThrow('backup')
    expect(server.requests.some((r) => r.url.endsWith('/pair'))).toBe(false)
    expect(server.invites.size).toBe(1)
    expect(b.config.stored).toBeNull()
    expect(dataHashes(b.store)).toEqual(before)
  })

  it('replace com backup ok fica só com a nuvem, sem enviar o que era local', async () => {
    const a = device(server, clock, ID_A)
    a.store.save(withData({ projects: [project('p1', 'Casa')] }))
    await a.engine.activate(SERVER_URL, SETUP, 'PC de casa')
    await clock.advance(0)
    const b = device(server, clock, ID_B)
    b.store.save(withData({ projects: [project('pb', 'Só em B')] }))
    const { code } = await a.engine.createInvite()
    await b.engine.join(code, 'replace', 'PC do trabalho')
    await clock.advance(0)
    expect(b.backup).toHaveBeenCalledTimes(1)
    expect(b.store.state.projects.map((p) => p.id)).toEqual(['p1'])
    expect(b.config.stored?.paused).toBeNull()
    await clock.advance(POLL_MS)
    expect(a.store.state.projects.map((p) => p.id)).toEqual(['p1'])
  })
})

describe('o que o servidor e o log veem', () => {
  it('os corpos de pedido não contêm título, valor, nome de aparelho nem id de registro', async () => {
    const { a, b } = await pairedDevices(
      withData({
        projects: [project('proj-secreto-1', 'Projeto secreto')],
        tasks: [task('task-secreto-1', 'proj-secreto-1', 'Comprar pão secreto')],
        lists: [table('tabela-secreta-1', '1234.56')]
      })
    )
    b.store.save({
      ...b.store.state,
      tasks: [task('task-secreto-1', 'proj-secreto-1', 'Outro título')]
    })
    b.engine.notifySaved()
    await clock.advance(PUSH_DEBOUNCE_MS)
    await a.engine.devices()
    const sent = JSON.stringify(server.requests.map((r) => ({ url: r.url, init: r.init })))
    for (const secret of [
      'Projeto secreto',
      'Comprar pão secreto',
      'Outro título',
      'Aluguel secreto',
      '1234.56',
      'proj-secreto-1',
      'task-secreto-1',
      'tabela-secreta-1',
      'PC de casa',
      'PC do trabalho',
      ID_A,
      ID_B
    ])
      expect(sent).not.toContain(secret)
    // The log carries counts and seqs only.
    const log = JSON.stringify(logged)
    for (const secret of ['Comprar pão secreto', '1234.56', 'task-secreto-1', 'PC de casa'])
      expect(log).not.toContain(secret)
  })

  it('um lote que não decifra é logado, pulado, e o cursor avança', async () => {
    const { a, b } = await pairedDevices(withData({ projects: [project('p1', 'Casa')] }))
    const aDevice = server.devices[0].id
    server.injectChange(
      aDevice,
      'lote-ruim',
      Buffer.from('não é uma cifra válida, nem perto').toString('base64')
    )
    a.store.save({ ...a.store.state, tasks: [task('t-depois', 'p1', 'Depois do lote ruim')] })
    a.engine.notifySaved()
    await clock.advance(PUSH_DEBOUNCE_MS)
    await b.engine.syncNow()
    expect(logged.some((l) => l.event === 'decrypt_failed')).toBe(true)
    expect(b.store.state.tasks.map((t) => t.id)).toEqual(['t-depois'])
    expect(b.store.readSyncState('pull_cursor')).toBe(String(server.changes.length))
  })
})

describe('conflitos', () => {
  it('a mesma tarefa editada nos dois lados vira um conflito, e "Usar esta" adota a outra versão', async () => {
    const { a, b } = await pairedDevices(
      withData({ projects: [project('p1', 'Casa')], tasks: [task('t1', 'p1', 'Original')] })
    )
    server.mode = 'down'
    a.store.save({ ...a.store.state, tasks: [task('t1', 'p1', 'Versão de A')] })
    clock.t += 10
    b.store.save({ ...b.store.state, tasks: [task('t1', 'p1', 'Versão de B')] })
    server.mode = 'up'
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    // B's edit is newer: both end with it, and A keeps its own as the loser.
    expect((a.store.state.tasks[0] as Row).title).toBe('Versão de B')
    expect((b.store.state.tasks[0] as Row).title).toBe('Versão de B')
    const [conflict] = a.engine.conflicts()
    expect(conflict.type).toBe('lww')
    expect(conflict.local.payload?.title).toBe('Versão de A')
    expect(conflict.remote.payload?.title).toBe('Versão de B')
    expect(conflict.local.deviceName).toBe('PC de casa')

    a.engine.resolve(conflict.id, 'local')
    expect((a.store.state.tasks[0] as Row).title).toBe('Versão de A')
    expect(a.engine.conflicts()).toEqual([])
    await clock.advance(PUSH_DEBOUNCE_MS)
    await b.engine.syncNow()
    expect((b.store.state.tasks[0] as Row).title).toBe('Versão de A')
  })
})
