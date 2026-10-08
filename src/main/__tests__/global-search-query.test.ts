// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getGlobalSearchHit, queryGlobalSearch, searchMatch } from '../global-search-query'

function database(
  rows: Record<string, unknown>[],
  total = rows.length
): {
  db: Parameters<typeof queryGlobalSearch>[0]
  calls: { sql: string; params: unknown[] }[]
} {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    prepare: (sql: string) => ({
      get: (...params: unknown[]) => {
        calls.push({ sql, params })
        return { total }
      },
      all: (...params: unknown[]) => {
        calls.push({ sql, params })
        return rows
      }
    })
  } as unknown as Parameters<typeof queryGlobalSearch>[0]
  return { db, calls }
}

describe('global search query', () => {
  it('turns user text into quoted FTS tokens without accepting query operators', () => {
    expect(searchMatch('  hábito OR "segredo"  ')).toEqual({
      tokens: ['hábito', 'OR', 'segredo'],
      match: '"hábito"* AND "OR"* AND "segredo"*'
    })
    expect(searchMatch('"* : +')).toEqual({ tokens: [], match: '' })
  })

  it('returns no rows for an empty or punctuation-only query', () => {
    const { db, calls } = database([])
    expect(queryGlobalSearch(db, { term: '  ::  ' }, 'personal')).toMatchObject({
      results: [],
      total: 0,
      hasMore: false
    })
    expect(calls).toEqual([])
  })

  it('applies active-profile, archive, type and completion filters to both count and page', () => {
    const { db, calls } = database(
      [
        {
          type: 'task',
          id: 't1',
          title: 'Planejar viagem',
          tags: 'viagem',
          content: 'Comprar passagens',
          project_id: 'p1',
          profile_id: null,
          table_id: null,
          project_archived: '0',
          memory_archived: '0',
          completed: '1',
          state: 'done',
          date: null
        }
      ],
      3
    )
    const response = queryGlobalSearch(
      db,
      {
        term: 'planejar',
        types: ['task'],
        projectId: 'p1',
        state: 'done',
        completed: true,
        limit: 1,
        offset: 0
      },
      'personal'
    )

    expect(response).toMatchObject({ total: 3, limit: 1, offset: 0, hasMore: true })
    expect(response.results[0]).toMatchObject({
      type: 'task',
      id: 't1',
      title: 'Planejar viagem',
      snippet: 'Planejar viagem',
      matchedField: 'title',
      completed: true
    })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.sql).toContain('global_search_fts MATCH ?')
      expect(call.sql).toContain('profile_id = ? OR (profile_id IS NULL AND type NOT IN')
      expect(call.sql).toContain('CAST(project_archived AS INTEGER) = 0')
      expect(call.sql).toContain('CAST(memory_archived AS INTEGER) = 0')
      expect(call.sql).toContain('type IN (?)')
      expect(call.params.slice(0, 6)).toEqual(['"planejar"*', 'personal', 'task', 'p1', 'done', 1])
    }
    expect(calls[1].sql).toContain('bm25(global_search_fts, 0.0, 0.0, 8.0, 4.0, 1.0)')
  })

  it('prefers a matching tag for the excerpt and bounds the returned text', () => {
    const { db } = database([
      {
        type: 'task',
        id: 't2',
        title: 'Outra tarefa',
        tags: 'urgente\nviagem',
        content: 'x'.repeat(1000),
        project_id: null,
        profile_id: null,
        table_id: null,
        project_archived: 0,
        memory_archived: 0,
        completed: 0,
        state: null,
        date: null
      }
    ])
    const hit = queryGlobalSearch(db, { term: 'viagem', limit: 200 }, 'personal')
    expect(hit.limit).toBe(100)
    expect(hit.results[0]).toMatchObject({ matchedField: 'tags', snippet: 'urgente viagem' })
    expect(hit.results[0].snippet.length).toBeLessThanOrEqual(180)
  })

  it('does not turn unknown type filters into an unrestricted search', () => {
    const { db, calls } = database([])
    expect(queryGlobalSearch(db, { term: 'teste', types: ['unknown'] }, 'personal').total).toBe(0)
    expect(calls).toEqual([])
  })

  it('does not allow IPC input to override the active financial profile', () => {
    const { db, calls } = database([], 0)
    queryGlobalSearch(
      db,
      { term: 'conta', profileId: 'another-profile', tableId: 'table-1' },
      'personal'
    )
    expect(calls[0].params).toEqual(['"conta"*', 'personal', 'table-1'])
  })

  it('does not return another profile’s transaction even if a backing query misbehaves', () => {
    const foreign = {
      type: 'transaction',
      id: 'tx-foreign',
      title: 'Pagamento',
      tags: '',
      content: '',
      project_id: null,
      profile_id: 'business',
      table_id: 'table-business',
      project_archived: 0,
      memory_archived: 0,
      completed: 0,
      state: 'expense',
      date: null
    }
    const active = { ...foreign, id: 'tx-personal', profile_id: 'personal' }
    const { db, calls } = database([foreign, active])
    const response = queryGlobalSearch(db, { term: 'pagamento' }, 'personal')
    expect(response.results.map((hit) => hit.id)).toEqual(['tx-personal'])
    expect(calls[0].sql).toContain('type NOT IN')
    expect(calls[1].sql).toContain('type NOT IN')
  })
})

const financialTypes = [
  'financial_profile',
  'financial_table',
  'shopping_item',
  'transaction',
  'transaction_detail',
  'financial_goal',
  'yield_source'
] as const

describe('direct global search lookup', () => {
  it.each(financialTypes)('hides %s IDs from another financial profile', (type) => {
    const row = {
      type,
      id: 'record-1',
      title: 'Privado',
      tags: '',
      content: '',
      project_id: null,
      profile_id: 'business',
      table_id: 'table-business',
      project_archived: 0,
      memory_archived: 0,
      completed: 0,
      state: null,
      date: null
    }
    const calls: { sql: string; params: unknown[] }[] = []
    const db = {
      prepare: (sql: string) => ({
        get: (...params: unknown[]) => {
          calls.push({ sql, params })
          return row
        }
      })
    } as unknown as Parameters<typeof getGlobalSearchHit>[0]

    expect(
      getGlobalSearchHit(db, { type, id: 'record-1', profileId: 'business' }, 'personal')
    ).toBeNull()
    expect(calls[0].sql).toContain('type = ? AND id = ?')
    expect(calls[0].sql).toContain('profile_id = ? OR (profile_id IS NULL AND type NOT IN')
    expect(calls[0].params).toEqual([type, 'record-1', 'personal'])
  })

  it('returns an active-profile record but rejects a financial row without a profile', () => {
    const row = {
      type: 'transaction',
      id: 'tx-1',
      title: 'Mercado',
      tags: '',
      content: '',
      project_id: null,
      profile_id: 'personal' as string | null,
      table_id: 'table-1',
      project_archived: 0,
      memory_archived: 0,
      completed: 0,
      state: 'expense',
      date: null
    }
    const db = {
      prepare: () => ({ get: () => row })
    } as unknown as Parameters<typeof getGlobalSearchHit>[0]
    expect(getGlobalSearchHit(db, { type: 'transaction', id: 'tx-1' }, 'personal')).toMatchObject({
      id: 'tx-1',
      profileId: 'personal',
      snippet: 'Mercado'
    })
    row.profile_id = null
    expect(getGlobalSearchHit(db, { type: 'transaction', id: 'tx-1' }, 'personal')).toBeNull()
  })
})
