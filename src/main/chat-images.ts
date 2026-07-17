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
