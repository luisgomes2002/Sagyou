// The storage seam of the sync Worker. `routes.ts` only talks to `SyncDb`, so
// the routes are tested against an in-memory implementation; `D1SyncDb` is the
// production one over Cloudflare D1 (schema in `../schema.sql`).
//
// The D1 types below are the minimal subset this file uses, declared here so the
// Worker needs no `@cloudflare/workers-types` package to build or test.

export interface DeviceRow {
  /** Opaque device id (32 hex), never the app's own device id. */
  id: string
  /** SHA-256 hex of the device token; the token itself is never stored. */
  tokenHash: string
  nameCipher: string
  lastSeen: number
  revokedAt: number | null
  wipe: boolean
  /** Highest seq this device is known to have pulled (own batches included). */
  cursor: number
}

export interface ChangeRow {
  seq: number
  device: string
  batchId: string
  ciphertext: string
}

export interface ChangeInput {
  batchId: string
  ciphertext: string
  size: number
}

export interface PullResult {
  /** Other devices' changes with since < seq <= maxSeq, in seq order, at most the limit asked. */
  rows: ChangeRow[]
  /** MAX(seq) of the whole log when the page was read (0 when empty). */
  maxSeq: number
}

export interface SnapshotRow {
  id: string
  seqUntil: number
  parts: number
  device: string
  createdAt: number
}

export interface SnapshotPartInput {
  snapshotId: string
  index: number
  ciphertext: string
  device: string
  now: number
}

export interface AuthRow {
  version: number
  proofHash: string
  totpCipher: string | null
  pendingTotpCipher: string | null
  totpConfirmed: boolean
  backupHashes: string[]
  failCount: number
  lockedUntil: number
}

export interface SyncDb {
  getAuth(): Promise<AuthRow | null>
  /** Only the first setup may establish the proof. */
  createAuth(proofHash: string): Promise<boolean>
  /** Compare-and-swap; false means another request changed the policy first. */
  saveAuth(auth: AuthRow): Promise<boolean>
  deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>
  /** Inserts the device, or re-registers it: new token, not revoked, no wipe, cursor 0. */
  registerDevice(d: {
    id: string
    tokenHash: string
    nameCipher: string
    now: number
  }): Promise<void>
  touchDevice(id: string, now: number): Promise<void>
  listDevices(): Promise<DeviceRow[]>
  /** False when the device does not exist. Keeps the first revocation time. */
  revokeDevice(id: string, wipe: boolean, now: number): Promise<boolean>
  /** Stores an invite hash; expired invites are dropped on the way. */
  insertInvite(hash: string, expiresAt: number, now: number): Promise<void>
  /** Marks an unused, unexpired invite as used. True only for the one call that did it. */
  consumeInvite(hash: string, now: number): Promise<boolean>
  /** Appends batches in order. A (device, batchId) already stored returns its existing seq. */
  insertChanges(device: string, items: ChangeInput[], now: number): Promise<number[]>
  pullChanges(device: string, since: number, limit: number): Promise<PullResult>
  setCursor(id: string, cursor: number): Promise<void>
  /** False when the snapshot is already committed or its parts belong to another device. */
  putSnapshotPart(p: SnapshotPartInput): Promise<boolean>
  /**
   * Makes `snapshotId` the only committed snapshot, deleting every other snapshot
   * and part. False when one of parts 0..parts-1 is missing or not this device's.
   */
  commitSnapshot(s: {
    snapshotId: string
    seqUntil: number
    parts: number
    device: string
    now: number
  }): Promise<boolean>
  currentSnapshot(): Promise<SnapshotRow | null>
  snapshotPart(snapshotId: string, index: number): Promise<string | null>
}

// ---- Minimal D1 surface -------------------------------------------------------

export interface D1Result<T> {
  results: T[]
  success: boolean
  meta: { changes?: number; [key: string]: unknown }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

interface DeviceSql {
  id: string
  token_hash: string
  name_cipher: string
  last_seen: number
  revoked_at: number | null
  wipe: number
  cursor: number
}

function toDevice(r: DeviceSql): DeviceRow {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    nameCipher: r.name_cipher,
    lastSeen: r.last_seen,
    revokedAt: r.revoked_at,
    wipe: r.wipe === 1,
    cursor: r.cursor
  }
}

const DEVICE_COLUMNS = 'id, token_hash, name_cipher, last_seen, revoked_at, wipe, cursor'

export class D1SyncDb implements SyncDb {
  constructor(private readonly db: D1Database) {}

  async getAuth(): Promise<AuthRow | null> {
    const row = await this.db.prepare('SELECT * FROM auth WHERE id = 1').first<{
      key_proof_hash: string
      version: number
      totp_cipher: string | null
      pending_totp_cipher: string | null
      totp_confirmed: number
      backup_hashes: string
      fail_count: number
      locked_until: number
    }>()
    return row
      ? {
          version: row.version,
          proofHash: row.key_proof_hash,
          totpCipher: row.totp_cipher,
          pendingTotpCipher: row.pending_totp_cipher,
          totpConfirmed: row.totp_confirmed === 1,
          backupHashes: JSON.parse(row.backup_hashes) as string[],
          failCount: row.fail_count,
          lockedUntil: row.locked_until
        }
      : null
  }

  async createAuth(proofHash: string): Promise<boolean> {
    const result = await this.db
      .prepare('INSERT OR IGNORE INTO auth (id, key_proof_hash) VALUES (1, ?1)')
      .bind(proofHash)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  async saveAuth(auth: AuthRow): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE auth SET totp_cipher = ?1, pending_totp_cipher = ?2,
      totp_confirmed = ?3, backup_hashes = ?4, fail_count = ?5, locked_until = ?6,
      version = version + 1 WHERE id = 1 AND version = ?7`
      )
      .bind(
        auth.totpCipher,
        auth.pendingTotpCipher,
        auth.totpConfirmed ? 1 : 0,
        JSON.stringify(auth.backupHashes),
        auth.failCount,
        auth.lockedUntil,
        auth.version
      )
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  async deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    const row = await this.db
      .prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE token_hash = ?1`)
      .bind(tokenHash)
      .first<DeviceSql>()
    return row ? toDevice(row) : null
  }

  async registerDevice(d: {
    id: string
    tokenHash: string
    nameCipher: string
    now: number
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO devices (id, token_hash, name_cipher, last_seen, revoked_at, wipe, cursor)
         VALUES (?1, ?2, ?3, ?4, NULL, 0, 0)
         ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash,
           name_cipher = excluded.name_cipher, last_seen = excluded.last_seen,
           revoked_at = NULL, wipe = 0, cursor = 0`
      )
      .bind(d.id, d.tokenHash, d.nameCipher, d.now)
      .run()
  }

  async touchDevice(id: string, now: number): Promise<void> {
    await this.db.prepare('UPDATE devices SET last_seen = ?2 WHERE id = ?1').bind(id, now).run()
  }

  async listDevices(): Promise<DeviceRow[]> {
    const res = await this.db
      .prepare(`SELECT ${DEVICE_COLUMNS} FROM devices ORDER BY last_seen DESC`)
      .all<DeviceSql>()
    return res.results.map(toDevice)
  }

  async revokeDevice(id: string, wipe: boolean, now: number): Promise<boolean> {
    const res = await this.db
      .prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?2), wipe = ?3 WHERE id = ?1')
      .bind(id, now, wipe ? 1 : 0)
      .run()
    return (res.meta.changes ?? 0) > 0
  }

  async insertInvite(hash: string, expiresAt: number, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM invites WHERE expires_at <= ?1').bind(now),
      this.db
        .prepare('INSERT OR REPLACE INTO invites (hash, expires_at, used_at) VALUES (?1, ?2, NULL)')
        .bind(hash, expiresAt)
    ])
  }

  async consumeInvite(hash: string, now: number): Promise<boolean> {
    // One conditional UPDATE: two concurrent /pair calls cannot both win.
    const res = await this.db
      .prepare(
        'UPDATE invites SET used_at = ?2 WHERE hash = ?1 AND used_at IS NULL AND expires_at > ?2'
      )
      .bind(hash, now)
      .run()
    return (res.meta.changes ?? 0) > 0
  }

  async insertChanges(device: string, items: ChangeInput[], now: number): Promise<number[]> {
    if (items.length === 0) return []
    // ON CONFLICT DO UPDATE (a no-op write) makes RETURNING give back the stored
    // seq of a batch resent after a lost response, instead of a duplicate row.
    const statements = items.map((it) =>
      this.db
        .prepare(
          `INSERT INTO changes (device, batch_id, ciphertext, size, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(device, batch_id) DO UPDATE SET batch_id = excluded.batch_id
           RETURNING seq`
        )
        .bind(device, it.batchId, it.ciphertext, it.size, now)
    )
    const results = await this.db.batch<{ seq: number }>(statements)
    return results.map((r) => {
      const row = r.results[0]
      if (!row) throw new Error('insert returned no seq')
      return row.seq
    })
  }

  async pullChanges(device: string, since: number, limit: number): Promise<PullResult> {
    // A batch runs as one transaction, so maxSeq and the page agree.
    const [maxRes, pageRes] = await this.db.batch([
      this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM changes'),
      this.db
        .prepare(
          `SELECT seq, device, batch_id, ciphertext FROM changes
           WHERE seq > ?1 AND seq <= (SELECT COALESCE(MAX(seq), 0) FROM changes) AND device != ?2
           ORDER BY seq LIMIT ?3`
        )
        .bind(since, device, limit)
    ])
    const maxSeq = Number((maxRes.results[0] as { m?: number } | undefined)?.m ?? 0)
    const rows = (
      pageRes.results as { seq: number; device: string; batch_id: string; ciphertext: string }[]
    ).map((r) => ({ seq: r.seq, device: r.device, batchId: r.batch_id, ciphertext: r.ciphertext }))
    return { rows, maxSeq }
  }

  async setCursor(id: string, cursor: number): Promise<void> {
    await this.db.prepare('UPDATE devices SET cursor = ?2 WHERE id = ?1').bind(id, cursor).run()
  }

  async putSnapshotPart(p: SnapshotPartInput): Promise<boolean> {
    const committed = await this.db
      .prepare('SELECT 1 AS x FROM snapshots WHERE id = ?1')
      .bind(p.snapshotId)
      .first()
    if (committed) return false
    const other = await this.db
      .prepare('SELECT 1 AS x FROM snapshot_parts WHERE snapshot_id = ?1 AND device != ?2 LIMIT 1')
      .bind(p.snapshotId, p.device)
      .first()
    if (other) return false
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshot_parts (snapshot_id, idx, device, ciphertext, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(p.snapshotId, p.index, p.device, p.ciphertext, p.now)
      .run()
    return true
  }

  async commitSnapshot(s: {
    snapshotId: string
    seqUntil: number
    parts: number
    device: string
    now: number
  }): Promise<boolean> {
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM snapshot_parts
         WHERE snapshot_id = ?1 AND device = ?2 AND idx >= 0 AND idx < ?3`
      )
      .bind(s.snapshotId, s.device, s.parts)
      .first<{ n: number }>()
    if (Number(count?.n ?? 0) !== s.parts) return false
    const committed = await this.db
      .prepare('SELECT 1 AS x FROM snapshots WHERE id = ?1')
      .bind(s.snapshotId)
      .first()
    if (committed) return false
    await this.db.batch([
      this.db.prepare('DELETE FROM snapshots'),
      this.db
        .prepare('DELETE FROM snapshot_parts WHERE snapshot_id != ?1 OR idx >= ?2')
        .bind(s.snapshotId, s.parts),
      this.db
        .prepare(
          `INSERT INTO snapshots (id, seq_until, parts, device, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`
        )
        .bind(s.snapshotId, s.seqUntil, s.parts, s.device, s.now)
    ])
    return true
  }

  async currentSnapshot(): Promise<SnapshotRow | null> {
    const row = await this.db
      .prepare(
        'SELECT id, seq_until, parts, device, created_at FROM snapshots ORDER BY created_at DESC LIMIT 1'
      )
      .first<{ id: string; seq_until: number; parts: number; device: string; created_at: number }>()
    return row
      ? {
          id: row.id,
          seqUntil: row.seq_until,
          parts: row.parts,
          device: row.device,
          createdAt: row.created_at
        }
      : null
  }

  async snapshotPart(snapshotId: string, index: number): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT ciphertext FROM snapshot_parts WHERE snapshot_id = ?1 AND idx = ?2')
      .bind(snapshotId, index)
      .first<{ ciphertext: string }>()
    return row ? row.ciphertext : null
  }
}
