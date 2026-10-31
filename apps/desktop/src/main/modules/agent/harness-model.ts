import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { HarnessId } from './harness-adapter'

/**
 * Reads the model a terminal harness is actually using from the session
 * transcript the CLI itself writes. No CLI exposes a stable query for this, but
 * both Claude Code and Codex record the model on every turn. Only the model id
 * is extracted; transcript bodies never leave this module.
 */

const TAIL_BYTES = 256 * 1024
const HEAD_BYTES = 64 * 1024

function readSlice(path: string, fromEnd: boolean, bytes: number): string {
  const size = statSync(path).size
  const length = Math.min(size, bytes)
  const buffer = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, length, fromEnd ? size - length : 0)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

/** Last real `"model":"…"` in the text; Claude Code writes `<synthetic>` for local messages. */
function lastModel(text: string): string | null {
  let found: string | null = null
  for (const match of text.matchAll(/"model"\s*:\s*"([^"<>]{1,80})"/g)) found = match[1]
  return found
}

function newestJsonl(dir: string, since: number): string | null {
  if (!existsSync(dir)) return null
  let best: { path: string; mtime: number } | null = null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const path = join(dir, entry.name)
    const mtime = statSync(path).mtimeMs
    if (mtime >= since && (!best || mtime > best.mtime)) best = { path, mtime }
  }
  return best?.path ?? null
}

function claudeCodeModel(cwd: string, since: number, home: string): string | null {
  // Claude Code keys a project's transcripts by its cwd with every
  // non-alphanumeric character replaced by '-'.
  const slug = resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  const file = newestJsonl(join(home, '.claude', 'projects', slug), since)
  return file ? lastModel(readSlice(file, true, TAIL_BYTES)) : null
}

function codexModel(cwd: string, since: number, home: string): string | null {
  // Codex groups rollouts by local start date; a run started near midnight may
  // sit in the previous day's folder.
  const target = resolve(cwd).toLowerCase()
  const days = [new Date(since - 24 * 60 * 60 * 1000), new Date(since), new Date()]
  const seen = new Set<string>()
  let best: { path: string; mtime: number } | null = null
  for (const day of days) {
    const dir = join(
      home,
      '.codex',
      'sessions',
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0')
    )
    if (seen.has(dir) || !existsSync(dir)) continue
    seen.add(dir)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const path = join(dir, entry.name)
      const mtime = statSync(path).mtimeMs
      if (mtime < since || (best && mtime <= best.mtime)) continue
      const head = readSlice(path, false, HEAD_BYTES)
      const cwdMatch = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (!cwdMatch) continue
      let fileCwd: string
      try {
        fileCwd = JSON.parse(`"${cwdMatch[1]}"`)
      } catch {
        continue
      }
      if (resolve(fileCwd).toLowerCase() === target) best = { path, mtime }
    }
  }
  if (!best) return null
  return lastModel(readSlice(best.path, true, TAIL_BYTES)) ?? lastModel(readSlice(best.path, false, HEAD_BYTES))
}

/** The model id in use by a harness session started in `cwd`, or null when it cannot be read. */
export function detectHarnessModel(
  harness: HarnessId,
  cwd: string,
  startedAt: number,
  home: string = homedir()
): string | null {
  // A small margin: the CLI may stamp its file just before our clock reads startedAt.
  const since = startedAt - 5_000
  try {
    if (harness === 'claude-code') return claudeCodeModel(cwd, since, home)
    if (harness === 'codex') return codexModel(cwd, since, home)
  } catch {
    // Transcript formats are the CLI's, not ours; failing to read one is "unknown".
  }
  return null
}
