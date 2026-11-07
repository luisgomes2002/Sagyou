// Shared by the route tests: an in-memory SyncDb and request helpers.
import { expect } from 'vitest'
import { createHmac } from 'crypto'
import { handle, type RouteDeps } from '../routes'
import type {
  ChangeInput,
  ChangeRow,
  DeviceRow,
  PullResult,
  SnapshotPartInput,
  SnapshotRow,
  SyncDb
} from '../db'

export const BASE = 'https://sync.example.workers.dev'
export const SETUP = 'setup-secret-de-teste'
export const DEV_A = 'a'.repeat(32)
export const DEV_B = 'b'.repeat(32)
export const DEV_C = 'c'.repeat(32)
export const PROOF = '1'.repeat(64)
export const ENC_KEY = Buffer.alloc(32, 7).toString('base64url')

export interface PartRow {
  snapshotId: string
  index: number
  device: string
  ciphertext: string
  createdAt: number
}

export class MemoryDb implements SyncDb {
  devices = new Map<string, DeviceRow>()
  changes: (ChangeRow & { size: number; createdAt: number })[] = []
  invites = new Map<string, { expiresAt: number; usedAt: number | null }>()
  snapshots: SnapshotRow[] = []
  parts: PartRow[] = []
  auth: import('../db').AuthRow | null = null
  private nextSeq = 1

  async deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    for (const d of this.devices.values()) if (d.tokenHash === tokenHash) return { ...d }
    return null
  }

  async registerDevice(d: {
    id: string
    tokenHash: string
    nameCipher: string
    now: number
  }): Promise<boolean> {
    const old = this.devices.get(d.id)
    if (old && (old.revokedAt === null || old.wipe)) return false
    this.devices.set(d.id, {
      id: d.id,
      tokenHash: d.tokenHash,
      nameCipher: d.nameCipher,
      lastSeen: d.now,
      revokedAt: null,
      wipe: false,
      cursor: 0
    })
    return true
  }

  async touchDevice(id: string, now: number): Promise<void> {
    const d = this.devices.get(id)
    if (d) d.lastSeen = now
  }

  async listDevices(): Promise<DeviceRow[]> {
    return [...this.devices.values()].map((d) => ({ ...d }))
  }

  async revokeDevice(id: string, wipe: boolean, now: number): Promise<boolean> {
    const d = this.devices.get(id)
    if (!d) return false
    d.revokedAt = d.revokedAt ?? now
    d.wipe = wipe
    return true
  }

  async insertInvite(hash: string, expiresAt: number, now: number): Promise<void> {
    for (const [h, inv] of this.invites) if (inv.expiresAt <= now) this.invites.delete(h)
    this.invites.set(hash, { expiresAt, usedAt: null })
  }

  async consumeInvite(hash: string, now: number): Promise<boolean> {
    const inv = this.invites.get(hash)
    if (!inv || inv.usedAt !== null || inv.expiresAt <= now) return false
    inv.usedAt = now
    return true
  }

  async insertChanges(device: string, items: ChangeInput[], now: number): Promise<number[]> {
    return items.map((it) => {
      const dup = this.changes.find((c) => c.device === device && c.batchId === it.batchId)
      if (dup) return dup.seq
      const seq = this.nextSeq++
      this.changes.push({
        seq,
        device,
        batchId: it.batchId,
        ciphertext: it.ciphertext,
        size: it.size,
        createdAt: now
      })
      return seq
    })
  }

  async pullChanges(device: string, since: number, limit: number): Promise<PullResult> {
    const maxSeq = Math.max(
      this.changes.reduce((m, c) => Math.max(m, c.seq), 0),
      this.snapshots[0]?.seqUntil ?? 0
    )
    const rows = this.changes
      .filter((c) => c.seq > since && c.seq <= maxSeq && c.device !== device)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(({ seq, device: dev, batchId, ciphertext }) => ({
        seq,
        device: dev,
        batchId,
        ciphertext
      }))
    return { rows, maxSeq }
  }

  async setCursor(id: string, cursor: number): Promise<void> {
    const d = this.devices.get(id)
    if (d) d.cursor = Math.max(d.cursor, cursor)
  }

  async pruneCoveredChanges(): Promise<void> {
    const snap = this.snapshots[0]
    if (!snap) return
    const active = [...this.devices.values()].filter((d) => d.revokedAt === null)
    if (active.every((d) => d.cursor >= snap.seqUntil))
      this.changes = this.changes.filter((c) => c.seq > snap.seqUntil)
  }

  async putSnapshotPart(p: SnapshotPartInput): Promise<boolean> {
    if (this.snapshots.some((s) => s.id === p.snapshotId)) return false
    const owner = this.parts.find((x) => x.snapshotId === p.snapshotId)
    if (owner && owner.device !== p.device) return false
    this.parts = this.parts.filter((x) => !(x.snapshotId === p.snapshotId && x.index === p.index))
    this.parts.push({
      snapshotId: p.snapshotId,
      index: p.index,
      device: p.device,
      ciphertext: p.ciphertext,
      createdAt: p.now
    })
    return true
  }

  async commitSnapshot(s: {
    snapshotId: string
    seqUntil: number
    parts: number
    device: string
    now: number
  }): Promise<boolean> {
    if (this.snapshots[0] && s.seqUntil < this.snapshots[0].seqUntil) return false
    const mine = this.parts.filter(
      (x) => x.snapshotId === s.snapshotId && x.device === s.device && x.index < s.parts
    )
    if (mine.length !== s.parts) return false
    if (this.snapshots.some((x) => x.id === s.snapshotId)) return false
    this.parts = this.parts.filter((x) => x.snapshotId === s.snapshotId && x.index < s.parts)
    this.snapshots = [
      { id: s.snapshotId, seqUntil: s.seqUntil, parts: s.parts, device: s.device, createdAt: s.now }
    ]
    return true
  }

  async currentSnapshot(): Promise<SnapshotRow | null> {
    return this.snapshots[0] ? { ...this.snapshots[0] } : null
  }

  async maxSequence(): Promise<number> {
    return Math.max(this.nextSeq - 1, this.snapshots[0]?.seqUntil ?? 0)
  }

  async snapshotPart(snapshotId: string, index: number): Promise<string | null> {
    return (
      this.parts.find((x) => x.snapshotId === snapshotId && x.index === index)?.ciphertext ?? null
    )
  }

  async getAuth(): Promise<import('../db').AuthRow | null> {
    return this.auth ? { ...this.auth, backupHashes: [...this.auth.backupHashes] } : null
  }

  async createAuth(proofHash: string): Promise<boolean> {
    if (this.auth) return false
    this.auth = {
      version: 0,
      proofHash,
      totpCipher: null,
      pendingTotpCipher: null,
      totpConfirmed: false,
      backupHashes: [],
      failCount: 0,
      lockedUntil: 0
    }
    return true
  }

  async saveAuth(auth: import('../db').AuthRow): Promise<boolean> {
    if (auth.version !== this.auth?.version) return false
    this.auth = { ...auth, backupHashes: [...auth.backupHashes] }
    this.auth.version++
    return true
  }
}

export function setup(start = 1_700_000_000_000): {
  db: MemoryDb
  deps: RouteDeps
  clock: { now: number }
} {
  const db = new MemoryDb()
  const clock = { now: start }
  const deps: RouteDeps = { db, setupToken: SETUP, totpEncKey: ENC_KEY, now: () => clock.now }
  return { db, deps, clock }
}

export function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}
): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: string | undefined
  if (opts.raw !== undefined) body = opts.raw
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  return new Request(BASE + path, { method, headers, body })
}

export async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function registerFirst(deps: RouteDeps, deviceId = DEV_A): Promise<string> {
  const res = await handle(
    req('POST', '/setup', {
      headers: { 'x-setup-token': SETUP, 'x-key-proof': PROOF },
      body: { deviceId, nameCipher: 'bm9tZQ==' }
    }),
    deps
  )
  expect(res.status).toBe(200)
  const { token } = await json(res)
  expect(typeof token).toBe('string')
  return token as string
}

export function codeFromUri(uri: string, now: number): string {
  const secret = new URL(uri).searchParams.get('secret') ?? ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of secret) {
    value = (value << 5) | chars.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 15
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

export async function enroll(
  deps: RouteDeps,
  token: string
): Promise<{ uri: string; code: string; backupCodes: string[] }> {
  const response = await handle(
    req('POST', '/totp/enroll', { token, headers: { 'x-key-proof': PROOF } }),
    deps
  )
  expect(response.status).toBe(200)
  const uri = (await json(response)).uri as string
  const code = codeFromUri(uri, deps.now())
  const confirmed = await handle(
    req('POST', '/totp/confirm', { token, headers: { 'x-key-proof': PROOF }, body: { code } }),
    deps
  )
  expect(confirmed.status).toBe(200)
  return { uri, code, backupCodes: (await json(confirmed)).backupCodes as string[] }
}

export async function pairSecond(
  deps: RouteDeps,
  tokenA: string,
  deviceId = DEV_B
): Promise<string> {
  const invite = `convite-${deviceId}`
  const inv = await handle(
    req('POST', '/invites', { token: tokenA, body: { inviteHash: await sha256Hex(invite) } }),
    deps
  )
  expect(inv.status).toBe(200)
  const res = await handle(
    req('POST', '/pair', { body: { invite, deviceId, nameCipher: 'b3V0cm8=' } }),
    deps
  )
  expect(res.status).toBe(200)
  return (await json(res)).token as string
}
