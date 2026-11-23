/** What the user (or the app) decided about reading another project's memories. */
export type ProjectReadDecision = 'approved' | 'refused' | 'not-found'

export type ProjectReadCheck =
  { ok: true } | { ok: false; error: string; reason: 'refused' | 'not-found' }

export const PROJECT_READ_REFUSED =
  'Leitura de outro projeto não aprovada. Não insista: só leia outro projeto se o usuário pedir.'
export const PROJECT_NOT_FOUND = 'Projeto não encontrado.'
export const PROJECT_READ_HINT =
  'Lê, por padrão, o projeto da sessão e as globais; outro projeto exige a aprovação do usuário.'
/** The card's tool name (shown as `mcp:read_other_project_memory`). Not a tool the agent can call. */
export const PROJECT_READ_CARD = 'read_other_project_memory'

const NAME_LIMIT = 80

/** The approval card's text. The name is one clean line: no quotes, no line breaks, bounded. */
export function projectReadResumo(name: string): string {
  const clean = name.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, NAME_LIMIT)
  return `Ler memórias do projeto "${clean}"?`
}

/**
 * The other project a read targets, which needs an approval; null when it needs none:
 * no project asked, the session's own project, or a session with no project (a general
 * session or the external token reads every project).
 */
export function crossProjectTarget(
  sessionProjectId: string | null,
  requested: string | null | undefined
): string | null {
  if (sessionProjectId === null || !requested || requested === sessionProjectId) return null
  return requested
}

const REFUSED: ProjectReadCheck = {
  ok: false,
  error: PROJECT_READ_REFUSED,
  reason: 'refused'
}

/**
 * Which other projects each session may read. An approval holds for that session
 * (token) only and is dropped with it; a refusal is never remembered, so the user can
 * ask later. Two calls for the same project at once share one question. It fails
 * closed: a question that throws, or that is answered after the session was dropped,
 * is a refusal.
 */
export class ProjectReadGrants {
  private readonly granted = new Map<string, Set<string>>()
  private readonly pending = new Map<string, Promise<ProjectReadCheck>>()
  private readonly generation = new Map<string, number>()

  constructor(
    private readonly ask: (token: string, projectId: string) => Promise<ProjectReadDecision>
  ) {}

  check(token: string, projectId: string): Promise<ProjectReadCheck> {
    if (this.granted.get(token)?.has(projectId)) return Promise.resolve({ ok: true })
    const key = `${token}\u0000${projectId}`
    const waiting = this.pending.get(key)
    if (waiting) return waiting
    const generation = this.generation.get(token) ?? 0
    const run = (async (): Promise<ProjectReadCheck> => {
      let decision: ProjectReadDecision
      try {
        decision = await this.ask(token, projectId)
      } catch {
        decision = 'refused'
      }
      if ((this.generation.get(token) ?? 0) !== generation) return REFUSED
      if (decision === 'approved') {
        const projects = this.granted.get(token) ?? new Set<string>()
        projects.add(projectId)
        this.granted.set(token, projects)
        return { ok: true }
      }
      if (decision === 'not-found')
        return { ok: false, error: PROJECT_NOT_FOUND, reason: 'not-found' }
      return REFUSED
    })()
    this.pending.set(key, run)
    void run.finally(() => {
      if (this.pending.get(key) === run) this.pending.delete(key)
    })
    return run
  }

  /** The session is gone: forget what it was allowed and ignore any question still open. */
  drop(token: string): void {
    this.granted.delete(token)
    for (const key of [...this.pending.keys()])
      if (key.startsWith(`${token}\u0000`)) this.pending.delete(key)
    this.generation.set(token, (this.generation.get(token) ?? 0) + 1)
  }
}
