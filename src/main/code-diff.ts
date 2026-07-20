// What the code agent changed, as a diff the user can read without leaving the
// app. No Electron here, so the rules are testable on their own; index.ts wires
// this to the ai:code-agent:* channels.
//
// The whole problem is separating *the agent's* work from the work the user
// already had in progress. Running `git diff` after the fact cannot: it shows
// both, and the user's own half-finished edits would be presented as something
// an AI did to their code. So a base is captured the moment the agent starts,
// and everything is measured against that.

import { execFile } from 'child_process'

/** Longest diff handed to the renderer. A big refactor can run to megabytes. */
export const MAX_DIFF_CHARS = 200_000

/** New files whose contents are shown before the rest are merely listed. */
export const MAX_NEW_FILES = 40

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs git in `dir`. Injectable so tests can watch what was asked of it. */
export type GitRunner = (dir: string, args: string[]) => Promise<GitResult>

/**
 * The real one. **Never a shell**: `dir` is a path the user picked and the args
 * carry SHAs and file paths, so a shell would turn a filename with a `;` in it
 * into someone else's command.
 */
export const realGit: GitRunner = (dir, args) =>
  new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, ...args],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    )
  })

/**
 * What the tree looked like when the agent started.
 *
 * `base` is a commit-ish that includes the user's uncommitted work, so the diff
 * taken later shows the agent's changes *only* — the user's own edits sit in it
 * as context, which is what they are.
 */
export interface AgentBase {
  dir: string
  /** A commit-ish to diff against later. */
  base: string
  /** Untracked paths that were already there — not the agent's doing. */
  untrackedBefore: string[]
}

/** Untracked paths (`?? path` lines), which `git diff` never shows. */
async function untracked(dir: string, git: GitRunner): Promise<string[]> {
  const res = await git(dir, ['status', '--porcelain', '--untracked-files=all'])
  if (res.code !== 0) return []
  return res.stdout
    .split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
}

/**
 * Snapshot the tree before the agent runs. Null when `dir` isn't a git repo —
 * a legitimate state, not an error: the diff is simply unavailable there.
 *
 * `git stash create` is the key. It writes a commit object for the current
 * working tree and **touches nothing else** — not the working tree, not the
 * index, not the stash list — so it is safe to run against a repo the user has
 * work sitting in. On a clean tree it prints nothing, and HEAD is already an
 * accurate description of the tree.
 */
export async function captureBase(dir: string, git: GitRunner = realGit): Promise<AgentBase | null> {
  const isRepo = await git(dir, ['rev-parse', '--git-dir'])
  if (isRepo.code !== 0) return null

  const stashed = await git(dir, ['stash', 'create'])
  const base = stashed.code === 0 && stashed.stdout.trim() ? stashed.stdout.trim() : null
  if (base) return { dir, base, untrackedBefore: await untracked(dir, git) }

  const head = await git(dir, ['rev-parse', 'HEAD'])
  // No HEAD either: a repo with no commits yet. Nothing to diff against.
  if (head.code !== 0 || !head.stdout.trim()) return null
  return { dir, base: head.stdout.trim(), untrackedBefore: await untracked(dir, git) }
}

export interface DiffFile {
  path: string
  added: number
  removed: number
}

export interface DiffResult {
  /** Unified diff, git's own output. Empty when the agent changed nothing. */
  patch: string
  files: DiffFile[]
  truncated: boolean
  /** New files the agent left untracked, beyond MAX_NEW_FILES shown in `patch`. */
  omittedNewFiles: string[]
  error?: string
}

/** `git diff --numstat` → per-file counts. Binary files report '-'. */
function parseNumstat(out: string): DiffFile[] {
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 3)
    .map(([a, r, path]) => ({
      path,
      // '-' means binary; 0/0 reads better than NaN and says "no lines".
      added: a === '-' ? 0 : Number(a) || 0,
      removed: r === '-' ? 0 : Number(r) || 0
    }))
}

/**
 * Everything that changed since `base`.
 *
 * `codex exec` leaves the tree dirty, and a diff from a base commit to the
 * working tree spans commits and uncommitted edits alike.
 *
 * Untracked files are the exception — `git diff` cannot see them, so they are
 * fetched one at a time with `--no-index`, which synthesises a proper "new
 * file" patch **without touching the index** (`git add -N` would do it in one
 * call, and would leave the user's index modified behind their back).
 */
export async function diffSince(
  snapshot: AgentBase,
  git: GitRunner = realGit
): Promise<DiffResult> {
  const { dir, base } = snapshot
  const empty = { patch: '', files: [], truncated: false, omittedNewFiles: [] }

  const stat = await git(dir, ['diff', '--numstat', base])
  if (stat.code !== 0) {
    return { ...empty, error: stat.stderr.trim().split('\n')[0] || 'Falha ao ler o diff' }
  }
  const patch = await git(dir, ['diff', base])
  if (patch.code !== 0) {
    return { ...empty, error: patch.stderr.trim().split('\n')[0] || 'Falha ao ler o diff' }
  }

  const files = parseNumstat(stat.stdout)
  let text = patch.stdout

  // New files the agent left untracked: invisible above, and the most
  // interesting thing it did.
  const before = new Set(snapshot.untrackedBefore)
  const added = (await untracked(dir, git)).filter((p) => !before.has(p))
  const shown = added.slice(0, MAX_NEW_FILES)
  for (const path of shown) {
    // --no-index compares two paths on disk, so it works on a file git knows
    // nothing about. It exits 1 when they differ, which is the normal case here.
    const one = await git(dir, ['diff', '--no-index', '--', '/dev/null', path])
    if (one.stdout) {
      text += one.stdout
      const n = one.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
      files.push({ path, added: n, removed: 0 })
    }
  }

  const truncated = text.length > MAX_DIFF_CHARS
  return {
    patch: truncated ? text.slice(0, MAX_DIFF_CHARS) : text,
    files,
    truncated,
    omittedNewFiles: added.slice(MAX_NEW_FILES)
  }
}
