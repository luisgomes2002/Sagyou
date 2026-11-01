import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, relative, resolve } from 'path'
import {
  addDetachedWorktree,
  ensureGitRepository,
  listWorktrees,
  removeWorktree,
  resolveWorktreeBase
} from './git-worktree'

export interface WorktreeReservations {
  reserveWorktree(path: string): void
  releaseWorktree(path: string): void
  protectedWorktrees(): Set<string>
}

export interface AgentWorktree {
  originalDir: string
  worktreeDir: string
}

const WORKTREE_ROOT = resolve(tmpdir(), 'sagyou-worktrees')

function managedWorktreePath(path: string): boolean {
  const rel = relative(WORKTREE_ROOT, resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Worktree lifecycle shared by every executor adapter. */
export class AgentWorktreeManager {
  private static readonly repoQueues = new Map<string, Promise<void>>()

  constructor(private readonly reservations: WorktreeReservations) {}

  private async withRepoLock<T>(repo: string, action: () => Promise<T>): Promise<T> {
    const previous = AgentWorktreeManager.repoQueues.get(repo) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => gate)
    AgentWorktreeManager.repoQueues.set(repo, queued)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (AgentWorktreeManager.repoQueues.get(repo) === queued)
        AgentWorktreeManager.repoQueues.delete(repo)
    }
  }

  async create(originalDir: string, runId: string): Promise<AgentWorktree> {
    const source = resolve(originalDir)
    const worktreeDir = resolve(WORKTREE_ROOT, `sagyou-wt-${runId}`)
    if (!managedWorktreePath(worktreeDir) || worktreeDir === source)
      throw new Error('Destino de worktree isolado inválido.')
    this.reservations.reserveWorktree(worktreeDir)
    try {
      await this.withRepoLock(source, async () => {
        await mkdir(WORKTREE_ROOT, { recursive: true })
        await ensureGitRepository(source)
        const base = await resolveWorktreeBase(source)
        await addDetachedWorktree(source, worktreeDir, base.revision)
      })
      return { originalDir: source, worktreeDir }
    } catch (error) {
      this.reservations.releaseWorktree(worktreeDir)
      throw error
    }
  }

  activate(worktreeDir: string): void {
    this.reservations.releaseWorktree(worktreeDir)
  }

  async remove(worktree: AgentWorktree): Promise<void> {
    if (!managedWorktreePath(worktree.worktreeDir))
      throw new Error('Recusada remoção fora da raiz de worktrees do Sagyou.')
    try {
      await this.withRepoLock(worktree.originalDir, () =>
        removeWorktree(worktree.originalDir, worktree.worktreeDir)
      )
    } finally {
      this.reservations.releaseWorktree(worktree.worktreeDir)
    }
  }

  async removeOrphans(originalDir: string): Promise<void> {
    const protectedPaths = this.reservations.protectedWorktrees()
    const worktrees = await this.withRepoLock(originalDir, () => listWorktrees(originalDir))
    for (const path of worktrees) {
      if (!managedWorktreePath(path)) continue
      if (!existsSync(path) || protectedPaths.has(resolve(path))) continue
      await this.withRepoLock(originalDir, () => removeWorktree(originalDir, path)).catch(() => {})
    }
  }
}
