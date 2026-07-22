// Path-safety guards for restoring attachment/image blobs from a backup file.
//
// A v5 backup carries the physical bytes of file attachments and chat images.
// On import we write each blob to `userData/files/<id><ext>` (attachments) or
// `userData/chat-images/<id>` (images), and the id/ext come straight out of a
// backup a user could have hand-edited — so they are paths in disguise. An id
// of "../../ai-config.json" must resolve to nothing. Pure and tested here so
// the traversal cases are pinned (index.ts does the actual file IO); the same
// reasoning as chat-images.ts's isImageFileName, which guards chat-image ids.

// A file attachment's id is a bare uuid; its ext is the original filename's
// extname — ".pdf", ".docx", or "" for an extension-less file. Never a path.
const UUID = /^[0-9a-f-]{36}$/i
const SAFE_EXT = /^(\.[A-Za-z0-9]{1,12})?$/

/**
 * The safe on-disk basename for an attachment blob (`<id><ext>`), or null if
 * the id/ext look unsafe (not a uuid, an ext with a separator or `..`, etc.).
 * The caller must still confirm the joined path stays inside the target dir.
 */
export function safeAttachmentName(id: unknown, ext: unknown): string | null {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const e = ext == null ? '' : ext
  if (typeof e !== 'string' || !SAFE_EXT.test(e)) return null
  return `${id}${e}`
}
