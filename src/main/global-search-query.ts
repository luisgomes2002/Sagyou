import type Database from 'better-sqlite3'

export const GLOBAL_SEARCH_TYPES = [
  'project',
  'task',
  'note',
  'goal',
  'habit',
  'time_block',
  'routine',
  'file',
  'financial_profile',
  'financial_table',
  'shopping_item',
  'transaction',
  'transaction_detail',
  'financial_goal',
  'yield_source',
  'conversation',
  'memory'
] as const

export type GlobalSearchType = (typeof GLOBAL_SEARCH_TYPES)[number]

const FINANCIAL_TYPES = [
  'financial_profile',
  'financial_table',
  'shopping_item',
  'transaction',
  'transaction_detail',
  'financial_goal',
  'yield_source'
] as const
const financialTypeSet = new Set<string>(FINANCIAL_TYPES)
const activeProfileCondition =
  `(profile_id = ? OR (profile_id IS NULL AND type NOT IN (` +
  FINANCIAL_TYPES.map((type) => `'${type}'`).join(',') +
  ')))'

export interface GlobalSearchOptions {
  term: string
  types?: GlobalSearchType[]
  projectId?: string
  tableId?: string
  state?: string
  includeArchivedProjects?: boolean
  includeArchivedMemories?: boolean
  completed?: boolean
  limit?: number
  offset?: number
}

export interface GlobalSearchLookup {
  type: GlobalSearchType
  id: string
  includeArchivedProjects?: boolean
  includeArchivedMemories?: boolean
}

export interface GlobalSearchHit {
  type: GlobalSearchType
  id: string
  title: string
  snippet: string
  matchedField: 'title' | 'tags' | 'content'
  projectId: string | null
  profileId: string | null
  tableId: string | null
  projectArchived: boolean
  memoryArchived: boolean
  completed: boolean
  state: string | null
  date: string | null
}

export interface GlobalSearchResponse {
  results: GlobalSearchHit[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

interface SearchRow {
  type: GlobalSearchType
  id: string
  title: string
  tags: string
  content: string
  project_id: string | null
  profile_id: string | null
  table_id: string | null
  project_archived: string | number
  memory_archived: string | number
  completed: string | number
  state: string | null
  date: string | null
}

const allowedTypes = new Set<string>(GLOBAL_SEARCH_TYPES)
const MAX_LIMIT = 100

/** FTS syntax comes only from quoted Unicode tokens, never from raw IPC text. */
export function searchMatch(term: string): { tokens: string[]; match: string } {
  const tokens =
    term
      .slice(0, 200)
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? []
  return { tokens, match: tokens.map((token) => `"${token}"*`).join(' AND ') }
}

function normalized(text: string): string {
  return text
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function matchSnippet(
  row: SearchRow,
  tokens: string[]
): Pick<GlobalSearchHit, 'snippet' | 'matchedField'> {
  const fields = [
    ['title', row.title],
    ['tags', row.tags],
    ['content', row.content]
  ] as const
  for (const [matchedField, value] of fields) {
    const flat = (value ?? '').replace(/\s+/g, ' ').trim()
    const haystack = normalized(flat)
    const found = tokens.map((token) => haystack.indexOf(normalized(token))).find((at) => at >= 0)
    if (found === undefined) continue
    const start = Math.max(0, found - 55)
    const end = Math.min(flat.length, found + 125)
    return {
      matchedField,
      snippet: `${start ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
    }
  }
  // FTS tokenization may match Unicode text that JS normalization does not.
  return { matchedField: 'content', snippet: (row.content || row.title).slice(0, 180) }
}

function toHit(row: SearchRow, tokens: string[]): GlobalSearchHit {
  return {
    type: row.type,
    id: row.id,
    title: row.title,
    ...(tokens.length
      ? matchSnippet(row, tokens)
      : { matchedField: 'title' as const, snippet: row.title.slice(0, 180) }),
    projectId: row.project_id,
    profileId: row.profile_id,
    tableId: row.table_id,
    projectArchived: Number(row.project_archived) === 1,
    memoryArchived: Number(row.memory_archived) === 1,
    completed: Number(row.completed) === 1,
    state: row.state,
    date: row.date
  }
}

function visibleForProfile(row: SearchRow, activeFinancialProfileId: string): boolean {
  return !financialTypeSet.has(row.type) || row.profile_id === activeFinancialProfileId
}

/** Exact type + ID lookup uses the same profile and archive restrictions as search. */
export function getGlobalSearchHit(
  db: Database.Database,
  input: unknown,
  activeFinancialProfileId: string
): GlobalSearchHit | null {
  const options = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (
    typeof options.type !== 'string' ||
    !allowedTypes.has(options.type) ||
    typeof options.id !== 'string' ||
    !options.id ||
    options.id.length > 512
  )
    return null
  const where = [
    'type = ?',
    'id = ?',
    activeProfileCondition,
    options.includeArchivedProjects === true ? '1=1' : 'CAST(project_archived AS INTEGER) = 0',
    options.includeArchivedMemories === true ? '1=1' : 'CAST(memory_archived AS INTEGER) = 0'
  ]
  const row = db
    .prepare(
      `
    SELECT type, id, title, tags, content, project_id, profile_id, table_id,
           project_archived, memory_archived, completed, state, date
    FROM global_search_fts WHERE ${where.join(' AND ')} LIMIT 1
  `
    )
    .get(options.type, options.id, activeFinancialProfileId) as SearchRow | undefined
  return row && visibleForProfile(row, activeFinancialProfileId) ? toHit(row, []) : null
}

/** Read-only ranked search. Financial rows are always scoped to the active profile. */
export function queryGlobalSearch(
  db: Database.Database,
  input: unknown,
  activeFinancialProfileId: string
): GlobalSearchResponse {
  const options = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const term = typeof options.term === 'string' ? options.term.trim() : ''
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(options.limit)))
      : 25
  const offset =
    typeof options.offset === 'number' && Number.isFinite(options.offset)
      ? Math.max(0, Math.min(100_000, Math.floor(options.offset)))
      : 0
  const empty = (): GlobalSearchResponse => ({
    results: [],
    total: 0,
    limit,
    offset,
    hasMore: false
  })
  const { tokens, match } = searchMatch(term)
  if (!tokens.length) return empty()

  const where = [
    'global_search_fts MATCH ?',
    activeProfileCondition,
    options.includeArchivedProjects === true ? '1=1' : 'CAST(project_archived AS INTEGER) = 0',
    options.includeArchivedMemories === true ? '1=1' : 'CAST(memory_archived AS INTEGER) = 0'
  ]
  const params: unknown[] = [match, activeFinancialProfileId]
  if (Array.isArray(options.types)) {
    const types = [
      ...new Set(
        options.types.filter(
          (type): type is string => typeof type === 'string' && allowedTypes.has(type)
        )
      )
    ]
    if (types.length === 0) return empty()
    where.push(`type IN (${types.map(() => '?').join(',')})`)
    params.push(...types)
  }
  if (typeof options.projectId === 'string' && options.projectId) {
    where.push('project_id = ?')
    params.push(options.projectId)
  }
  if (typeof options.tableId === 'string' && options.tableId) {
    where.push('table_id = ?')
    params.push(options.tableId)
  }
  if (typeof options.state === 'string' && options.state) {
    where.push('state = ?')
    params.push(options.state)
  }
  if (typeof options.completed === 'boolean') {
    where.push('CAST(completed AS INTEGER) = ?')
    params.push(options.completed ? 1 : 0)
  }
  const condition = where.join(' AND ')
  const total = (
    db
      .prepare(`SELECT count(*) AS total FROM global_search_fts WHERE ${condition}`)
      .get(...params) as { total: number }
  ).total
  if (total === 0 || offset >= total) return { results: [], total, limit, offset, hasMore: false }

  // FTS5's lower bm25 score is better. Title and tags receive stronger weights.
  const rows = db
    .prepare(
      `
    SELECT type, id, title, tags, content, project_id, profile_id, table_id,
           project_archived, memory_archived, completed, state, date
    FROM global_search_fts WHERE ${condition}
    ORDER BY bm25(global_search_fts, 0.0, 0.0, 8.0, 4.0, 1.0), updated_at DESC, type, id
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, limit, offset) as SearchRow[]
  const results = rows
    .filter((row) => visibleForProfile(row, activeFinancialProfileId))
    .map((row) => toHit(row, tokens))
  return { results, total, limit, offset, hasMore: offset + results.length < total }
}
