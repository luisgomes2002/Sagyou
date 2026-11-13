// @vitest-environment node
//
// "PC sem sinal" (spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md).
import { describe, expect, it } from 'vitest'
import { MemoryControlDb } from '../control-db'
import type { NotifyCode } from '../control-routes'
import { SILENT_MS, runWatchdog } from '../watchdog'

const PC = 'a'.repeat(32)
const PHONE = 'b'.repeat(32)
const NOW = 1_800_000_000_000
const MIN = 60_000

async function world(
  opts: { watch?: boolean; heartbeatAgo?: number; from?: string } = {}
): Promise<{
  db: MemoryControlDb
  sent: { ids: string[]; code: NotifyCode }[]
  run: () => Promise<string>
}> {
  const db = new MemoryControlDb()
  await db.setPc(PC, 1)
  await db.addController(PHONE, 2)
  await db.putStatus({
    from: opts.from ?? PC,
    msgId: 'status-0001',
    ciphertext: 'Y2lmcmFkbw==',
    at: NOW - (opts.heartbeatAgo ?? 11 * MIN)
  })
  await db.putWatch(opts.watch ?? true)
  const sent: { ids: string[]; code: NotifyCode }[] = []
  return {
    db,
    sent,
    run: () =>
      runWatchdog(
        db,
        async (ids, code) => {
          sent.push({ ids, code })
        },
        NOW
      )
  }
}

describe('runWatchdog', () => {
  it('avisa os controladores uma vez quando o PC devia responder e calou há mais de 10 min', async () => {
    const w = await world()
    expect(await w.run()).toBe('sent')
    expect(w.sent).toEqual([{ ids: [PHONE], code: 'pc-silent' }])
    expect(await w.run()).toBe('none')
    expect(w.sent).toHaveLength(1)
  })

  it('um novo heartbeat reabilita o aviso para a próxima queda', async () => {
    const w = await world()
    await w.run()
    await w.db.putWatch(true)
    await w.db.putStatus({
      from: PC,
      msgId: 'status-0002',
      ciphertext: 'Y2lmcmFkbw==',
      at: NOW - 12 * MIN
    })
    expect(await w.run()).toBe('sent')
    expect(w.sent).toHaveLength(2)
  })

  it('não avisa com watch desligado (PC desligado de propósito ou PC antigo)', async () => {
    const w = await world({ watch: false })
    expect(await w.run()).toBe('none')
    expect(w.sent).toEqual([])
  })

  it('não avisa antes de 10 min', async () => {
    const w = await world({ heartbeatAgo: SILENT_MS - 1000 })
    expect(await w.run()).toBe('none')
  })

  it('não avisa se o heartbeat é de um aparelho que não é mais o PC', async () => {
    const w = await world({ from: PHONE })
    expect(await w.run()).toBe('none')
  })

  it('não avisa depois de um desligamento forçado pelo ESP32 logo após o último heartbeat', async () => {
    const w = await world()
    await w.db.putPowerCommand({
      cmd: 'shutdown',
      at: NOW - 11 * MIN + 30_000,
      exp: NOW,
      mac: 'f'.repeat(64)
    })
    expect(await w.run()).toBe('none')
  })

  it('um shutdown antigo (horas antes) não suprime o aviso', async () => {
    const w = await world()
    await w.db.putPowerCommand({
      cmd: 'shutdown',
      at: NOW - 2 * 60 * MIN,
      exp: NOW,
      mac: 'f'.repeat(64)
    })
    expect(await w.run()).toBe('sent')
  })

  it('sem linha em pc_watch (D1 sem a tabela) não faz nada e não lança', async () => {
    const db = new MemoryControlDb()
    await db.setPc(PC, 1)
    const out = await runWatchdog(db, async () => undefined, NOW)
    expect(out).toBe('none')
    const broken = new MemoryControlDb()
    broken.getWatch = async () => {
      throw new Error('no such table: pc_watch')
    }
    expect(await runWatchdog(broken, async () => undefined, NOW)).toBe('none')
  })

  it('um push que falha não derruba o agendamento', async () => {
    const w = await world()
    const out = await runWatchdog(
      w.db,
      async () => {
        throw new Error('fcm')
      },
      NOW
    )
    expect(out).toBe('none')
  })
})
