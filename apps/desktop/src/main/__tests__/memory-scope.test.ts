// @vitest-environment node
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'
import { memorySearchWhere, searchScopeFor } from '../modules/ai/memory-scope'

describe('searchScopeFor', () => {
  it('um projeto busca só ele (e as globais), sem abrir para todos', () => {
    expect(searchScopeFor('p1')).toEqual({ projectId: 'p1', allProjects: false })
  })

  it('sem projeto na sessão (undefined) busca em todos os projetos', () => {
    expect(searchScopeFor(undefined)).toEqual({ projectId: null, allProjects: true })
  })

  it('null explícito busca só as globais, nunca todos', () => {
    expect(searchScopeFor(null)).toEqual({ projectId: null, allProjects: false })
  })
})

describe('memorySearchWhere', () => {
  it('projeto: o próprio projeto mais as globais', () => {
    expect(memorySearchWhere({ projectId: 'p1' })).toEqual({
      where: ['m.archived_at IS NULL', '(m.project_id=? OR m.project_id IS NULL)'],
      params: ['p1']
    })
  })

  it('sem projeto: só globais', () => {
    expect(memorySearchWhere({ projectId: null })).toEqual({
      where: ['m.archived_at IS NULL', 'm.project_id IS NULL'],
      params: []
    })
  })

  it('todos os projetos: sem filtro de projeto, mesmo com um projectId junto', () => {
    expect(memorySearchWhere({ projectId: 'p1', allProjects: true })).toEqual({
      where: ['m.archived_at IS NULL'],
      params: []
    })
  })

  it('arquivadas e tipo', () => {
    expect(memorySearchWhere({ projectId: null, includeArchived: true, type: 'handoff' })).toEqual({
      where: ['1=1', 'm.project_id IS NULL', 'm.type=?'],
      params: ['handoff']
    })
  })
})

// The clause is what keeps one project's memories out of another's search, so it
// is run for real: node:sqlite stands in for better-sqlite3, which will not load here.
describe('memorySearchWhere contra um SQLite de verdade', () => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec: (sql: string) => void
      prepare: (sql: string) => { all: (...params: unknown[]) => { id: string }[] }
    }
  }
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE memory (id TEXT, project_id TEXT, type TEXT, archived_at TEXT);
    INSERT INTO memory VALUES
      ('p1-fato', 'p1', 'fato', NULL),
      ('p1-handoff', 'p1', 'handoff', NULL),
      ('p1-arquivada', 'p1', 'fato', '2026-01-01'),
      ('p2-fato', 'p2', 'fato', NULL),
      ('p2-handoff', 'p2', 'handoff', NULL),
      ('global-fato', NULL, 'fato', NULL);`)

  const run = (opts: Parameters<typeof memorySearchWhere>[0]): string[] => {
    const { where, params } = memorySearchWhere(opts)
    return db
      .prepare(`SELECT m.id FROM memory m WHERE ${where.join(' AND ')} ORDER BY m.id`)
      .all(...params)
      .map((row) => row.id)
  }

  it('uma busca do projeto p1 nunca traz memória do p2', () => {
    const ids = run({ projectId: 'p1' })
    expect(ids).toEqual(['global-fato', 'p1-fato', 'p1-handoff'])
    expect(ids.some((id) => id.startsWith('p2-'))).toBe(false)
  })

  it('sem projeto só vêm as globais', () => {
    expect(run({ projectId: null })).toEqual(['global-fato'])
  })

  it('todos os projetos traz todos, sem arquivadas', () => {
    expect(run({ projectId: null, allProjects: true })).toEqual([
      'global-fato',
      'p1-fato',
      'p1-handoff',
      'p2-fato',
      'p2-handoff'
    ])
  })

  it('o filtro de tipo continua dentro do escopo', () => {
    expect(run({ projectId: 'p1', type: 'handoff' })).toEqual(['p1-handoff'])
  })

  it('incluir arquivadas não abre outro projeto', () => {
    expect(run({ projectId: 'p1', includeArchived: true })).toEqual([
      'global-fato',
      'p1-arquivada',
      'p1-fato',
      'p1-handoff'
    ])
  })
})
