import { execFile } from 'child_process'
import { realpath, unlink } from 'fs/promises'
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

/**
 * Every harness run needs a detached worktree, including a code folder the
 * user created outside Git. Initialising Git creates only local metadata; the
 * temporary snapshot below still leaves the user's index, branch and files
 * untouched and does not create a visible commit.
 */
export async function ensureGitRepository(dir: string): Promise<void> {
  try {
    await git(dir, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    await git(dir, ['init', '--quiet'])
  }
}

/**
 * The private workspace lives in userData, which can sit inside someone else's
 * repository (a portable install, a test profile). `ensureGitRepository` would
 * accept the parent there, and orphan cleanup would then remove the parent's
 * worktrees. The workspace must own its `.git`, so no command climbs above it.
 * Project code roots keep the parent lookup: a subfolder of a repo is legitimate.
 * A `.git` that exists is not enough: an interrupted init can leave it empty, and
 * Git then climbs to the parent again, so the top level itself is checked.
 */
export async function ensurePrivateWorkspaceRepository(dir: string): Promise<void> {
  const own = await realpath(dir)
  const topLevel = await git(dir, ['rev-parse', '--show-toplevel'])
    .then((path) => realpath(path))
    .catch(() => null)
  if (topLevel && sameDirectory(topLevel, own)) return
  await git(dir, ['init', '--quiet'])
}

function sameDirectory(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
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
    await git(
      dir,
      ['add', '-A', '--', '.', ':(exclude).sagyou-wt-*', ':(exclude).sagyou-wt-patch-*.diff'],
      env
    )
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

export async function removeWorktree(dir: string, worktreeDir: string): Promise<void> {
  await git(dir, ['worktree', 'remove', '--force', worktreeDir])
}

export async function listWorktrees(dir: string): Promise<string[]> {
  const output = await git(dir, ['worktree', 'list', '--porcelain'])
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean)
}
