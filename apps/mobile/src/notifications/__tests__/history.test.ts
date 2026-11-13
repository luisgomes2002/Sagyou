import { NOTIFICATION_FALLBACK, NOTIFICATION_TEXT, NOTIFY_CODES } from '@sagyou/core/control/notify'
import { historyTime } from '../format'
import {
  HISTORY_MAX,
  addEntry,
  entryText,
  markAllRead,
  parseHistory,
  unreadCount,
  type HistoryEntry
} from '../history'

const NOW = new Date(2026, 10, 13, 15, 0).getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'n1',
  code: 'ready',
  at: NOW,
  read: false,
  ...over
})

describe('histórico de notificações', () => {
  it('guarda a mais nova primeiro e não repete o mesmo id', () => {
    let list: HistoryEntry[] = []
    list = addEntry(list, entry({ id: 'a', code: 'ready', at: NOW - 10 * MIN }), NOW)
    list = addEntry(list, entry({ id: 'b', code: 'approval', at: NOW }), NOW)
    list = addEntry(list, entry({ id: 'b', code: 'approval', at: NOW + 5 * MIN }), NOW)
    expect(list.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('o mesmo código a menos de 60 s é a mesma notificação (barra e toque com ids diferentes)', () => {
    let list = addEntry([], entry({ id: 'barra', code: 'approval', at: NOW }), NOW)
    list = addEntry(list, entry({ id: 'toque', code: 'approval', at: NOW + 59_000 }), NOW)
    expect(list).toHaveLength(1)
    list = addEntry(list, entry({ id: 'outra', code: 'approval', at: NOW + 120_000 }), NOW)
    expect(list).toHaveLength(2)
    // Códigos diferentes no mesmo instante são duas notificações.
    list = addEntry(list, entry({ id: 'x', code: 'ready', at: NOW }), NOW)
    expect(list).toHaveLength(3)
  })

  it('a 101ª entrada derruba a mais velha', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_MAX + 1; i++) {
      list = addEntry(
        list,
        entry({ id: `n${i}`, code: 'ready', at: NOW - 1000 * MIN + i * 2 * MIN }),
        NOW
      )
    }
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list.some((e) => e.id === 'n0')).toBe(false)
    expect(list[0].id).toBe(`n${HISTORY_MAX}`)
  })

  it('entrada de 31 dias some e uma de 29 dias fica', () => {
    const list = addEntry(
      [
        entry({ id: 'velha', at: NOW - 31 * DAY }),
        entry({ id: 'nova', code: 'access-cut', at: NOW - 29 * DAY })
      ],
      entry({ id: 'agora', code: 'suspended' }),
      NOW
    )
    expect(list.map((e) => e.id)).toEqual(['agora', 'nova'])
  })

  it('valor corrompido lê como vazio; item quebrado é ignorado e o resto fica', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('')).toEqual([])
    expect(parseHistory('{nao json')).toEqual([])
    expect(parseHistory('{"id":"a"}')).toEqual([])
    const raw = JSON.stringify([
      { id: 'ok', code: 'ready', at: 5, read: true },
      { id: '', code: 'ready', at: 5, read: true },
      { id: 'sem-at', code: 'ready', read: true },
      { id: 'codigo', code: 'session-waiting', at: 5, read: true },
      { id: 'lido', code: 'ready', at: 6, read: 'sim' },
      null,
      7
    ])
    expect(parseHistory(raw)).toEqual([{ id: 'ok', code: 'ready', at: 5, read: true }])
  })

  it('o texto da entrada vem do core; unknown usa o corpo da notificação, cortado em 200', () => {
    for (const code of NOTIFY_CODES) {
      expect(entryText(entry({ code }))).toBe(NOTIFICATION_TEXT[code])
    }
    expect(entryText(entry({ code: 'unknown' }))).toBe(NOTIFICATION_FALLBACK)
    expect(entryText(entry({ code: 'unknown', text: 'Aviso novo' }))).toBe('Aviso novo')
    const long = addEntry([], entry({ id: 'l', code: 'unknown', text: 'x'.repeat(300) }), NOW)
    expect(long[0].text).toHaveLength(200)
    // Só 'unknown' guarda texto: um código conhecido nunca carrega o corpo.
    const raw = JSON.stringify([{ id: 'a', code: 'ready', at: 5, read: true, text: 'segredo' }])
    expect(parseHistory(raw)[0]).not.toHaveProperty('text')
  })

  it('marca tudo como lido e conta as não lidas', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b', code: 'access-cut', at: NOW + 1 })]
    expect(unreadCount(list)).toBe(2)
    const read = markAllRead(list)
    expect(unreadCount(read)).toBe(0)
    expect(markAllRead(read)).toBe(read)
  })
})

describe('historyTime', () => {
  const at = (day: number, h: number, m: number): number => new Date(2026, 10, day, h, m).getTime()

  it('hoje, ontem e uma data', () => {
    expect(historyTime(at(13, 14, 32), NOW)).toBe('hoje 14:32')
    expect(historyTime(at(12, 9, 10), NOW)).toBe('ontem 09:10')
    expect(historyTime(at(8, 23, 5), NOW)).toBe('08/11 23:05')
  })

  it('ontem vale também na virada do mês', () => {
    const now = new Date(2026, 11, 1, 8, 0).getTime()
    expect(historyTime(new Date(2026, 10, 30, 22, 0).getTime(), now)).toBe('ontem 22:00')
  })
})
