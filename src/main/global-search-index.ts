import type Database from 'better-sqlite3'

export interface SearchDocument {
  type: string
  id: string
  title: string
  tags: string
  content: string
  projectId: string | null
  profileId: string | null
  tableId: string | null
  archived: number
  projectArchived: number
  memoryArchived: number
  completed: number
  state: string | null
  date: string | null
  updatedAt: string | null
}

export interface SearchConversation {
  id: string
  title: string
  updatedAt: string
  messages: { role: string; content: string }[]
}

export interface SearchMemory {
  id: string
  projectId: string | null
  title: string
  body: string
  tags: string[]
  type: string
  archivedAt: string | null
  updatedAt: string
}

type Named = { id: string; name: string }
export interface SearchSource {
  projects: {
    id: string
    name: string
    description?: string
    archivedAt?: string
    columns: Named[]
    links?: { label: string; url: string }[]
    codePaths?: { label?: string; path: string }[]
    updatedAt: string
  }[]
  tasks: {
    id: string
    projectId: string
    columnId: string
    title: string
    description?: string
    tags: string[]
    priority: string
    dueDate?: string
    completedAt?: string
    updatedAt: string
  }[]
  notes: {
    id: string
    projectId: string
    content: string
    completedAt?: string
    updatedAt: string
  }[]
  goals: {
    id: string
    projectId?: string
    title: string
    unit: string
    entries: { label?: string }[]
    updatedAt: string
  }[]
  habits: { id: string; name: string; updatedAt: string }[]
  timeBlocks?: {
    id: string
    title: string
    description?: string
    taskId?: string
    date: string
    type: string
    updatedAt: string
  }[]
  routines?: {
    id: string
    title: string
    description?: string
    active: boolean
    updatedAt: string
  }[]
  files: { id: string; name: string; ext: string; projectId?: string; createdAt: string }[]
  financialProfiles?: { id: string; name: string; updatedAt: string }[]
  lists: {
    id: string
    name: string
    provider?: string
    profileId?: string
    currency: string
    updatedAt: string
    items: { id: string; name: string; link?: string; done: boolean }[]
    transactions: {
      id: string
      description: string
      category?: string
      source?: string
      bankReference?: string
      counterparty?: string
      type: string
      date: string
      updatedAt?: string
      details?: { id: string; description: string; category?: string }[]
    }[]
    goals: {
      id: string
      name: string
      completionNote?: string
      completedAt?: string
      targetMonth: number
      targetYear: number
    }[]
    yieldSources?: { id: string; name: string }[]
  }[]
}

const text = (...parts: (string | null | undefined)[]): string => parts.filter(Boolean).join('\n')

/** Only values that are actually searchable go in title/content. Metadata stays unindexed. */
export function buildSearchDocuments(data: SearchSource): SearchDocument[] {
  const docs: SearchDocument[] = []
  const archivedProjects = new Set(data.projects.filter((p) => p.archivedAt).map((p) => p.id))
  const taskProjects = new Map(data.tasks.map((t) => [t.id, t.projectId]))
  const add = (
    type: string,
    id: string,
    title: string,
    content = '',
    meta: Partial<SearchDocument> = {},
    tags = ''
  ): void => {
    docs.push({
      type,
      id,
      title,
      tags,
      content,
      projectId: null,
      profileId: null,
      tableId: null,
      archived: 0,
      projectArchived: 0,
      memoryArchived: 0,
      completed: 0,
      state: null,
      date: null,
      updatedAt: null,
      ...meta
    })
  }
  const project = (projectId?: string): Partial<SearchDocument> => ({
    projectId: projectId ?? null,
    archived: projectId && archivedProjects.has(projectId) ? 1 : 0,
    projectArchived: projectId && archivedProjects.has(projectId) ? 1 : 0
  })

  for (const p of data.projects)
    add(
      'project',
      p.id,
      p.name,
      text(
        p.description,
        ...p.columns.map((c) => c.name),
        ...(p.links ?? []).flatMap((l) => [l.label, l.url]),
        ...(p.codePaths ?? []).flatMap((c) => [c.label, c.path])
      ),
      { ...project(p.id), updatedAt: p.updatedAt }
    )
  for (const t of data.tasks)
    add(
      'task',
      t.id,
      t.title,
      t.description ?? '',
      {
        ...project(t.projectId),
        completed: t.completedAt ? 1 : 0,
        state: t.columnId,
        date: t.dueDate ?? null,
        updatedAt: t.updatedAt
      },
      t.tags.join('\n')
    )
  for (const n of data.notes)
    add('note', n.id, n.content.slice(0, 120), n.content, {
      ...project(n.projectId),
      completed: n.completedAt ? 1 : 0,
      updatedAt: n.updatedAt
    })
  for (const g of data.goals)
    add('goal', g.id, g.title, text(g.unit, ...g.entries.map((e) => e.label)), {
      ...project(g.projectId),
      updatedAt: g.updatedAt
    })
  for (const h of data.habits) add('habit', h.id, h.name, '', { updatedAt: h.updatedAt })
  for (const b of data.timeBlocks ?? [])
    add('time_block', b.id, b.title, b.description ?? '', {
      ...project(b.taskId ? taskProjects.get(b.taskId) : undefined),
      state: b.type,
      date: b.date,
      updatedAt: b.updatedAt
    })
  for (const r of data.routines ?? [])
    add('routine', r.id, r.title, r.description ?? '', {
      completed: r.active ? 0 : 1,
      updatedAt: r.updatedAt
    })
  for (const f of data.files)
    add('file', f.id, f.name, '', { ...project(f.projectId), state: f.ext, updatedAt: f.createdAt })
  for (const p of data.financialProfiles ?? [])
    add('financial_profile', p.id, p.name, '', { profileId: p.id, updatedAt: p.updatedAt })
  for (const l of data.lists) {
    const meta = { profileId: l.profileId ?? 'personal', tableId: l.id }
    add('financial_table', l.id, l.name, l.provider ?? '', {
      ...meta,
      state: l.currency,
      updatedAt: l.updatedAt
    })
    for (const i of l.items)
      add('shopping_item', i.id, i.name, i.link ?? '', { ...meta, completed: i.done ? 1 : 0 })
    for (const t of l.transactions) {
      const body = text(t.category, t.source, t.bankReference, t.counterparty)
      add('transaction', t.id, t.description, body, {
        ...meta,
        state: t.type,
        date: t.date,
        updatedAt: t.updatedAt ?? null
      })
      for (const d of t.details ?? [])
        add('transaction_detail', d.id, d.description, d.category ?? '', {
          ...meta,
          state: t.type,
          date: t.date,
          updatedAt: t.updatedAt ?? null
        })
    }
    for (const g of l.goals)
      add('financial_goal', g.id, g.name, g.completionNote ?? '', {
        ...meta,
        completed: g.completedAt ? 1 : 0,
        date: `${g.targetYear}-${String(g.targetMonth).padStart(2, '0')}`
      })
    for (const s of l.yieldSources ?? []) add('yield_source', s.id, s.name, '', meta)
  }
  return docs
}

export function buildConversationDocuments(list: SearchConversation[]): SearchDocument[] {
  return list.map((c) => ({
    type: 'conversation',
    id: c.id,
    title: c.title,
    tags: '',
    content: c.messages
      .filter(
        (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
      .map((m) => m.content)
      .join('\n'),
    projectId: null,
    profileId: null,
    tableId: null,
    archived: 0,
    projectArchived: 0,
    memoryArchived: 0,
    completed: 0,
    state: null,
    date: null,
    updatedAt: c.updatedAt
  }))
}

export function buildMemoryDocuments(
  list: SearchMemory[],
  archivedProjects: Set<string>
): SearchDocument[] {
  return list.map((m) => ({
    type: 'memory',
    id: m.id,
    title: m.title,
    tags: m.tags.join('\n'),
    content: m.body,
    projectId: m.projectId,
    profileId: null,
    tableId: null,
    archived: m.archivedAt || (m.projectId && archivedProjects.has(m.projectId)) ? 1 : 0,
    projectArchived: m.projectId && archivedProjects.has(m.projectId) ? 1 : 0,
    memoryArchived: m.archivedAt ? 1 : 0,
    completed: 0,
    state: m.type,
    date: null,
    updatedAt: m.updatedAt
  }))
}

const columns =
  'type,id,title,tags,content,project_id,profile_id,table_id,archived,project_archived,memory_archived,completed,state,date,updated_at'
const values =
  '@type,@id,@title,@tags,@content,@projectId,@profileId,@tableId,@archived,@projectArchived,@memoryArchived,@completed,@state,@date,@updatedAt'

export function createGlobalSearchIndex(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(global_search_fts)').all() as { name: string }[]
  if (columns.length && !columns.some((column) => column.name === 'tags')) {
    // This table is derived; replacing an older layout never touches source records.
    db.exec('DROP TABLE global_search_fts')
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS global_search_fts USING fts5(
    type UNINDEXED, id UNINDEXED, title, tags, content,
    project_id UNINDEXED, profile_id UNINDEXED, table_id UNINDEXED,
    archived UNINDEXED, project_archived UNINDEXED, memory_archived UNINDEXED,
    completed UNINDEXED, state UNINDEXED,
    date UNINDEXED, updated_at UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
  )`)
}

/** Full repair path. This transaction writes only to the disposable FTS table. */
export function rebuildGlobalSearchIndex(
  db: Database.Database,
  source: SearchSource,
  extra: SearchDocument[] = []
): void {
  const insert = db.prepare(`INSERT INTO global_search_fts (${columns}) VALUES (${values})`)
  db.transaction(() => {
    db.prepare('DELETE FROM global_search_fts').run()
    for (const doc of [...buildSearchDocuments(source), ...extra]) insert.run(doc)
  })()
}

/** Keep the derived rows in the same transaction as the source save. */
export function syncGlobalSearchIndex(db: Database.Database, source: SearchSource): void {
  syncDocuments(db, buildSearchDocuments(source), "type NOT IN ('conversation', 'memory')")
}

/** Caller owns the transaction when this accompanies another persisted change. */
export function syncSupplementalSearchIndex(
  db: Database.Database,
  type: 'conversation' | 'memory',
  documents: SearchDocument[]
): void {
  syncDocuments(db, documents, 'type = ?', type)
}

function syncDocuments(
  db: Database.Database,
  next: SearchDocument[],
  where: string,
  ...params: string[]
): void {
  const old = db
    .prepare(`SELECT rowid, ${columns} FROM global_search_fts WHERE ${where}`)
    .all(...params) as (Record<string, unknown> & { rowid: number })[]
  const oldByKey = new Map(old.map((row) => [`${row.type}:${row.id}`, row]))
  const del = db.prepare('DELETE FROM global_search_fts WHERE rowid=?')
  const insert = db.prepare(`INSERT INTO global_search_fts (${columns}) VALUES (${values})`)
  for (const doc of next) {
    const key = `${doc.type}:${doc.id}`
    const previous = oldByKey.get(key)
    oldByKey.delete(key)
    if (
      previous &&
      previous.title === doc.title &&
      previous.tags === doc.tags &&
      previous.content === doc.content &&
      previous.project_id === doc.projectId &&
      previous.profile_id === doc.profileId &&
      previous.table_id === doc.tableId &&
      Number(previous.archived) === doc.archived &&
      Number(previous.project_archived) === doc.projectArchived &&
      Number(previous.memory_archived) === doc.memoryArchived &&
      Number(previous.completed) === doc.completed &&
      previous.state === doc.state &&
      previous.date === doc.date &&
      previous.updated_at === doc.updatedAt
    )
      continue
    if (previous) del.run(previous.rowid)
    insert.run(doc)
  }
  for (const row of oldByKey.values()) del.run(row.rowid)
}
