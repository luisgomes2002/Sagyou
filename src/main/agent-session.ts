import { resolve } from 'path'

export interface AgentSession {
  id: string
  worktreeDir: string | null
}

/**
 * Owns process-independent run bookkeeping. Executors may come and go without
 * moving session lifetime or worktree reservations back into their adapters.
 */
export class AgentSessionRegistry<T extends AgentSession> {
  readonly runs = new Map<string, T>()
  readonly reservedWorktrees = new Set<string>()

  register(session: T): void {
    this.runs.set(session.id, session)
    if (session.worktreeDir) this.releaseWorktree(session.worktreeDir)
  }

  remove(runId: string): T | undefined {
    const session = this.runs.get(runId)
    this.runs.delete(runId)
    return session
  }

  reserveWorktree(path: string): void {
    this.reservedWorktrees.add(resolve(path))
  }

  releaseWorktree(path: string): void {
    this.reservedWorktrees.delete(resolve(path))
  }

  protectedWorktrees(): Set<string> {
    return new Set([
      ...[...this.runs.values()]
        .map((run) => run.worktreeDir)
        .filter((path): path is string => path !== null)
        .map((path) => resolve(path)),
      ...this.reservedWorktrees
    ])
  }
}
