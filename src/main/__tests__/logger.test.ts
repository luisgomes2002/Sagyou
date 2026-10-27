/**
 * Main-process code: runs in Node, not the suite's default jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLogger, LOG_DAY_BYTE_LIMIT, LOG_RETENTION_DAYS } from '../modules/logs/logger'

let dir: string
let clock: number

const at = (iso: string): void => {
  clock = new Date(iso).getTime()
}
const make = (): ReturnType<typeof createLogger> => createLogger({ dir, now: () => clock })
const lines = async (day: string): Promise<Record<string, unknown>[]> =>
  (await readFile(join(dir, `${day}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sagyou-logs-'))
  at('2026-10-27T12:00:00.000Z')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('logger', () => {
  it('appends one JSON line per event to the file of the day', async () => {
    const log = make()
    log.info('app', 'started', { version: '1.0.1', platform: 'linux' })
    log.error('backup', 'import_failed', { msg: 'boom' })
    const written = await lines('2026-10-27')
    expect(written).toEqual([
      {
        ts: '2026-10-27T12:00:00.000Z',
        level: 'info',
        area: 'app',
        event: 'started',
        data: { version: '1.0.1', platform: 'linux' }
      },
      {
        ts: '2026-10-27T12:00:00.000Z',
        level: 'error',
        area: 'backup',
        event: 'import_failed',
        msg: 'boom'
      }
    ])
  })

  it('switches file when the day changes', async () => {
    const log = make()
    log.info('app', 'one')
    at('2026-10-28T12:00:00.000Z')
    log.info('app', 'two')
    expect((await readdir(dir)).sort()).toEqual(['2026-10-27.jsonl', '2026-10-28.jsonl'])
  })

  it('redacts secrets and truncates long strings', async () => {
    const log = make()
    log.error('mcp', 'failed', {
      msg: 'call failed: Bearer abcdefghijklmnopqrstuvwxyz123456',
      detail: 'x'.repeat(800)
    })
    const [line] = await lines('2026-10-27')
    expect(line.msg).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect((line.data as { detail: string }).detail.length).toBeLessThanOrEqual(500)
  })

  it('drops forbidden keys and non-primitive values', async () => {
    const log = make()
    log.info('mcp', 'tool_call', {
      runId: 'r1',
      token: 'secret-token',
      title: 'Minha task',
      amount: '1500.45',
      args: 'x',
      nested: { token: 'x' } as unknown as string,
      ok: true,
      ms: 12
    })
    const [line] = await lines('2026-10-27')
    expect(line.data).toEqual({ runId: 'r1', ok: true, ms: 12 })
  })

  it('stops writing info once the day passes the byte limit, but keeps errors', async () => {
    await writeFile(join(dir, '2026-10-27.jsonl'), 'x'.repeat(LOG_DAY_BYTE_LIMIT) + '\n')
    const log = make()
    log.info('app', 'noise')
    log.warn('app', 'careful')
    log.error('app', 'broken')
    const raw = await readFile(join(dir, '2026-10-27.jsonl'), 'utf8')
    expect(raw).not.toContain('noise')
    expect(raw).toContain('careful')
    expect(raw).toContain('broken')
  })

  it('never throws when the directory is unusable', () => {
    const log = createLogger({ dir: join(dir, 'missing', '\0bad'), now: () => clock })
    expect(() => log.error('app', 'x')).not.toThrow()
    expect(log.readLogs({})).toEqual({ entries: [], truncated: false })
    expect(() => log.prune()).not.toThrow()
  })

  it('prunes day files older than the retention window only', async () => {
    const keep = '2026-10-14.jsonl'
    const old = '2026-10-12.jsonl'
    for (const name of [keep, old, 'notes.txt']) await writeFile(join(dir, name), '')
    make().prune()
    expect((await readdir(dir)).sort()).toEqual([keep, 'notes.txt'])
    expect(LOG_RETENTION_DAYS).toBe(14)
  })

  it('reads entries newest first, filtered by level, area and period', () => {
    const log = make()
    at('2026-10-25T12:00:00.000Z')
    log.error('pty', 'old_error')
    at('2026-10-27T10:00:00.000Z')
    log.info('pty', 'started')
    log.warn('mcp', 'slow')
    log.error('pty', 'crashed')

    expect(log.readLogs({}).entries.map((e) => e.event)).toEqual(['crashed', 'slow', 'started'])
    expect(log.readLogs({ level: 'warn' }).entries.map((e) => e.event)).toEqual(['crashed', 'slow'])
    expect(log.readLogs({ area: 'pty', since: '7d' }).entries.map((e) => e.event)).toEqual([
      'crashed',
      'started',
      'old_error'
    ])
    expect(
      log.readLogs({ since: '2026-10-27T10:00:00.000Z', level: 'error' }).entries
    ).toHaveLength(1)
  })

  it('limits the result and reports truncation', () => {
    const log = make()
    for (let i = 0; i < 5; i++) log.info('app', `e${i}`)
    const result = log.readLogs({ limit: 2 })
    expect(result.entries.map((e) => e.event)).toEqual(['e4', 'e3'])
    expect(result.truncated).toBe(true)
    expect(log.readLogs({ limit: 1000 }).entries).toHaveLength(5)
  })

  it('skips corrupted lines when reading', async () => {
    await writeFile(join(dir, '2026-10-27.jsonl'), 'not json\n')
    const log = make()
    log.info('app', 'fine')
    expect(log.readLogs({}).entries.map((e) => e.event)).toEqual(['fine'])
  })
})
