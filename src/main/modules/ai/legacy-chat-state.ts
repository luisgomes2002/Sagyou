import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

const FILE = 'legacy-chat-state.json'

/**
 * Where the chat-removal migration remembers what it did (marker, snapshot
 * folder, dismissed notice).
 *
 * It must NOT live in the SQLite `settings` table: persistAll() empties that
 * table on the first save of every session, which would erase the marker and
 * make the migration run again on every launch. A file of its own is outside
 * the store's reach and outside every backup.
 */
export function createLegacyChatState(userDataDir: string): {
  read: (key: string) => unknown
  write: (key: string, value: unknown) => void
} {
  const path = join(userDataDir, FILE)

  const load = (): Record<string, unknown> => {
    if (!existsSync(path)) return {}
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  return {
    read: (key) => load()[key] ?? null,
    write: (key, value) => {
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify({ ...load(), [key]: value }, null, 2), 'utf-8')
      renameSync(tmp, path)
    }
  }
}
