import type { StoredFile } from '../types'

export interface StagedFile {
  token: string
  name: string
  size: number
}

export interface ImportItem {
  token: string
  name: string
}

const key = (name: string): string => name.toLowerCase()

/** Splits "relatorio (2).pdf" into base "relatorio" and ext ".pdf". */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ''
  return { base: stem.replace(/ \(\d+\)$/, ''), ext }
}

/** First free "name (n).ext" (n ≥ 2) not in `taken`, compared ignoring case. */
export function uniqueCopyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(key))
  const { base, ext } = splitName(name)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!used.has(key(candidate))) return candidate
  }
}

/**
 * Staged files whose name is free in the scope (and not repeated earlier in the
 * same selection) import directly; the rest need the user's decision.
 */
export function planImport(
  staged: StagedFile[],
  existingNames: string[]
): { direct: ImportItem[]; duplicates: ImportItem[] } {
  const taken = new Set(existingNames.map(key))
  const direct: ImportItem[] = []
  const duplicates: ImportItem[] = []
  for (const { token, name } of staged) {
    if (taken.has(key(name))) duplicates.push({ token, name })
    else {
      taken.add(key(name))
      direct.push({ token, name })
    }
  }
  return { direct, duplicates }
}

/** Ids of files saved more than once: same name (any case) and same size. */
export function repeatedFileIds(files: StoredFile[]): Set<string> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const group = `${key(file.name)}\u0000${file.size}`
    groups.set(group, [...(groups.get(group) ?? []), file.id])
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat())
}
