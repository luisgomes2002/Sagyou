import type { MemoryType } from './memory'

/** Which memories a search may reach, as the SQL layer wants it. */
export interface MemorySearchScope {
  projectId: string | null
  allProjects: boolean
}

/**
 * The scope of a search from the project the broker resolved. `undefined` is a
 * session with no project (a general session or the external token): it reads every
 * project. A project id reads that project and the globals. `null` is only the
 * globals, never "all".
 */
export function searchScopeFor(projectId: string | null | undefined): MemorySearchScope {
  return { projectId: projectId ?? null, allProjects: projectId === undefined }
}

export interface MemorySearchWhereOpts {
  projectId: string | null
  allProjects?: boolean
  type?: MemoryType
  includeArchived?: boolean
}

/**
 * The WHERE parts of `searchMemories` (table aliased `m`), kept pure so the rule
 * that keeps one project's memories out of another's search can be tested. A
 * project search is that project plus the globals; with no project, only the
 * globals; every project only when explicitly asked.
 */
export function memorySearchWhere(opts: MemorySearchWhereOpts): {
  where: string[]
  params: unknown[]
} {
  const where = [opts.includeArchived ? '1=1' : 'm.archived_at IS NULL']
  const params: unknown[] = []
  if (!opts.allProjects) {
    if (opts.projectId) {
      where.push('(m.project_id=? OR m.project_id IS NULL)')
      params.push(opts.projectId)
    } else where.push('m.project_id IS NULL')
  }
  if (opts.type) {
    where.push('m.type=?')
    params.push(opts.type)
  }
  return { where, params }
}
