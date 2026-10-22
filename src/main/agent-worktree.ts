import { existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  addDetachedWorktree,
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

/** Worktree lifecycle shared by every executor adapter. */
export class AgentWorktreeManager {
  constructor(private readonly reservations: WorktreeReservations) {}

  async create(originalDir: string, runId: string): Promise<AgentWorktree> {
    const worktreeDir = join(originalDir, `.sagyou-wt-${runId}`)
    this.reservations.reserveWorktree(worktreeDir)
    try {
      const base = await resolveWorktreeBase(originalDir)
      await addDetachedWorktree(originalDir, worktreeDir, base.revision)
      return { originalDir, worktreeDir }
    } catch (error) {
      this.reservations.releaseWorktree(worktreeDir)
      throw error
    }
  }

  activate(worktreeDir: string): void {
    this.reservations.releaseWorktree(worktreeDir)
  }

  async remove(worktree: AgentWorktree): Promise<void> {
    try {
      await removeWorktree(worktree.originalDir, worktree.worktreeDir)
    } finally {
      this.reservations.releaseWorktree(worktree.worktreeDir)
    }
  }

  async removeOrphans(originalDir: string): Promise<void> {
    const protectedPaths = this.reservations.protectedWorktrees()
    const worktrees = await listWorktrees(originalDir)
    for (const path of worktrees) {
      if (!path.includes('.sagyou-wt-')) continue
      if (!existsSync(path) || protectedPaths.has(resolve(path))) continue
      await removeWorktree(originalDir, path).catch(() => {})
    }
  }
}
