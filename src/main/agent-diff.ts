import { execFile } from 'child_process'
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

/** Captures tracked and untracked worktree changes without leaving the index dirty. */
export async function collectAgentPatch(
  worktreeDir: string,
  options: { includeUntracked?: boolean } = {}
): Promise<AgentPatch> {
  const trackedPatch = await git(worktreeDir, ['diff', 'HEAD'])
  const trackedPaths = (await git(worktreeDir, ['diff', '--name-only', 'HEAD']))
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)
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
      untrackedPatch += await git(worktreeDir, ['diff', 'HEAD', '--', path])
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
  return !allowed?.length || changedPaths.every((path) => allowed.includes(path))
}
