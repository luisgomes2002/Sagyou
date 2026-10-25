import { v4 as uuidv4 } from 'uuid'
import { useKanbanStore } from '../store/kanban'
import { PROJECT_COLORS, type Column, type Project, type ProjectLink } from '../types'
import { isDoneColumn } from '../utils/columns'
import type { McpActionResult, McpScope } from '../types/mcp-actions'

/**
 * MCP writes from code agents, validated against the live store.
 *
 * Every tool runs twice: `prepare` validates and returns the approval-card
 * summary without writing, then `apply` runs the very same checks again and
 * writes. Main validated nothing against the renderer's state, and the user
 * may have changed it while the card was up, so `apply` must not trust
 * `prepare`.
 */

type Phase = 'prepare' | 'apply'
type Args = Record<string, unknown>
type Store = ReturnType<typeof useKanbanStore.getState>
type Handler = (args: Args, scope: McpScope, phase: Phase, store: Store) => McpActionResult

/** Thrown by validators; becomes an `ok: false` reply. */
class McpRefusal extends Error {
  constructor(
    message: string,
    readonly candidatos?: { id: string; title: string }[]
  ) {
    super(message)
  }
}

const refuse = (message: string, candidatos?: { id: string; title: string }[]): never => {
  throw new McpRefusal(message, candidatos)
}

const LIMITS = {
  projectName: 120,
  columnName: 60,
  description: 5000,
  linkLabel: 80,
  linkUrl: 2000,
  links: 20
} as const

const DONE_RENAME_REFUSAL =
  'A coluna de concluídas é identificada pelo nome "Done"; renomeie-a no Sagyou.'

// ── Argument readers ─────────────────────────────────────────────────────────

/** Trimmed string or undefined when absent; refuses a non-string or an oversized value. */
function optionalText(args: Args, key: string, max: number): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') refuse(`${key} precisa ser texto.`)
  const trimmed = (value as string).trim()
  if (trimmed.length > max) refuse(`${key} excede ${max} caracteres.`)
  return trimmed
}

function requiredText(args: Args, key: string, max: number): string {
  const value = optionalText(args, key, max)
  if (!value) refuse(`${key} é obrigatório.`)
  return value as string
}

function optionalProjectColor(args: Args): string | undefined {
  const color = optionalText(args, 'color', 20)
  if (color === undefined || color === '') return undefined
  if (!(PROJECT_COLORS as readonly string[]).includes(color))
    refuse(`color precisa ser uma de: ${PROJECT_COLORS.join(', ')}.`)
  return color
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

// ── Resolution ───────────────────────────────────────────────────────────────

function resolveProject(args: Args, scope: McpScope, store: Store, key = 'projectId'): Project {
  const requested = optionalText(args, key, 200)
  const id = requested || scope.projectId
  if (!id) refuse('Escolha um projeto em list_projects.')
  const project = store.projects.find((item) => item.id === id)
  if (!project) refuse('Projeto não encontrado.')
  return project as Project
}

function resolveColumn(project: Project, ref: string): Column {
  const byId = project.columns.find((column) => column.id === ref)
  if (byId) return byId
  const byName = project.columns.filter((column) => sameName(column.name, ref))
  if (byName.length > 1)
    refuse(
      'Mais de um registro com esse título; use o id.',
      byName.slice(0, 10).map((column) => ({ id: column.id, title: column.name }))
    )
  if (!byName.length) refuse(`Coluna "${ref}" não encontrada no projeto ${project.name}.`)
  return byName[0]
}

function columnTaskCount(store: Store, project: Project, column: Column): number {
  return store.tasks.filter((task) => task.projectId === project.id && task.columnId === column.id)
    .length
}

/** Column names are how the app recognises Done, so the MCP never creates or removes one. */
function guardColumnName(project: Project, name: string, current?: Column): void {
  if (current && isDoneColumn(current) && !sameName(current.name, name)) refuse(DONE_RENAME_REFUSAL)
  if (!current?.name || !sameName(current.name, name)) {
    if (sameName(name, 'done')) refuse(DONE_RENAME_REFUSAL)
    if (project.columns.some((column) => column.id !== current?.id && sameName(column.name, name)))
      refuse(`Já existe uma coluna "${name}" no projeto ${project.name}.`)
  }
}

function parseLinks(raw: unknown, existing: ProjectLink[]): ProjectLink[] {
  if (!Array.isArray(raw)) refuse('links precisa ser uma lista.')
  const list = raw as unknown[]
  if (list.length > LIMITS.links) refuse(`links aceita no máximo ${LIMITS.links} itens.`)
  return list.map((item) => {
    if (!item || typeof item !== 'object') refuse('Cada link precisa ter url.')
    const link = item as Args
    const url = requiredText(link, 'url', LIMITS.linkUrl)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return refuse(`URL inválida: ${url}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      refuse('Links aceitam só http e https.')
    // Read off the parsed fields: '@' is legal in a path or query.
    if (parsed.username || parsed.password) refuse('Links não podem conter usuário ou senha.')
    const label = optionalText(link, 'label', LIMITS.linkLabel) || parsed.hostname
    const kept = existing.find((current) => current.url === url)
    return { id: kept?.id ?? uuidv4(), label, url }
  })
}

const done = (id: string, resumo: string, extra: Args = {}): McpActionResult => ({
  ok: true,
  id,
  resumo,
  ...extra
})

// ── Projects and columns ─────────────────────────────────────────────────────

const createProject: Handler = (args, _scope, phase, store) => {
  const name = requiredText(args, 'name', LIMITS.projectName)
  const description = optionalText(args, 'description', LIMITS.description)
  const color = optionalProjectColor(args)
  const existing = store.projects.find((project) => sameName(project.name, name))
  if (existing) return done(existing.id, `Criar projeto "${name}"`, { existente: true })
  if (phase === 'prepare') return done('', `Criar projeto "${name}"`)
  // createProject focuses the new project; a background agent must not move the user's screen.
  const previous = store.activeProjectId
  const id = store.createProject(name, description || undefined, color)
  useKanbanStore.setState({ activeProjectId: previous })
  useKanbanStore.getState()._persist()
  return done(id, `Criar projeto "${name}"`)
}

const updateProject: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'links'>> = {}
  const name = optionalText(args, 'name', LIMITS.projectName)
  if (name !== undefined) {
    if (!name) refuse('name não pode ser vazio.')
    if (store.projects.some((item) => item.id !== project.id && sameName(item.name, name)))
      refuse(`Já existe um projeto chamado "${name}".`)
    updates.name = name
  }
  const description = optionalText(args, 'description', LIMITS.description)
  if (description !== undefined) updates.description = description || undefined
  const color = optionalProjectColor(args)
  if (color) updates.color = color
  if (args.links !== undefined) updates.links = parseLinks(args.links, project.links ?? [])
  if (!Object.keys(updates).length) refuse('Nada para alterar.')
  const resumo = `Editar projeto "${project.name}"`
  if (phase === 'apply') store.updateProject(project.id, updates)
  return done(project.id, resumo)
}

const archiveProject: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const resumo = `Arquivar projeto "${project.name}"`
  if (project.archivedAt) return done(project.id, resumo, { jaArquivado: true })
  if (phase === 'apply') store.archiveProject(project.id)
  return done(project.id, resumo)
}

const unarchiveProject: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const resumo = `Desarquivar projeto "${project.name}"`
  if (!project.archivedAt) return done(project.id, resumo, { jaAtivo: true })
  if (phase === 'apply') store.unarchiveProject(project.id)
  return done(project.id, resumo)
}

const deleteProject: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const tasks = store.tasks.filter((task) => task.projectId === project.id).length
  const resumo = `Excluir projeto "${project.name}" e ${tasks} tarefa(s)`
  if (phase === 'apply') store.deleteProject(project.id)
  return done(project.id, resumo, { tarefasExcluidas: tasks })
}

const createColumn: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const name = requiredText(args, 'name', LIMITS.columnName)
  guardColumnName(project, name)
  const color = optionalProjectColor(args)
  const resumo = `Criar coluna "${name}" em ${project.name}`
  if (phase === 'prepare') return done('', resumo)
  store.createColumn(project.id, name, color)
  const created = useKanbanStore
    .getState()
    .projects.find((item) => item.id === project.id)
    ?.columns.find((column) => column.name === name)
  return done(created?.id ?? '', resumo)
}

const updateColumn: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const column = resolveColumn(project, requiredText(args, 'column', 200))
  const updates: Partial<Pick<Column, 'name' | 'color'>> = {}
  const name = optionalText(args, 'name', LIMITS.columnName)
  if (name !== undefined) {
    if (!name) refuse('name não pode ser vazio.')
    guardColumnName(project, name, column)
    updates.name = name
  }
  const color = optionalProjectColor(args)
  if (color) updates.color = color
  if (!Object.keys(updates).length) refuse('Nada para alterar.')
  if (phase === 'apply') store.updateColumn(project.id, column.id, updates)
  return done(column.id, `Editar coluna "${column.name}" em ${project.name}`)
}

const reorderColumns: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const ids = args.columnIds
  const current = project.columns.map((column) => column.id)
  if (
    !Array.isArray(ids) ||
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === 'string' && current.includes(id))
  )
    refuse('columnIds precisa listar todas as colunas do projeto, uma vez cada.')
  if (phase === 'apply') store.reorderColumns(project.id, ids as string[])
  return done(project.id, `Reordenar colunas de ${project.name}`)
}

const deleteColumn: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const column = resolveColumn(project, requiredText(args, 'column', 200))
  // deleteColumn would delete the column's tasks; the MCP only removes an empty one.
  const tasks = columnTaskCount(store, project, column)
  if (tasks > 0)
    refuse(`A coluna "${column.name}" tem ${tasks} tarefa(s); mova-as antes de excluí-la.`)
  if (project.columns.length <= 1) refuse('O projeto precisa de pelo menos uma coluna.')
  if (phase === 'apply') store.deleteColumn(project.id, column.id)
  return done(column.id, `Excluir coluna "${column.name}" do projeto ${project.name}`)
}

const HANDLERS: Record<string, Handler> = {
  create_project: createProject,
  update_project: updateProject,
  archive_project: archiveProject,
  unarchive_project: unarchiveProject,
  delete_project: deleteProject,
  create_column: createColumn,
  update_column: updateColumn,
  reorder_columns: reorderColumns,
  delete_column: deleteColumn
}

function run(name: string, args: Args, scope: McpScope, phase: Phase): McpActionResult {
  const handler = HANDLERS[name]
  if (!handler) return { ok: false, error: 'Ferramenta indisponível nesta sessão MCP.' }
  try {
    return handler(args ?? {}, scope, phase, useKanbanStore.getState())
  } catch (error) {
    if (error instanceof McpRefusal)
      return {
        ok: false,
        error: error.message,
        ...(error.candidatos ? { candidatos: error.candidatos } : {})
      }
    throw error
  }
}

/** Validates and returns the approval summary; never writes. */
export function prepareMcpAction(name: string, args: Args, scope: McpScope): McpActionResult {
  return run(name, args, scope, 'prepare')
}

/** Re-validates against the live store, then writes through the existing slice action. */
export function applyMcpAction(name: string, args: Args, scope: McpScope): McpActionResult {
  return run(name, args, scope, 'apply')
}
