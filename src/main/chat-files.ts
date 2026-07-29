import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocumentBuffer } from './document-parser'

/**
 * Documents attached to the chat. Same pattern as chat-images.ts: files on
 * disk under userData/chat-files/, never inlined in ai-conversations.json.
 *
 * The renderer sends the raw bytes; main saves the file and parses it at once.
 * The parsed text goes back to the renderer and is included in the user
 * message inline — no tool call needed. The stored file is the source of truth;
 * a missing file degrades to "[documento indisponível]" with the name intact.
 */

/** Metadata returned after saving a document to the chat. */
export interface ChatDocumentMeta {
  id: string
  /** Original filename (e.g. "relatorio.pdf"). */
  name: string
  /** Extension with dot (e.g. ".pdf"). */
  ext: string
  /** Size in bytes. */
  size: number
  /** Parsed text, ready to send to the model. */
  text: string
  /** True when the parsed text was truncated. */
  truncated: boolean
}

/**
 * Whether `name` is one of ours: `<uuid><ext>` and nothing else.
 *
 * The id comes back from the renderer to read or delete a file, so it is a
 * path in disguise — "../../ai-config.json" must not resolve to anything.
 */
export function isChatFileName(name: unknown): name is string {
  return typeof name === 'string' && /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(name)
}

/**
 * Validate a raw buffer, parse it, and write both the file and the result to
 * disk. The caller provides the directory, the original name, the extension,
 * and the bytes; this function generates the id.
 */
export async function saveAndParseChatFile(
  dir: string,
  name: string,
  ext: string,
  data: Uint8Array,
  makeId: () => string
): Promise<ChatDocumentMeta | { error: string }> {
  const buffer = Buffer.from(data)
  const parsed = await parseDocumentBuffer(buffer, ext)
  if ('error' in parsed) return parsed

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const id = makeId()
    writeFileSync(join(dir, id), buffer)
    return { id, name, ext, size: buffer.length, text: parsed.text, truncated: parsed.truncated }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao salvar o documento' }
  }
}

/**
 * Delete files from disk whose resolved paths are non-null and exist.
 * Best-effort: a missing or locked file is silently skipped.
 */
export function deleteChatFiles(paths: Iterable<string | null>): void {
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
