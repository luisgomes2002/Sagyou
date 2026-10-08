// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildConversationDocuments,
  buildMemoryDocuments,
  buildSearchDocuments,
  rebuildGlobalSearchIndex,
  syncGlobalSearchIndex,
  type SearchSource
} from '../global-search-index'

const source: SearchSource = {
  projects: [
    {
      id: 'p',
      name: 'Projeto antigo',
      description: 'Pesquisa',
      archivedAt: '2026-01-01',
      columns: [{ id: 'done', name: 'Done' }],
      links: [],
      updatedAt: '2026-01-01'
    }
  ],
  tasks: [
    {
      id: 't',
      projectId: 'p',
      columnId: 'done',
      title: 'Relatório',
      description: 'Entrega final',
      tags: ['trabalho'],
      priority: 'high',
      completedAt: '2026-01-02',
      updatedAt: '2026-01-02'
    }
  ],
  notes: [{ id: 'n', projectId: 'p', content: 'Lembrete', updatedAt: '2026-01-02' }],
  goals: [
    {
      id: 'g',
      title: 'Estudar',
      unit: 'horas',
      entries: [{ label: 'Semana um' }],
      updatedAt: '2026-01-02'
    }
  ],
  habits: [{ id: 'h', name: 'Ler', updatedAt: '2026-01-02' }],
  timeBlocks: [
    {
      id: 'b',
      title: 'Revisão',
      taskId: 't',
      date: '2026-01-03',
      type: 'task',
      updatedAt: '2026-01-03'
    }
  ],
  routines: [{ id: 'r', title: 'Caminhar', active: false, updatedAt: '2026-01-03' }],
  files: [
    {
      id: 'f',
      name: 'contrato.pdf',
      ext: '.pdf',
      createdAt: '2026-01-03',
      content: 'Cláusula de confidencialidade do contrato'
    }
  ],
  financialProfiles: [{ id: 'personal', name: 'Minhas finanças', updatedAt: '2026-01-01' }],
  lists: [
    {
      id: 'l',
      name: 'Conta',
      profileId: 'personal',
      currency: 'BRL',
      updatedAt: '2026-01-03',
      items: [{ id: 'i', name: 'Livro', done: false }],
      transactions: [
        {
          id: 'x',
          description: 'Livraria',
          category: 'Educação',
          type: 'expense',
          date: '2026-01-03',
          details: [{ id: 'd', description: 'Caderno', category: 'Material' }]
        }
      ],
      goals: [{ id: 'fg', name: 'Reserva', targetMonth: 12, targetYear: 2026 }],
      yieldSources: [{ id: 'ys', name: 'Aplicação' }]
    }
  ]
}

describe('global search documents', () => {
  it('indexes each record with stable identity and the filters inherited from its owner', () => {
    const docs = buildSearchDocuments(source)
    expect(new Set(docs.map((d) => `${d.type}:${d.id}`)).size).toBe(docs.length)
    expect(docs.find((d) => d.id === 't')).toMatchObject({
      type: 'task',
      projectId: 'p',
      projectArchived: 1,
      completed: 1,
      state: 'done'
    })
    expect(docs.find((d) => d.id === 'b')).toMatchObject({ type: 'time_block', projectArchived: 1 })
    expect(docs.find((d) => d.id === 'd')).toMatchObject({
      type: 'transaction_detail',
      profileId: 'personal',
      tableId: 'l',
      title: 'Caderno'
    })
    expect(docs.find((d) => d.id === 'r')).toMatchObject({ completed: 1 })
    expect(docs.find((d) => d.id === 'f')).toMatchObject({
      type: 'file',
      content: 'Cláusula de confidencialidade do contrato'
    })
  })

  it('does not index monetary values or propagate a parent name to every child', () => {
    const docs = buildSearchDocuments(source)
    expect(docs.find((d) => d.id === 'x')?.content).toBe('Educação')
    expect(docs.find((d) => d.id === 'i')?.content).toBe('')
    expect(docs.find((d) => d.id === 't')?.content).not.toContain('Projeto antigo')
    expect(docs.find((d) => d.id === 't')?.tags).toBe('trabalho')
  })

  it('excludes status messages and records memory archive states separately', () => {
    const [conversation] = buildConversationDocuments([
      {
        id: 'c',
        title: 'Chat',
        updatedAt: '2026-01-01',
        messages: [
          { role: 'status', content: 'Lendo segredo' },
          { role: 'user', content: 'Planejar' }
        ]
      }
    ])
    expect(conversation.content).toBe('Planejar')
    const [memory] = buildMemoryDocuments(
      [
        {
          id: 'm',
          projectId: 'p',
          title: 'Decisão',
          body: 'Manter',
          tags: ['busca'],
          type: 'decisao',
          archivedAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      new Set(['p'])
    )
    expect(memory).toMatchObject({ projectArchived: 1, memoryArchived: 1, archived: 1 })
  })
})

function searchDatabase(): {
  db: Parameters<typeof syncGlobalSearchIndex>[0]
  hits: (term: string) => { type: string; id: string; title: string }[]
} {
  const rows: Record<string, unknown>[] = []
  let nextRowId = 1
  const db = {
    prepare: (sql: string) => ({
      all: () =>
        rows
          .filter((row) =>
            sql.includes("type NOT IN ('conversation', 'memory')")
              ? row.type !== 'conversation' && row.type !== 'memory'
              : true
          )
          .map((row) => ({ ...row })),
      run: (value?: unknown) => {
        if (sql.startsWith('DELETE FROM global_search_fts WHERE rowid=')) {
          const at = rows.findIndex((row) => row.rowid === value)
          if (at >= 0) rows.splice(at, 1)
        } else if (sql === 'DELETE FROM global_search_fts') {
          rows.length = 0
        } else if (sql.startsWith('INSERT INTO global_search_fts')) {
          const doc = value as ReturnType<typeof buildSearchDocuments>[number]
          rows.push({
            rowid: nextRowId++,
            type: doc.type,
            id: doc.id,
            title: doc.title,
            tags: doc.tags,
            content: doc.content,
            project_id: doc.projectId,
            profile_id: doc.profileId,
            table_id: doc.tableId,
            archived: doc.archived,
            project_archived: doc.projectArchived,
            memory_archived: doc.memoryArchived,
            completed: doc.completed,
            state: doc.state,
            date: doc.date,
            updated_at: doc.updatedAt
          })
        }
      }
    }),
    transaction: (fn: () => void) => fn
  } as unknown as Parameters<typeof syncGlobalSearchIndex>[0]
  return {
    db,
    hits: (term) =>
      rows
        .filter((row) =>
          `${row.title} ${row.tags} ${row.content}`.toLowerCase().includes(term.toLowerCase())
        )
        .map((row) => ({ type: String(row.type), id: String(row.id), title: String(row.title) }))
  }
}

describe('global search synchronization', () => {
  it('replaces edited text and removes deleted records without mutating the source', () => {
    const data = structuredClone(source)
    const { db, hits } = searchDatabase()
    syncGlobalSearchIndex(db, data)
    expect(hits('Relatório')).toEqual([{ type: 'task', id: 't', title: 'Relatório' }])

    data.tasks[0].title = 'Entrega revisada'
    const beforeSync = structuredClone(data)
    syncGlobalSearchIndex(db, data)
    expect(data).toEqual(beforeSync)
    expect(hits('Relatório')).toEqual([])
    expect(hits('Entrega revisada')).toEqual([{ type: 'task', id: 't', title: 'Entrega revisada' }])

    data.tasks = []
    syncGlobalSearchIndex(db, data)
    expect(hits('Entrega revisada')).toEqual([])

    data.files = []
    syncGlobalSearchIndex(db, data)
    expect(hits('confidencialidade')).toEqual([])
  })

  it('rebuilds from restored records and discards results from the previous backup state', () => {
    const { db, hits } = searchDatabase()
    syncGlobalSearchIndex(db, source)
    const restored: SearchSource = { ...structuredClone(source), tasks: [] }
    rebuildGlobalSearchIndex(db, restored)
    expect(hits('Relatório')).toEqual([])
    expect(hits('Projeto antigo')).toEqual([{ type: 'project', id: 'p', title: 'Projeto antigo' }])
  })
})
