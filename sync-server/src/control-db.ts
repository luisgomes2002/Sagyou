// Storage of the remote control (spec docs/specs/2026-11-03-controle-remoto-app.md).
// Separate from `SyncDb` on purpose: the sync routes and their tests do not change,
// and a Worker whose D1 was never given the new tables still syncs (the control
// routes answer 501 instead).
//
// What lives here is ciphertext the Worker cannot open (messages, the PC status,
// the ESP32 key), hashes (the ESP32 token), roles keyed by opaque device ids and
// the ESP32's power command and report, which carry their own HMAC.

import type { D1Database } from './db'

export type Role = 'pc' | 'controller'

export interface MessageRow {
  to: string
  from: string
  msgId: string
  ciphertext: string
  expiresAt: number
}

export interface SealedSlot {
  from: string
  msgId: string
  ciphertext: string
  at: number
}

export interface PowerCommandRow {
  cmd: string
  at: number
  exp: number
  mac: string
  takenAt: number | null
}

export interface PowerStateRow {
  pcPing: boolean
  lastResult: string
  at: number
  mac: string
  lastPoll: number
}

/** Pending messages kept per recipient; one more is refused. */
export const MAX_PENDING_MESSAGES = 50

export interface ControlDb {
  getRoles(): Promise<{ pc: string | null; controllers: string[] }>
  /** Makes `id` the only PC (a former PC loses the role). */
  setPc(id: string, now: number): Promise<void>
  addController(id: string, now: number): Promise<void>
  removeController(id: string): Promise<void>
  /** Removes every controller but `except`. */
  clearControllers(except: string | null): Promise<void>
  /** Drops the device's role and FCM token (it was revoked). */
  forgetDevice(id: string): Promise<void>
  /** False (nothing written) when the recipient already has MAX_PENDING_MESSAGES. */
  putMessage(m: MessageRow & { now: number }): Promise<boolean>
  /** Returns the recipient's unexpired messages and deletes all of them. */
  takeMessages(to: string, now: number): Promise<MessageRow[]>
  putStatus(s: SealedSlot): Promise<void>
  getStatus(): Promise<SealedSlot | null>
  putEsp32Key(s: SealedSlot): Promise<void>
  getEsp32Key(): Promise<SealedSlot | null>
  setPowerToken(hash: string, now: number): Promise<void>
  powerTokenMatches(hash: string): Promise<boolean>
  putPowerCommand(c: Omit<PowerCommandRow, 'takenAt'>): Promise<void>
  /** The pending command, once: null when there is none, it expired or was already taken. */
  takePowerCommand(now: number): Promise<PowerCommandRow | null>
  lastPowerCommand(): Promise<PowerCommandRow | null>
  putPowerState(s: Omit<PowerStateRow, 'lastPoll'>, now: number): Promise<void>
  touchPowerPoll(now: number): Promise<void>
  getPowerState(): Promise<PowerStateRow | null>
  putPushToken(id: string, token: string, now: number): Promise<void>
  pushTokens(ids: string[]): Promise<string[]>
}

// ── D1 ────────────────────────────────────────────────────────────────────────────

export class D1ControlDb implements ControlDb {
  constructor(private readonly db: D1Database) {}

  async getRoles(): Promise<{ pc: string | null; controllers: string[] }> {
    const res = await this.db
      .prepare('SELECT id, role FROM device_roles ORDER BY created_at')
      .all<{ id: string; role: Role }>()
    const pc = res.results.find((r) => r.role === 'pc')?.id ?? null
    return { pc, controllers: res.results.filter((r) => r.role === 'controller').map((r) => r.id) }
  }

  async setPc(id: string, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM device_roles WHERE role = 'pc' OR id = ?1").bind(id),
      this.db
        .prepare("INSERT INTO device_roles (id, role, created_at) VALUES (?1, 'pc', ?2)")
        .bind(id, now)
    ])
  }

  async addController(id: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO device_roles (id, role, created_at) VALUES (?1, 'controller', ?2)
         ON CONFLICT(id) DO NOTHING`
      )
      .bind(id, now)
      .run()
  }

  async removeController(id: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM device_roles WHERE id = ?1 AND role = 'controller'")
      .bind(id)
      .run()
  }

  async clearControllers(except: string | null): Promise<void> {
    await this.db
      .prepare("DELETE FROM device_roles WHERE role = 'controller' AND id IS NOT ?1")
      .bind(except)
      .run()
  }

  async forgetDevice(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM device_roles WHERE id = ?1').bind(id),
      this.db.prepare('DELETE FROM push_tokens WHERE id = ?1').bind(id)
    ])
  }

  async putMessage(m: MessageRow & { now: number }): Promise<boolean> {
    await this.db.prepare('DELETE FROM control_messages WHERE expires_at <= ?1').bind(m.now).run()
    // One conditional INSERT: the count and the write are the same statement.
    const res = await this.db
      .prepare(
        `INSERT INTO control_messages (msg_id, to_device, from_device, ciphertext, expires_at, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE (SELECT COUNT(*) FROM control_messages WHERE to_device = ?2) < ?7`
      )
      .bind(m.msgId, m.to, m.from, m.ciphertext, m.expiresAt, m.now, MAX_PENDING_MESSAGES)
      .run()
    return (res.meta.changes ?? 0) > 0
  }

  async takeMessages(to: string, now: number): Promise<MessageRow[]> {
    const res = await this.db
      .prepare(
        `DELETE FROM control_messages WHERE to_device = ?1
         RETURNING msg_id, to_device, from_device, ciphertext, expires_at, created_at`
      )
      .bind(to)
      .all<{
        msg_id: string
        to_device: string
        from_device: string
        ciphertext: string
        expires_at: number
        created_at: number
      }>()
    return res.results
      .filter((r) => r.expires_at > now)
      .sort((a, b) => a.created_at - b.created_at)
      .map((r) => ({
        to: r.to_device,
        from: r.from_device,
        msgId: r.msg_id,
        ciphertext: r.ciphertext,
        expiresAt: r.expires_at
      }))
  }

  private async putSlot(table: string, s: SealedSlot): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO ${table} (id, from_device, msg_id, ciphertext, at) VALUES (1, ?1, ?2, ?3, ?4)`
      )
      .bind(s.from, s.msgId, s.ciphertext, s.at)
      .run()
  }

  private async getSlot(table: string): Promise<SealedSlot | null> {
    const row = await this.db
      .prepare(`SELECT from_device, msg_id, ciphertext, at FROM ${table} WHERE id = 1`)
      .first<{ from_device: string; msg_id: string; ciphertext: string; at: number }>()
    return row
      ? { from: row.from_device, msgId: row.msg_id, ciphertext: row.ciphertext, at: row.at }
      : null
  }

  putStatus(s: SealedSlot): Promise<void> {
    return this.putSlot('control_status', s)
  }

  getStatus(): Promise<SealedSlot | null> {
    return this.getSlot('control_status')
  }

  putEsp32Key(s: SealedSlot): Promise<void> {
    return this.putSlot('esp32_key', s)
  }

  getEsp32Key(): Promise<SealedSlot | null> {
    return this.getSlot('esp32_key')
  }

  async setPowerToken(hash: string, now: number): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO power_tokens (id, token_hash, created_at) VALUES (1, ?1, ?2)'
      )
      .bind(hash, now)
      .run()
  }

  async powerTokenMatches(hash: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 AS ok FROM power_tokens WHERE id = 1 AND token_hash = ?1')
      .bind(hash)
      .first<{ ok: number }>()
    return row !== null
  }

  async putPowerCommand(c: Omit<PowerCommandRow, 'takenAt'>): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO power_commands (id, cmd, at, exp, mac, taken_at) VALUES (1, ?1, ?2, ?3, ?4, NULL)'
      )
      .bind(c.cmd, c.at, c.exp, c.mac)
      .run()
  }

  async takePowerCommand(now: number): Promise<PowerCommandRow | null> {
    const row = await this.db
      .prepare(
        `UPDATE power_commands SET taken_at = ?1
         WHERE id = 1 AND taken_at IS NULL AND exp > ?1
         RETURNING cmd, at, exp, mac, taken_at`
      )
      .bind(now)
      .first<{ cmd: string; at: number; exp: number; mac: string; taken_at: number }>()
    return row
      ? { cmd: row.cmd, at: row.at, exp: row.exp, mac: row.mac, takenAt: row.taken_at }
      : null
  }

  async lastPowerCommand(): Promise<PowerCommandRow | null> {
    const row = await this.db
      .prepare('SELECT cmd, at, exp, mac, taken_at FROM power_commands WHERE id = 1')
      .first<{ cmd: string; at: number; exp: number; mac: string; taken_at: number | null }>()
    return row
      ? { cmd: row.cmd, at: row.at, exp: row.exp, mac: row.mac, takenAt: row.taken_at }
      : null
  }

  async putPowerState(s: Omit<PowerStateRow, 'lastPoll'>, now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO power_state (id, pc_ping, last_result, at, mac, last_poll) VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET pc_ping = excluded.pc_ping, last_result = excluded.last_result,
           at = excluded.at, mac = excluded.mac, last_poll = excluded.last_poll`
      )
      .bind(s.pcPing ? 1 : 0, s.lastResult, s.at, s.mac, now)
      .run()
  }

  async touchPowerPoll(now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO power_state (id, pc_ping, last_result, at, mac, last_poll) VALUES (1, 0, '', 0, '', ?1)
         ON CONFLICT(id) DO UPDATE SET last_poll = excluded.last_poll`
      )
      .bind(now)
      .run()
  }

  async getPowerState(): Promise<PowerStateRow | null> {
    const row = await this.db
      .prepare('SELECT pc_ping, last_result, at, mac, last_poll FROM power_state WHERE id = 1')
      .first<{ pc_ping: number; last_result: string; at: number; mac: string; last_poll: number }>()
    return row
      ? {
          pcPing: row.pc_ping === 1,
          lastResult: row.last_result,
          at: row.at,
          mac: row.mac,
          lastPoll: row.last_poll
        }
      : null
  }

  async putPushToken(id: string, token: string, now: number): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO push_tokens (id, token, at) VALUES (?1, ?2, ?3)')
      .bind(id, token, now)
      .run()
  }

  async pushTokens(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const res = await this.db
      .prepare(
        `SELECT token FROM push_tokens WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`
      )
      .bind(...ids)
      .all<{ token: string }>()
    return res.results.map((r) => r.token)
  }
}

// ── In memory (tests and local runs) ──────────────────────────────────────────────

export class MemoryControlDb implements ControlDb {
  roles = new Map<string, { role: Role; createdAt: number }>()
  messages: (MessageRow & { createdAt: number })[] = []
  status: SealedSlot | null = null
  esp32Key: SealedSlot | null = null
  powerTokenHash: string | null = null
  command: PowerCommandRow | null = null
  power: PowerStateRow | null = null
  push = new Map<string, string>()

  async getRoles(): Promise<{ pc: string | null; controllers: string[] }> {
    const rows = [...this.roles.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    return {
      pc: rows.find(([, r]) => r.role === 'pc')?.[0] ?? null,
      controllers: rows.filter(([, r]) => r.role === 'controller').map(([id]) => id)
    }
  }

  async setPc(id: string, now: number): Promise<void> {
    for (const [key, r] of this.roles) if (r.role === 'pc') this.roles.delete(key)
    this.roles.set(id, { role: 'pc', createdAt: now })
  }

  async addController(id: string, now: number): Promise<void> {
    if (!this.roles.has(id)) this.roles.set(id, { role: 'controller', createdAt: now })
  }

  async removeController(id: string): Promise<void> {
    if (this.roles.get(id)?.role === 'controller') this.roles.delete(id)
  }

  async clearControllers(except: string | null): Promise<void> {
    for (const [key, r] of this.roles) {
      if (r.role === 'controller' && key !== except) this.roles.delete(key)
    }
  }

  async forgetDevice(id: string): Promise<void> {
    this.roles.delete(id)
    this.push.delete(id)
  }

  async putMessage(m: MessageRow & { now: number }): Promise<boolean> {
    this.messages = this.messages.filter((x) => x.expiresAt > m.now)
    if (this.messages.filter((x) => x.to === m.to).length >= MAX_PENDING_MESSAGES) return false
    const { now, ...row } = m
    this.messages.push({ ...row, createdAt: now })
    return true
  }

  async takeMessages(to: string, now: number): Promise<MessageRow[]> {
    const mine = this.messages.filter((x) => x.to === to)
    this.messages = this.messages.filter((x) => x.to !== to)
    return mine
      .filter((x) => x.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ to: rowTo, from, msgId, ciphertext, expiresAt }) => ({
        to: rowTo,
        from,
        msgId,
        ciphertext,
        expiresAt
      }))
  }

  async putStatus(s: SealedSlot): Promise<void> {
    this.status = s
  }

  async getStatus(): Promise<SealedSlot | null> {
    return this.status
  }

  async putEsp32Key(s: SealedSlot): Promise<void> {
    this.esp32Key = s
  }

  async getEsp32Key(): Promise<SealedSlot | null> {
    return this.esp32Key
  }

  async setPowerToken(hash: string): Promise<void> {
    this.powerTokenHash = hash
  }

  async powerTokenMatches(hash: string): Promise<boolean> {
    return this.powerTokenHash !== null && this.powerTokenHash === hash
  }

  async putPowerCommand(c: Omit<PowerCommandRow, 'takenAt'>): Promise<void> {
    this.command = { ...c, takenAt: null }
  }

  async takePowerCommand(now: number): Promise<PowerCommandRow | null> {
    const c = this.command
    if (!c || c.takenAt !== null || c.exp <= now) return null
    c.takenAt = now
    return { ...c }
  }

  async lastPowerCommand(): Promise<PowerCommandRow | null> {
    return this.command ? { ...this.command } : null
  }

  async putPowerState(s: Omit<PowerStateRow, 'lastPoll'>, now: number): Promise<void> {
    this.power = { ...s, lastPoll: now }
  }

  async touchPowerPoll(now: number): Promise<void> {
    this.power = this.power
      ? { ...this.power, lastPoll: now }
      : { pcPing: false, lastResult: '', at: 0, mac: '', lastPoll: now }
  }

  async getPowerState(): Promise<PowerStateRow | null> {
    return this.power ? { ...this.power } : null
  }

  async putPushToken(id: string, token: string): Promise<void> {
    this.push.set(id, token)
  }

  async pushTokens(ids: string[]): Promise<string[]> {
    return ids.flatMap((id) => (this.push.has(id) ? [this.push.get(id) as string] : []))
  }
}
