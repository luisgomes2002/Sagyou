import { createRecordRepo } from '../../data/records'
import { migrate } from '../../data/schema'
import { openNodeDb } from '../../data/__tests__/node-db'
import { HISTORY_PREF } from '../history'
import { useNotifications } from '../store'

const NOW = new Date(2026, 10, 13, 15, 0).getTime()

function repo(): ReturnType<typeof createRecordRepo> {
  const db = openNodeDb()
  migrate(db)
  return createRecordRepo(db)
}

describe('store de notificações', () => {
  beforeEach(() => useNotifications.getState().reset())

  it('salva cada mudança na pref do aparelho e lê de volta', () => {
    const r = repo()
    useNotifications.getState().load(r)
    useNotifications.getState().add({ id: 'a', code: 'ready', at: NOW, read: false }, NOW)
    expect(useNotifications.getState().unread).toBe(1)
    expect(JSON.parse(r.readPref(HISTORY_PREF) as string)).toEqual([
      { id: 'a', code: 'ready', at: NOW, read: false }
    ])
    useNotifications.getState().markAllRead()
    expect(useNotifications.getState().unread).toBe(0)
    useNotifications.getState().reset()
    useNotifications.getState().load(r)
    expect(useNotifications.getState().entries).toEqual([
      { id: 'a', code: 'ready', at: NOW, read: true }
    ])
  })

  it('o JSON guardado só tem id, code, at, read (e text em unknown): nada de cartão', () => {
    const r = repo()
    useNotifications.getState().load(r)
    useNotifications.getState().add({ id: 'a', code: 'approval', at: NOW, read: false }, NOW)
    useNotifications
      .getState()
      .add({ id: 'u', code: 'unknown', at: NOW + 120_000, read: false, text: 'Aviso' }, NOW)
    const saved = JSON.parse(r.readPref(HISTORY_PREF) as string) as Record<string, unknown>[]
    for (const e of saved) {
      for (const key of Object.keys(e)) expect(['id', 'code', 'at', 'read', 'text']).toContain(key)
    }
    expect(saved.find((e) => e.id === 'a')).not.toHaveProperty('text')
  })

  it('limpar apaga o histórico e a pref', () => {
    const r = repo()
    useNotifications.getState().load(r)
    useNotifications.getState().add({ id: 'a', code: 'ready', at: NOW, read: false }, NOW)
    useNotifications.getState().clear()
    expect(useNotifications.getState().entries).toEqual([])
    expect(r.readPref(HISTORY_PREF)).toBeNull()
  })

  it('valor corrompido na pref abre como lista vazia, sem derrubar nada', () => {
    const r = repo()
    r.writePref(HISTORY_PREF, '{quebrado')
    expect(() => useNotifications.getState().load(r)).not.toThrow()
    expect(useNotifications.getState().entries).toEqual([])
  })

  it('reset (o wipe) zera a memória sem gravar de volta', () => {
    const r = repo()
    useNotifications.getState().load(r)
    useNotifications.getState().add({ id: 'a', code: 'ready', at: NOW, read: false }, NOW)
    r.writePref(HISTORY_PREF, null)
    useNotifications.getState().reset()
    expect(useNotifications.getState().entries).toEqual([])
    expect(r.readPref(HISTORY_PREF)).toBeNull()
  })
})
