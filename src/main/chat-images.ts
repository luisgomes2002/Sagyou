import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Images pasted into the chat. No Electron here, so the parsing rules are
// testable on their own; index.ts owns the directory.
//
// They live as files under userData/chat-images rather than inline in
// ai-conversations.json: that file is re-read and rewritten whole on every
// autosave and on every keystroke of the history search, so a few screenshots
// inlined as base64 would drag both down for the rest of the app's life.

/** Formats worth sending to a vision model. */
const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif']
])

/**
 * Ceiling on a stored image, after the renderer has already downscaled it.
 * A backstop against a hand-crafted IPC call, not the normal path.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export interface DecodedImage {
  bytes: Buffer
  ext: string
  mime: string
}

/**
 * Pull the bytes out of a `data:image/png;base64,...` URL.
 *
 * The dataUrl reaches here from the renderer, so it is checked rather than
 * trusted: only real image types, and only base64 — a `data:text/html` would
 * otherwise be written to disk under an image's name.
 */
export function decodeDataUrl(dataUrl: unknown): DecodedImage | { error: string } {
  if (typeof dataUrl !== 'string' || dataUrl === '') return { error: 'Imagem vazia' }
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/is.exec(dataUrl.trim())
  if (!m) return { error: 'Formato de imagem inválido' }
  const mime = m[1].toLowerCase()
  const ext = ALLOWED.get(mime)
  if (!ext) return { error: `Tipo de imagem não suportado: ${mime}` }

  let bytes: Buffer
  try {
    bytes = Buffer.from(m[2], 'base64')
  } catch {
    return { error: 'Imagem corrompida' }
  }
  if (bytes.length === 0) return { error: 'Imagem vazia' }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { error: `Imagem grande demais (máx. ${MAX_IMAGE_BYTES / 1024 / 1024}MB)` }
  }
  return { bytes, ext, mime }
}

/** The mime for a stored file, from its extension. */
export function mimeForExt(ext: string): string {
  for (const [mime, e] of ALLOWED) if (e === ext) return mime
  return 'application/octet-stream'
}

/**
 * Whether `name` is one of ours: `<uuid>.<ext>` and nothing else.
 *
 * The id comes back from the renderer to read or delete a file, so it is a
 * path in disguise — "../../ai-config.json" must not resolve to anything.
 */
export function isImageFileName(name: unknown): name is string {
  return typeof name === 'string' && /^[0-9a-f-]{36}\.[a-z]{3,4}$/i.test(name)
}

// --- Shared helpers for chat + task image handlers ---

/**
 * Decode a data URL and write the bytes to disk inside `dir`. The caller
 * provides a `makeId` function that receives the decoded image and returns the
 * object to send back to the renderer (the "id" field is always the filename).
 *
 * Used by both `ai:images:save` and `task:images:save`, which differ only in
 * their naming convention and return shape.
 */
export function saveImageToDir(
  dir: string,
  dataUrl: string,
  makeId: (decoded: DecodedImage) => { id: string; [k: string]: unknown }
): { error: string } | { id: string; [k: string]: unknown } {
  const decoded = decodeDataUrl(dataUrl)
  if ('error' in decoded) return decoded
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const meta = makeId(decoded)
    writeFileSync(join(dir, meta.id), decoded.bytes)
    return meta
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao salvar a imagem' }
  }
}

/**
 * Read a file back as a base64 data URL.
 *
 * `fullPath` must already be validated (the caller's path-resolver handles
 * the security check). `ext` is the bare extension (no dot).
 */
export function readImageAsDataUrl(
  fullPath: string | null,
  ext: string
): { error: string } | { dataUrl: string } {
  if (!fullPath || !existsSync(fullPath)) return { error: 'Imagem não encontrada' }
  try {
    const b64 = readFileSync(fullPath).toString('base64')
    return { dataUrl: `data:${mimeForExt(ext)};base64,${b64}` }
  } catch {
    return { error: 'Falha ao ler a imagem' }
  }
}

/**
 * Delete files from disk whose resolved paths are non-null and exist.
 * Best-effort: a missing or locked file is silently skipped.
 */
export function deleteImageFiles(paths: Iterable<string | null>): void {
  for (const full of paths) {
    if (full && existsSync(full)) {
      try {
        unlinkSync(full)
      } catch {
        /* already gone or locked — not worth failing over */
      }
    }
  }
}
