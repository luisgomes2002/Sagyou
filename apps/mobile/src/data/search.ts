import { searchMatch } from '@sagyou/core/search'
import { DEFAULT_FINANCIAL_PROFILE_ID } from '@sagyou/core/types'
import type { SqlDb } from './sql'
import type { MobileState } from './state'

export type SearchKind = 'project' | 'task' | 'note' | 'habit' | 'transaction'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** Where to open it: the task/note's project, or the transaction's table. */
  parentId: string | null
}

interface IndexRow {
  kind: SearchKind
  id: string
  parent: string | null
  profile: string
  archived: '0' | '1'
  title: string
  body: string
}

function rows(state: MobileState): IndexRow[] {
  const archived = new Set(state.projects.filter((p) => p.archivedAt).map((p) => p.id))
  const flag = (projectId: string): '0' | '1' => (archived.has(projectId) ? '1' : '0')
  const out: IndexRow[] = []
  for (const p of state.projects)
    out.push({
      kind: 'project',
      id: p.id,
      parent: null,
      profile: '',
      archived: flag(p.id),
      title: p.name,
      body: p.description ?? ''
    })
  for (const t of state.tasks)
    out.push({
      kind: 'task',
      id: t.id,
      parent: t.projectId,
      profile: '',
      archived: flag(t.projectId),
      title: t.title,
      body: [t.description ?? '', ...(t.tags ?? [])].join(' ')
    })
  for (const n of state.notes)
    if (n.type !== 'text')
      out.push({
        kind: 'note',
        id: n.id,
        parent: n.projectId,
        profile: '',
        archived: flag(n.projectId),
        title: n.content.split('\n')[0] ?? '',
        body: n.content
      })
  for (const h of state.habits)
    out.push({
      kind: 'habit',
      id: h.id,
      parent: null,
      profile: '',
      archived: '0',
      title: h.name,
      body: ''
    })
  for (const table of state.lists)
    for (const tx of table.transactions)
      out.push({
        kind: 'transaction',
        id: tx.id,
        parent: table.id,
        profile: table.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID,
        archived: '0',
        title: tx.description,
        body: [tx.category ?? '', tx.counterparty ?? ''].join(' ')
      })
  return out
}

/**
 * The index is derived and disposable, like the desktop's: rebuilt from the
 * state after every write. Rebuilding (rather than patching) keeps the
 * cascades right: a table moved to another profile, or a project archived,
 * changes the rows of everything under it.
 */
export function rebuildSearchIndex(db: SqlDb, state: MobileState): void {
  db.tx(() => {
    db.run('DELETE FROM search_fts')
    for (const r of rows(state))
      db.run(
        'INSERT INTO search_fts (kind, id, profile_id, archived, title, body, parent) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.kind, r.id, r.profile, r.archived, r.title, r.body, r.parent]
      )
  })
}

// Title weighs 10x the body; transactions only from the given profile.
const SEARCH_SQL = `
  SELECT kind, id, title, parent FROM search_fts
  WHERE search_fts MATCH ? AND archived = '0'
    AND (kind <> 'transaction' OR profile_id = ?)
  ORDER BY bm25(search_fts, 0, 0, 0, 0, 10, 1, 0)
  LIMIT ?`

/** Ranked hits; transactions only from the phone's active financial profile. */
export function searchRecords(db: SqlDb, text: string, profileId: string, limit = 50): SearchHit[] {
  const { match } = searchMatch(text)
  if (!match) return []
  return db
    .all<{
      kind: SearchKind
      id: string
      title: string
      parent: string | null
    }>(SEARCH_SQL, [match, profileId, limit])
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title, parentId: r.parent }))
}
