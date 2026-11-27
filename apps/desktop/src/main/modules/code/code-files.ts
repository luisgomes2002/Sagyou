import { resolve, sep } from 'path'

// Path confinement for an agent run's scope. No Electron in here, so it can be tested directly.
// The read-only `ai:code:*` source tools that used to live beside it were removed with the chat
// (nothing in the renderer called them). `main/index.ts` still uses the confinement for the
// files the caller pinned and the extra write paths of a run; `readOnlyRoots` is NOT confined.

/**
 * Resolve `rel` under `root`, or null if it escapes.
 *
 * This is the only thing standing between a caller and the rest of the disk for the paths
 * above: a new path handed to a run must go through here too.
 */
export function confineToRoot(root: string, rel: string): string | null {
  const base = resolve(root)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}
