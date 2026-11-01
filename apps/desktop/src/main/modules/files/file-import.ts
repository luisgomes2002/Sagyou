import { basename, extname, isAbsolute, join } from 'path'
import { copyFileSync, statSync } from 'fs'
import { randomUUID } from 'crypto'

/** Most files one pick or drop may stage; the rest is reported as overLimit. */
export const FILE_IMPORT_LIMIT = 200
const TOKEN_TTL_MS = 10 * 60 * 1000
const MAX_NAME_LENGTH = 255

export interface StagedFile {
  token: string
  name: string
  size: number
}

export interface StageResult {
  staged: StagedFile[]
  /** Folders, broken links, relative or missing paths. */
  skipped: number
  overLimit: number
}

export interface ImportedFile {
  id: string
  name: string
  ext: string
  size: number
  createdAt: string
}

interface Pending {
  path: string
  name: string
  size: number
  expiresAt: number
}

interface Deps {
  filesDir: string
  index: (id: string, destination: string, ext: string) => Promise<void>
  onImported?: (storedName: string) => void
  now?: () => number
}

const validName = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.trim().length > 0 &&
  name.length <= MAX_NAME_LENGTH &&
  !/[/\\]/.test(name)

/**
 * Two-step import. `stage` keeps the disk paths here in main and hands the
 * renderer opaque, single-use tokens; the renderer decides which to keep (and
 * under which display name) after checking for duplicates, so it never sends a
 * path to be copied. The stored file is always `<uuid><original ext>`.
 */
export function createFileImportRegistry(deps: Deps): {
  stage: (paths: unknown) => StageResult
  importStaged: (items: unknown) => Promise<ImportedFile[]>
  discard: (tokens: unknown) => void
} {
  const now = deps.now ?? Date.now
  const pending = new Map<string, Pending>()

  const dropExpired = (): void => {
    const time = now()
    for (const [token, item] of pending) if (item.expiresAt <= time) pending.delete(token)
  }

  const stage = (paths: unknown): StageResult => {
    dropExpired()
    const result: StageResult = { staged: [], skipped: 0, overLimit: 0 }
    if (!Array.isArray(paths)) return result
    result.overLimit = Math.max(0, paths.length - FILE_IMPORT_LIMIT)
    for (const path of paths.slice(0, FILE_IMPORT_LIMIT)) {
      try {
        if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('invalid path')
        const stats = statSync(path)
        if (!stats.isFile()) throw new Error('not a file')
        const token = randomUUID()
        const name = basename(path)
        pending.set(token, { path, name, size: stats.size, expiresAt: now() + TOKEN_TTL_MS })
        result.staged.push({ token, name, size: stats.size })
      } catch {
        result.skipped++
      }
    }
    return result
  }

  const importStaged = async (items: unknown): Promise<ImportedFile[]> => {
    dropExpired()
    const imported: ImportedFile[] = []
    if (!Array.isArray(items)) return imported
    for (const item of items) {
      const token = (item as { token?: unknown } | null)?.token
      if (typeof token !== 'string') continue
      const staged = pending.get(token)
      if (!staged) continue
      pending.delete(token)
      try {
        const id = randomUUID()
        const ext = extname(staged.path)
        const destination = join(deps.filesDir, `${id}${ext}`)
        copyFileSync(staged.path, destination)
        await deps.index(id, destination, ext)
        deps.onImported?.(`${id}${ext}`)
        const chosen = (item as { name?: unknown }).name
        imported.push({
          id,
          name: validName(chosen) ? chosen : staged.name,
          ext,
          size: staged.size,
          createdAt: new Date(now()).toISOString()
        })
      } catch {
        /* skip files that can't be copied */
      }
    }
    return imported
  }

  const discard = (tokens: unknown): void => {
    if (!Array.isArray(tokens)) return
    for (const token of tokens) if (typeof token === 'string') pending.delete(token)
  }

  return { stage, importStaged, discard }
}
