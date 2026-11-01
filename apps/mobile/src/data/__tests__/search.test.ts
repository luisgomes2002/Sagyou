import { migrate } from '../schema'
import { rebuildSearchIndex, searchRecords } from '../search'
import type { SqlDb } from '../sql'
import { emptyState, type MobileState } from '../state'
import { openNodeDb } from './node-db'

const T = '2026-10-01T00:00:00.000Z'

function state(): MobileState {
  const s = emptyState()
  const project = (id: string, archivedAt?: string): MobileState['projects'][number] =>
    ({
      id,
      name: id === 'p1' ? 'Sagyou' : 'Antigo',
      color: '#000',
      order: 0,
      createdAt: T,
      updatedAt: T,
      archivedAt,
      columns: [{ id: `${id}-c`, name: 'A fazer', order: 0 }]
    }) as unknown as MobileState['projects'][number]
  s.projects = [project('p1'), project('p2', T)]
  const task = (id: string, projectId: string, title: string): MobileState['tasks'][number] => ({
    id,
    projectId,
    columnId: `${projectId}-c`,
    title,
    priority: 'medium',
    tags: ['mercearia'],
    order: 0,
    createdAt: T,
    updatedAt: T
  })
  s.tasks = [task('t1', 'p1', 'Lista do mês'), task('t2', 'p2', 'Mercado antigo')]
  const table = (
    id: string,
    profileId: string,
    description: string
  ): MobileState['lists'][number] => ({
    id,
    name: id,
    currency: 'BRL',
    profileId,
    items: [],
    goals: [],
    transactions: [
      { id: `${id}-tx`, description, amount: '10', type: 'expense', date: '2026-10-05' }
    ],
    createdAt: T,
    updatedAt: T
  })
  s.lists = [
    table('pessoal', 'personal', 'Mercado'),
    table('empresa', 'trabalho', 'Mercado do escritório')
  ]
  return s
}

function setup(): SqlDb {
  const db = openNodeDb()
  migrate(db)
  rebuildSearchIndex(db, state())
  return db
}

const ids = (db: SqlDb, text: string, profile = 'personal'): string[] =>
  searchRecords(db, text, profile).map((h) => `${h.kind}:${h.id}`)

describe('busca no celular', () => {
  it('"merc" acha a transação do perfil ativo e não a de outro perfil', () => {
    const db = setup()
    const hits = ids(db, 'merc')
    expect(hits).toContain('transaction:pessoal-tx')
    expect(hits).not.toContain('transaction:empresa-tx')
    // The task tagged "mercearia" matches through its tags.
    expect(hits).toContain('task:t1')
  })

  it('uma tabela recebida em outro perfil muda o resultado das transações dela', () => {
    const db = setup()
    const moved = state()
    moved.lists[1] = { ...moved.lists[1], profileId: 'personal' }
    rebuildSearchIndex(db, moved)
    expect(ids(db, 'escritório')).toEqual(['transaction:empresa-tx'])
  })

  it('tarefa de projeto arquivado não aparece', () => {
    const db = setup()
    expect(ids(db, 'antigo')).toEqual([])
  })

  it('uma tarefa excluída sai da busca', () => {
    const db = setup()
    const next = state()
    next.tasks = next.tasks.filter((t) => t.id !== 't1')
    rebuildSearchIndex(db, next)
    expect(ids(db, 'lista')).toEqual([])
  })

  it('texto vazio não consulta, e aspas ou * não quebram a consulta', () => {
    const db = setup()
    const all = jest.spyOn(db, 'all')
    expect(searchRecords(db, '   ', 'personal')).toEqual([])
    expect(all).not.toHaveBeenCalled()
    expect(() => searchRecords(db, '"merc*" OR NEAR(', 'personal')).not.toThrow()
    expect(ids(db, '"merc*"')).toContain('transaction:pessoal-tx')
  })
})
