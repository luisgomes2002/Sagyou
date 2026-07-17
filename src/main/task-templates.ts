// User-written prompt templates for "Gerar Tasks". No Electron here, so the
// rules are testable on their own; index.ts owns the file.
//
// The built-in template (AI_TASK_PROMPT_TEMPLATE in the renderer's types) is
// deliberately NOT stored here. It stays in code as the fallback, so a template
// list that is empty, deleted or corrupted still leaves Gerar Tasks working.

export interface PromptTemplate {
  id: string
  name: string
  /** The prompt itself. The project description is appended after it. */
  body: string
  createdAt: string
  updatedAt: string
}

/** Longest name kept — this only ever labels a dropdown entry. */
const MAX_NAME = 60

export interface SaveInput {
  /** Absent for a new template; the caller mints the id. */
  id?: string
  name: string
  body: string
}

export type SaveResult = { list: PromptTemplate[]; template: PromptTemplate } | { error: string }

/**
 * Add or update a template.
 *
 * Rejects rather than silently storing junk: a nameless entry is unpickable in
 * the dropdown, and an empty body would send the model nothing but the project
 * description and no instructions on what to produce.
 */
export function saveTemplate(
  list: PromptTemplate[],
  input: SaveInput,
  now: string,
  newId: () => string
): SaveResult {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME) : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!name) return { error: 'O template precisa de um nome' }
  if (!body) return { error: 'O template não pode estar vazio' }

  const clash = list.find(
    (t) => t.id !== input.id && t.name.trim().toLowerCase() === name.toLowerCase()
  )
  // Two templates with one name are indistinguishable in the picker.
  if (clash) return { error: `Já existe um template chamado "${clash.name}"` }

  const existing = input.id ? list.find((t) => t.id === input.id) : undefined
  if (input.id && !existing) return { error: 'Template não encontrado' }

  const template: PromptTemplate = existing
    ? { ...existing, name, body, updatedAt: now }
    : { id: newId(), name, body, createdAt: now, updatedAt: now }

  const next = existing
    ? list.map((t) => (t.id === template.id ? template : t))
    : [...list, template]
  return { list: next, template }
}

export function removeTemplate(list: PromptTemplate[], id: string): PromptTemplate[] {
  return list.filter((t) => t.id !== id)
}

/**
 * Drop anything that isn't a usable template.
 *
 * The file is user-editable and survives across versions, so a hand-broken
 * entry must not take the dropdown down with it.
 */
export function normalizeTemplates(raw: unknown): PromptTemplate[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (t): t is PromptTemplate =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as PromptTemplate).id === 'string' &&
      typeof (t as PromptTemplate).name === 'string' &&
      (t as PromptTemplate).name.trim() !== '' &&
      typeof (t as PromptTemplate).body === 'string' &&
      (t as PromptTemplate).body.trim() !== ''
  )
}
