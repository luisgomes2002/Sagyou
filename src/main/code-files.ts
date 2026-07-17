import { readdir } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, resolve, relative, sep } from 'path'

// Read-only source access for the AI's code tools. No Electron in here, so the
// path confinement and the walk can be tested directly.
//
// Everything is async on purpose. These run in Electron's MAIN process, whose
// event loop also serves IPC and the window controls: measured on a large tree,
// the sync version blocked it for ~73ms to walk to the cap and ~640ms more to
// read the files for a search. Async fs hands the syscalls to libuv's pool and
// yields between entries, so the main thread stays responsive.
//
// A worker_thread would also work but buys nothing here — this is IO-bound, and
// the syscalls already leave the main thread with async fs. A worker would add a
// second bundle entry, message passing and a lifecycle to get the same result.

/** Directories never worth walking into for source search. */
export const CODE_IGNORE = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.git',
  '.vite',
  '.next',
  '.turbo'
])

/**
 * Resolve `rel` under `root`, or null if it escapes.
 *
 * This is the only thing standing between the assistant and the rest of the
 * disk: every path the code tools touch goes through here.
 */
export function confineToRoot(root: string, rel: string): string | null {
  const base = resolve(root)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

export interface WalkResult {
  files: string[]
  /** True when the cap cut the listing short — there is more down there. */
  truncated: boolean
}

/**
 * Every file under `root/sub`, relative to `root`, up to `cap`.
 *
 * Awaits each readdir, so the event loop is free between directories.
 */
export async function walkFiles(root: string, sub: string, cap: number): Promise<WalkResult> {
  const files: string[] = []
  const start = confineToRoot(root, sub)
  let truncated = false
  if (!start) return { files, truncated }

  const base = resolve(root)
  const stack = [start]
  while (stack.length && files.length < cap) {
    const dir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable or gone between listing and walking — skip it, don't fail
      // the whole listing over one directory.
      continue
    }
    for (const e of entries) {
      if (files.length >= cap) {
        truncated = true
        break
      }
      if (e.isDirectory()) {
        if (CODE_IGNORE.has(e.name) || e.name.startsWith('.')) continue
        stack.push(join(dir, e.name))
      } else if (e.isFile()) {
        files.push(relative(base, join(dir, e.name)).replace(/\\/g, '/'))
      }
    }
  }
  // Anything left on the stack is unvisited work the cap cut off.
  if (stack.length) truncated = true
  return { files: files.sort(), truncated }
}
