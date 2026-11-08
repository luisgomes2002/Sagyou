// D1ControlDb's inbox with a fake D1 (review of PR #48): the messages must never
// be deleted before their factor marks are read, a restore is stored with its
// mark atomically, and a D1 that never got control_factor_checked keeps the
// inbox working (no factor: a restore fails closed, everything else arrives).
import { describe, expect, it } from 'vitest'
import { D1ControlDb } from '../control-db'
import type { D1Database, D1PreparedStatement, D1Result } from '../db'

interface Msg {
  msg_id: string
  to_device: string
  from_device: string
  ciphertext: string
  expires_at: number
  created_at: number
}

const A = 'a'.repeat(32)
const PC = 'p'.repeat(32)

/** Just the statements D1ControlDb's inbox runs, over two arrays. */
class FakeD1 implements D1Database {
  messages: Msg[] = []
  marks: { msg_id: string; expires_at: number }[] = []
  marksTable = true
  batches: string[][] = []

  private exec(sql: string, args: unknown[]): D1Result<Record<string, unknown>> {
    const ok = (results: Record<string, unknown>[] = [], changes = 0): D1Result<never> =>
      ({ results, success: true, meta: { changes } }) as unknown as D1Result<never>
    if (sql.includes('control_factor_checked') && !this.marksTable)
      throw new Error('D1_ERROR: no such table: control_factor_checked')
    const [a1, a2, a3, a4, a5, a6, a7] = args
    if (sql.startsWith('DELETE FROM control_messages WHERE expires_at')) {
      this.messages = this.messages.filter((m) => m.expires_at > Number(a1))
      return ok()
    }
    if (sql.startsWith('INSERT INTO control_messages')) {
      if (this.messages.filter((m) => m.to_device === a2).length >= Number(a7)) return ok([], 0)
      this.messages.push({
        msg_id: String(a1),
        to_device: String(a2),
        from_device: String(a3),
        ciphertext: String(a4),
        expires_at: Number(a5),
        created_at: Number(a6)
      })
      return ok([], 1)
    }
    if (sql.startsWith('INSERT OR REPLACE INTO control_factor_checked')) {
      if (!this.messages.some((m) => m.msg_id === a1)) return ok([], 0)
      this.marks = this.marks.filter((k) => k.msg_id !== a1)
      this.marks.push({ msg_id: String(a1), expires_at: Number(a2) })
      return ok([], 1)
    }
    if (sql.startsWith('SELECT msg_id FROM control_factor_checked')) {
      const mine = new Set(this.messages.filter((m) => m.to_device === a1).map((m) => m.msg_id))
      return ok(this.marks.filter((k) => mine.has(k.msg_id)).map((k) => ({ msg_id: k.msg_id })))
    }
    if (sql.startsWith('DELETE FROM control_messages WHERE to_device')) {
      const taken = this.messages.filter((m) => m.to_device === a1)
      this.messages = this.messages.filter((m) => m.to_device !== a1)
      return ok(taken as unknown as Record<string, unknown>[], taken.length)
    }
    if (sql.startsWith('DELETE FROM control_factor_checked')) {
      const live = new Set(this.messages.map((m) => m.msg_id))
      this.marks = this.marks.filter((k) => k.expires_at > Number(a1) && live.has(k.msg_id))
      return ok()
    }
    throw new Error(`unexpected SQL: ${sql}`)
  }

  prepare(query: string): D1PreparedStatement {
    const sql = query.trim().replace(/\s+/g, ' ')
    let args: unknown[] = []
    const stmt = {
      sql,
      bind: (...values: unknown[]) => {
        args = values
        return stmt
      },
      args: () => args,
      first: async () => (this.exec(sql, args).results[0] ?? null) as never,
      all: async () => this.exec(sql, args) as never,
      run: async () => this.exec(sql, args) as never
    }
    return stmt as unknown as D1PreparedStatement
  }

  // Atomic like D1: any failure leaves both tables as they were.
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const list = statements as unknown as { sql: string; args: () => unknown[] }[]
    this.batches.push(list.map((s) => s.sql))
    const saved = { messages: [...this.messages], marks: [...this.marks] }
    try {
      return list.map((s) => this.exec(s.sql, s.args())) as unknown as D1Result<T>[]
    } catch (err) {
      this.messages = saved.messages
      this.marks = saved.marks
      throw err
    }
  }
}

const put = (db: D1ControlDb, msgId: string, factor = false): Promise<boolean> =>
  db.putMessage({
    to: PC,
    from: A,
    msgId,
    ciphertext: 'x',
    expiresAt: 10_000,
    now: 1000,
    ...(factor ? { factor: true } : {})
  })

describe('D1ControlDb, caixa de entrada', () => {
  it('a marca de fator chega com a mensagem e sai com ela', async () => {
    const d1 = new FakeD1()
    const db = new D1ControlDb(d1)
    expect(await put(db, 'restaurar', true)).toBe(true)
    expect(await put(db, 'desbloquear')).toBe(true)
    // Message and mark in the same batch: never a restore stored without its mark.
    expect(
      d1.batches.some(
        (b) =>
          b.some((s) => s.startsWith('INSERT INTO control_messages')) &&
          b.some((s) => s.startsWith('INSERT OR REPLACE INTO control_factor_checked'))
      )
    ).toBe(true)
    const taken = await db.takeMessages(PC, 2000)
    expect(taken.map((m) => [m.msgId, m.factor === true])).toEqual([
      ['restaurar', true],
      ['desbloquear', false]
    ])
    expect(d1.marks).toEqual([])
    expect(await db.takeMessages(PC, 2000)).toEqual([])
  })

  it('sem a tabela de marcas a caixa continua entregando, sem fator', async () => {
    const d1 = new FakeD1()
    const db = new D1ControlDb(d1)
    await put(db, 'cortar')
    d1.marksTable = false
    const taken = await db.takeMessages(PC, 2000)
    expect(taken.map((m) => [m.msgId, m.factor === true])).toEqual([['cortar', false]])
  })

  it('restaurar sem a tabela de marcas falha sem guardar a mensagem', async () => {
    const d1 = new FakeD1()
    d1.marksTable = false
    const db = new D1ControlDb(d1)
    await expect(put(db, 'restaurar', true)).rejects.toThrow(/no such table/)
    expect(d1.messages).toEqual([])
  })
})
