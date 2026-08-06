import { execFile } from 'child_process'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env
  })
  return stdout.trim()
}

export interface WorktreeBase {
  revision: string
  temporary: boolean
}

/**
 * Resolve a revision that `git worktree add` can detach from.
 *
 * A freshly initialized repository has no HEAD yet. In that case we snapshot
 * the working tree through a separate temporary index and create an unreachable
 * commit object. This leaves the user's branch, index and files untouched; the
 * object exists only long enough to anchor concurrent worktrees.
 */
export async function resolveWorktreeBase(dir: string): Promise<WorktreeBase> {
  try {
    return { revision: await git(dir, ['rev-parse', '--verify', 'HEAD']), temporary: false }
  } catch {
    // Unborn HEAD: create a detached snapshot without staging in the user's index.
  }

  const indexPath = join(tmpdir(), `sagyou-git-index-${randomUUID()}`)
  const env: NodeJS.ProcessEnv = {
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'Sagyou',
    GIT_AUTHOR_EMAIL: 'sagyou@local',
    GIT_COMMITTER_NAME: 'Sagyou',
    GIT_COMMITTER_EMAIL: 'sagyou@local'
  }
  try {
    await git(dir, [
      'add',
      '-A',
      '--',
      '.',
      ':(exclude).sagyou-wt-*',
      ':(exclude).sagyou-wt-patch-*.diff'
    ], env)
    const tree = await git(dir, ['write-tree'], env)
    const revision = await git(
      dir,
      ['commit-tree', tree, '-m', 'Sagyou temporary worktree base'],
      env
    )
    return { revision, temporary: true }
  } finally {
    await unlink(indexPath).catch(() => {})
    await unlink(`${indexPath}.lock`).catch(() => {})
  }
}

export async function addDetachedWorktree(
  dir: string,
  worktreeDir: string,
  revision: string
): Promise<void> {
  await git(dir, ['worktree', 'add', '--detach', worktreeDir, revision])
}
