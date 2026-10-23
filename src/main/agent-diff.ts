import { execFile } from 'child_process'
import { lstat } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import type { DiffLineItem } from './code-diff'

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  })
  return stdout
}

export interface AgentPatch {
  patch: string
  changedPaths: string[]
  fileCount: number
}

export interface PatchScopeResult {
  allowed: boolean
  rejectedPaths: string[]
}

function normalizeScopePath(path: string, caseInsensitive: boolean): string | null {
  const slashPath = path.replace(/\\/g, '/')
  if (!slashPath || slashPath.startsWith('/') || /^[a-z]:/i.test(slashPath)) return null
  const segments = slashPath.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  const normalized = segments.join('/')
  return caseInsensitive ? normalized.toLocaleLowerCase('en-US') : normalized
}

/** Pure path comparison; callers can use a Windows-like mode in tests on any OS. */
export function checkPatchScope(
  changedPaths: string[],
  allowed?: string[],
  options: { caseInsensitive?: boolean } = {}
): PatchScopeResult {
  const caseInsensitive = options.caseInsensitive ?? process.platform === 'win32'
  const scopes = (allowed ?? [])
    .map((path) => ({
      root: /[\\/]$/.test(path),
      path: normalizeScopePath(path.replace(/[\\/]+$/, ''), caseInsensitive)
    }))
    .filter((scope): scope is { root: boolean; path: string } => scope.path !== null)
  const restricted = (allowed?.length ?? 0) > 0
  const rejectedPaths = changedPaths.filter((changedPath) => {
    const path = normalizeScopePath(changedPath, caseInsensitive)
    if (!path) return true
    if (!restricted) return false
    return !scopes.some(
      (scope) => scope.path === path || (scope.root && path.startsWith(scope.path + '/'))
    )
  })
  return { allowed: rejectedPaths.length === 0, rejectedPaths: [...new Set(rejectedPaths)] }
}

async function hasSymlinkAncestor(worktreeDir: string, relativePath: string): Promise<boolean> {
  const normalized = normalizeScopePath(relativePath, process.platform === 'win32')
  if (!normalized) return false
  const segments = normalized.split('/')
  let current = worktreeDir
  for (const segment of segments) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) return true
    } catch {
      // A deleted path has no filesystem ancestor to inspect; Git's path still
      // goes through the pure traversal/scope validation above.
      return false
    }
  }
  return false
}

/** Reject a whole patch when an allowed-looking path crosses a symlink. */
export async function validatePatchScope(
  worktreeDir: string,
  changedPaths: string[],
  allowed?: string[]
): Promise<PatchScopeResult> {
  const result = checkPatchScope(changedPaths, allowed)
  const symlinkPaths = await Promise.all(
    changedPaths.map(async (path) => ((await hasSymlinkAncestor(worktreeDir, path)) ? path : null))
  )
  const rejectedPaths = [
    ...new Set([
      ...result.rejectedPaths,
      ...symlinkPaths.filter((path): path is string => path !== null)
    ])
  ]
  return { allowed: rejectedPaths.length === 0, rejectedPaths }
}

/** Captures tracked and untracked worktree changes without leaving the index dirty. */
export async function collectAgentPatch(
  worktreeDir: string,
  options: { includeUntracked?: boolean; base?: string } = {}
): Promise<AgentPatch> {
  // A run's base may differ from HEAD when the executor created commits. Review
  // must still show every change made since the worktree was handed to it.
  const base = options.base ?? 'HEAD'
  // `--binary` is essential here: the final delivery uses `git apply`, which
  // cannot reconstruct Git's ordinary "Binary files differ" summary.
  const trackedPatch = await git(worktreeDir, ['diff', '--binary', base])
  // NUL delimiters preserve unusual but valid filenames. Include both sides of
  // a rename/copy: allowing only its destination must not authorize removing
  // a sibling outside the agreed scope.
  const statusParts = (await git(worktreeDir, ['diff', '--name-status', '-z', '-M', '-C', base]))
    .split('\0')
    .filter(Boolean)
  const trackedPaths: string[] = []
  for (let index = 0; index < statusParts.length; index++) {
    const status = statusParts[index]
    if (/^[RC]/.test(status)) {
      const from = statusParts[++index]
      const to = statusParts[++index]
      if (from) trackedPaths.push(from)
      if (to) trackedPaths.push(to)
    } else {
      const path = statusParts[++index]
      if (path) trackedPaths.push(path)
    }
  }
  const untrackedPaths =
    options.includeUntracked === false
      ? []
      : (await git(worktreeDir, ['status', '--porcelain', '--untracked-files=all']))
          .split('\n')
          .filter((line) => line.startsWith('?? '))
          .map((line) => line.slice(3).trim())
          .filter(Boolean)

  let untrackedPatch = ''
  for (const path of untrackedPaths) {
    await git(worktreeDir, ['add', '-N', '--', path])
    try {
      untrackedPatch += await git(worktreeDir, ['diff', '--binary', base, '--', path])
    } finally {
      await git(worktreeDir, ['reset', 'HEAD', '--', path])
    }
  }
  const patch = trackedPatch + untrackedPatch
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])]
  return {
    patch,
    changedPaths,
    fileCount: patch.split('\n').filter((line) => line.startsWith('diff --git')).length
  }
}

/** Compact visual preview used by the unchanged final-approval contract. */
export function agentPatchPreview(
  patch: string,
  limit = 400
): { lines: DiffLineItem[]; truncated: boolean } {
  const all = patch.split('\n')
  return {
    lines: all.slice(0, limit).map((line) => ({
      kind:
        line.startsWith('+') && !line.startsWith('+++')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'del'
            : 'ctx',
      text: line
    })),
    truncated: all.length > limit
  }
}

export function patchWithinScope(changedPaths: string[], allowed?: string[]): boolean {
  return checkPatchScope(changedPaths, allowed).allowed
}
