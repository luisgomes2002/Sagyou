// The in-memory ControlDb the route tests use. Its rules are the contract the D1
// implementation follows; schema.sql is checked for the tables it needs.
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MAX_PENDING_MESSAGES, MemoryControlDb } from '../control-db'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const C = 'c'.repeat(32)

const msg = (
  to: string,
  msgId: string,
  expiresAt = 10_000
): {
  to: string
  from: string
  msgId: string
  ciphertext: string
  expiresAt: number
  now: number
} => ({ to, from: A, msgId, ciphertext: 'x', expiresAt, now: 1000 })

describe('MemoryControlDb', () => {
  it('só existe um PC', async () => {
    const db = new MemoryControlDb()
    await db.setPc(A, 1)
    await db.setPc(B, 2)
    expect((await db.getRoles()).pc).toBe(B)
    expect(db.roles.has(A)).toBe(false)
  })

  it('controles entram, saem e clearControllers mantém só a exceção', async () => {
    const db = new MemoryControlDb()
    await db.setPc(A, 1)
    await db.addController(B, 2)
    await db.addController(C, 3)
    await db.removeController(B)
    expect((await db.getRoles()).controllers).toEqual([C])
    await db.addController(B, 4)
    await db.clearControllers(B)
    expect(await db.getRoles()).toEqual({ pc: A, controllers: [B] })
    await db.removeController(A)
    expect((await db.getRoles()).pc).toBe(A)
  })

  it('takeMessages entrega uma vez e não devolve expiradas', async () => {
    const db = new MemoryControlDb()
    await db.putMessage(msg(B, 'm1'))
    await db.putMessage(msg(B, 'm2', 1500))
    await db.putMessage(msg(C, 'm3'))
    expect((await db.takeMessages(B, 2000)).map((m) => m.msgId)).toEqual(['m1'])
    expect(await db.takeMessages(B, 2000)).toEqual([])
    expect((await db.takeMessages(C, 2000)).map((m) => m.msgId)).toEqual(['m3'])
  })

  it(`recusa a mensagem ${MAX_PENDING_MESSAGES + 1} para o mesmo destinatário`, async () => {
    const db = new MemoryControlDb()
    for (let i = 0; i < MAX_PENDING_MESSAGES; i++) {
      expect(await db.putMessage(msg(B, `m${i}`))).toBe(true)
    }
    expect(await db.putMessage(msg(B, 'extra'))).toBe(false)
    expect(await db.putMessage(msg(C, 'outro'))).toBe(true)
  })

  it('forgetDevice remove o papel e o token FCM', async () => {
    const db = new MemoryControlDb()
    await db.addController(B, 1)
    await db.putPushToken(B, 'fcm', 1)
    await db.forgetDevice(B)
    expect((await db.getRoles()).controllers).toEqual([])
    expect(await db.pushTokens([B])).toEqual([])
  })

  it('o comando de energia sai uma vez e não sai depois de expirar', async () => {
    const db = new MemoryControlDb()
    await db.putPowerCommand({ cmd: 'wake', at: 1000, exp: 121_000, mac: 'm' })
    expect((await db.takePowerCommand(2000))?.cmd).toBe('wake')
    expect(await db.takePowerCommand(3000)).toBeNull()
    await db.putPowerCommand({ cmd: 'shutdown', at: 1000, exp: 121_000, mac: 'm' })
    expect(await db.takePowerCommand(121_000)).toBeNull()
    expect((await db.lastPowerCommand())?.cmd).toBe('shutdown')
  })
})

describe('schema.sql', () => {
  it('cria as tabelas do controle remoto sem mexer nas do sync', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf8')
    for (const table of [
      'device_roles',
      'control_messages',
      'control_status',
      'esp32_key',
      'power_tokens',
      'power_commands',
      'power_state',
      'push_tokens'
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`)
    }
    expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE/i)
  })
})
