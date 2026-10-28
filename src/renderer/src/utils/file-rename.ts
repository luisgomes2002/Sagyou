import type { StoredFile } from '../types'

const STEM_LIMIT = 200
// "Baixar cópia" saves under this name, so it must be a valid Windows file name.
const FORBIDDEN = /[\\/:*?"<>|]/
const hasControlChar = (value: string): boolean =>
  [...value].some((char) => char.charCodeAt(0) < 0x20)

/** The name without the stored extension; the extension is never edited. */
export function fileStem(file: StoredFile): string {
  return file.ext && file.name.toLowerCase().endsWith(file.ext.toLowerCase())
    ? file.name.slice(0, file.name.length - file.ext.length)
    : file.name
}

/**
 * Validates a new name for `file`. `siblings` are the files of the same scope
 * (its project, or Geral); a name taken there is refused, ignoring case, the
 * same rule the import applies before creating a duplicate.
 */
export function validateFileRename(
  file: StoredFile,
  rawStem: string,
  siblings: StoredFile[]
): { ok: true; name: string; unchanged: boolean } | { ok: false; error: string } {
  const stem = rawStem.trim()
  if (!stem) return { ok: false, error: 'Digite um nome.' }
  if (stem.length > STEM_LIMIT)
    return { ok: false, error: `O nome pode ter até ${STEM_LIMIT} caracteres.` }
  if (FORBIDDEN.test(stem) || hasControlChar(stem))
    return { ok: false, error: 'O nome não pode ter \\ / : * ? " < > |.' }
  if (/[. ]$/.test(stem))
    return { ok: false, error: 'O nome não pode terminar com ponto ou espaço.' }
  const name = stem + file.ext
  const taken = siblings.some(
    (other) => other.id !== file.id && other.name.toLowerCase() === name.toLowerCase()
  )
  if (taken) return { ok: false, error: 'Já existe um arquivo com esse nome aqui.' }
  return { ok: true, name, unchanged: name === file.name }
}
