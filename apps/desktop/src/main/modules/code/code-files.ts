import { resolve, sep } from 'path'

// Path confinement for the code agent's folders. No Electron in here, so it can be tested directly.
// The read-only `ai:code:*` source tools that used to live beside it were removed with the chat
// (nothing in the renderer called them); only the confinement is still used, by `main/index.ts`.

/**
 * Resolve `rel` under `root`, or null if it escapes.
 *
 * This is the only thing standing between a caller and the rest of the disk: every path an
 * agent run is handed goes through here.
 */
export function confineToRoot(root: string, rel: string): string | null {
  const base = resolve(root)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}
