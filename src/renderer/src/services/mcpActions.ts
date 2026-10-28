import Decimal from 'decimal.js'
import { v4 as uuidv4 } from 'uuid'
import { useKanbanStore } from '../store/kanban'
import {
  CURRENCY_CONFIG,
  DEFAULT_FINANCIAL_PROFILE_ID,
  NOTE_COLORS,
  PRIORITY_CONFIG,
  PROJECT_COLORS,
  type Column,
  type Currency,
  type FinancialProfile,
  type FinancialTable,
  type FinancialTransaction,
  type Goal,
  type Priority,
  type Project,
  type ProjectLink,
  type Sprint,
  type StickyNote,
  type Task
} from '../types'
import { isDoneColumn } from '../utils/columns'
import { todayLocalISO } from '../utils/dates'
import { D } from '../utils/money'
import { goalCurrent, goalKind, isGoalComplete, type GoalKind } from '../utils/goals'
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
  links: 20,
  taskTitle: 300,
  sprintName: 120,
  tags: 20,
  tag: 60,
  goalUnit: 40,
  goalLabel: 200,
  transactionDescription: 300,
  category: 60,
  financialName: 80,
  transactionSource: 80,
  counterparty: 120,
  bankReference: 120
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

/** A real calendar day in YYYY-MM-DD; `2026-02-30` is refused. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

/** Optional date: undefined when absent, '' when explicitly cleared. */
function optionalDate(args: Args, key: string): string | undefined {
  const value = optionalText(args, key, 10)
  if (value === undefined || value === '') return value
  if (!isCalendarDate(value)) refuse(`${key} precisa ser uma data real no formato YYYY-MM-DD.`)
  return value
}

function optionalTags(args: Args): string[] | undefined {
  const value = args.tags
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length > LIMITS.tags ||
    value.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > LIMITS.tag)
  )
    refuse(
      `tags precisa ser uma lista de até ${LIMITS.tags} textos de até ${LIMITS.tag} caracteres.`
    )
  return (value as string[]).map((tag) => tag.trim())
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

const byOrder = (project: Project): Column[] =>
  [...project.columns].sort((a, b) => a.order - b.order)

/** By exact id anywhere, or by exact title (case-insensitive) inside the scoped project. */
function resolveTask(args: Args, scope: McpScope, store: Store, projectKey = 'projectId'): Task {
  const id = optionalText(args, 'id', 200)
  if (id) {
    const task = store.tasks.find((item) => item.id === id)
    if (!task) refuse('Tarefa não encontrada.')
    return task as Task
  }
  const title = optionalText(args, 'title', LIMITS.taskTitle)
  if (!title) refuse('Informe id ou title da tarefa.')
  const project = resolveProject(args, scope, store, projectKey)
  const matches = store.tasks.filter(
    (item) => item.projectId === project.id && sameName(item.title, title as string)
  )
  if (matches.length > 1)
    refuse(
      'Mais de um registro com esse título; use o id.',
      matches.slice(0, 10).map((item) => ({ id: item.id, title: item.title }))
    )
  if (!matches.length) refuse('Tarefa não encontrada.')
  return matches[0]
}

function taskProject(store: Store, task: Task): Project {
  const project = store.projects.find((item) => item.id === task.projectId)
  if (!project) refuse('Projeto da tarefa não encontrado.')
  return project as Project
}

function taskInDone(project: Project, task: Task): boolean {
  return isDoneColumn(project.columns.find((column) => column.id === task.columnId))
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
  const notes = store.notes.filter((note) => note.projectId === project.id).length
  const resumo =
    `Excluir projeto "${project.name}" e ${tasks} tarefa(s)` +
    (notes ? `, com ${notes} nota(s) do canvas` : '')
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

// ── Tasks ────────────────────────────────────────────────────────────────────

const updateTask: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'dueDate' | 'tags'>> = {}
  const title = optionalText(args, 'newTitle', LIMITS.taskTitle)
  if (title !== undefined) {
    if (!title) refuse('newTitle não pode ser vazio.')
    updates.title = title
  }
  const description = optionalText(args, 'description', LIMITS.description)
  if (description !== undefined) updates.description = description || undefined
  const dueDate = optionalDate(args, 'dueDate')
  if (dueDate !== undefined) updates.dueDate = dueDate || undefined
  const priority = optionalText(args, 'priority', 20)
  if (priority !== undefined) {
    if (!(priority in PRIORITY_CONFIG))
      refuse(`priority precisa ser uma de: ${Object.keys(PRIORITY_CONFIG).join(', ')}.`)
    updates.priority = priority as Priority
  }
  const tags = optionalTags(args)
  if (tags !== undefined) updates.tags = tags
  const sprintRef = optionalText(args, 'sprint', 200)
  const sprint = sprintRef ? resolveSprint(store, task.projectId, sprintRef) : undefined
  if (!Object.keys(updates).length && sprintRef === undefined) refuse('Nada para alterar.')
  if (phase === 'apply') {
    if (Object.keys(updates).length) store.updateTask(task.id, updates)
    if (sprintRef !== undefined) store.setTaskSprint(task.id, sprint?.id ?? null)
  }
  return done(task.id, `Editar tarefa "${task.title}"`)
}

/** Sprints belong to one project: by id or by name (case-insensitive) inside it. */
function resolveSprint(store: Store, projectId: string, ref: string): Sprint {
  const inProject = store.sprints.filter((sprint) => sprint.projectId === projectId)
  const sprint =
    inProject.find((item) => item.id === ref) ?? inProject.find((item) => sameName(item.name, ref))
  if (!sprint) refuse(`Sprint "${ref}" não encontrada no projeto da tarefa.`)
  return sprint as Sprint
}

const createSprint: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const name = requiredText(args, 'name', LIMITS.sprintName)
  const resumo = `Criar sprint "${name}" em ${project.name}`
  const existing = store.sprints.find(
    (sprint) => sprint.projectId === project.id && sameName(sprint.name, name)
  )
  if (existing) return done(existing.id, resumo, { existente: true })
  if (phase === 'prepare') return done('', resumo)
  return done(store.createSprint(project.id, name), resumo)
}

/** Moves within the project via moveTask, or across projects via moveTaskToProject. */
function moveTo(store: Store, task: Task, target: Project, column: Column): Args {
  const wasDone = taskInDone(taskProject(store, task), task)
  if (target.id !== task.projectId) store.moveTaskToProject(task.id, target.id, column.id)
  else {
    const end = store.tasks.filter(
      (item) => item.id !== task.id && item.projectId === target.id && item.columnId === column.id
    ).length
    store.moveTask(task.id, column.id, end)
  }
  const nowDone = isDoneColumn(column)
  if (nowDone && !wasDone) return { concluida: true }
  if (!nowDone && wasDone) return { reaberta: true }
  return {}
}

const moveTask: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store, 'fromProjectId')
  const target = optionalText(args, 'projectId', 200)
    ? resolveProject(args, scope, store)
    : taskProject(store, task)
  const ref = optionalText(args, 'column', 200)
  if (!ref && target.id === task.projectId)
    refuse('column é obrigatório para mover dentro do projeto.')
  const column = ref ? resolveColumn(target, ref) : byOrder(target)[0]
  if (!column) refuse(`O projeto ${target.name} não tem colunas.`)
  const resumo = `Mover tarefa "${task.title}" para ${column.name} em ${target.name}`
  if (phase === 'prepare') return done(task.id, resumo)
  return done(task.id, resumo, moveTo(store, task, target, column))
}

const completeTask: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const project = taskProject(store, task)
  const resumo = `Concluir tarefa "${task.title}"`
  if (taskInDone(project, task)) return done(task.id, resumo, { jaConcluida: true })
  const column = byOrder(project).find((item) => isDoneColumn(item))
  if (!column) return refuse('O projeto não tem coluna de concluídas.')
  if (phase === 'prepare') return done(task.id, resumo)
  return done(task.id, resumo, moveTo(store, task, project, column))
}

const reopenTask: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const project = taskProject(store, task)
  const resumo = `Reabrir tarefa "${task.title}"`
  if (!taskInDone(project, task)) return done(task.id, resumo, { jaAberta: true })
  const column = byOrder(project).find((item) => !isDoneColumn(item))
  if (!column) return refuse('O projeto não tem coluna aberta para reabrir a tarefa.')
  if (phase === 'prepare') return done(task.id, resumo)
  return done(task.id, resumo, moveTo(store, task, project, column))
}

// ── Task timer ───────────────────────────────────────────────────────────────

const MAX_TIME_SECONDS = 86400

const timerRunning = (store: Store, task: Task): boolean =>
  store.activeTimers.some((timer) => timer.taskId === task.id)

const spentSeconds = (taskId: string): number =>
  useKanbanStore.getState().tasks.find((item) => item.id === taskId)?.timeSpent ?? 0

const startTaskTimer: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const resumo = `Iniciar cronômetro de "${task.title}"`
  if (taskInDone(taskProject(store, task), task)) return refuse('A tarefa já está concluída.')
  if (timerRunning(store, task)) return done(task.id, resumo, { jaRodando: true })
  if (phase === 'prepare') return done(task.id, resumo)
  store.startTimer(task.id)
  // main keys the run's ownership on this instant (agent-task-timers.ts).
  const startedAt = useKanbanStore
    .getState()
    .activeTimers.find((timer) => timer.taskId === task.id)?.startedAt
  return done(task.id, resumo, { startedAt })
}

const stopTaskTimer: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const resumo = `Parar cronômetro de "${task.title}"`
  if (!timerRunning(store, task)) return refuse('O cronômetro desta tarefa não está rodando.')
  if (phase === 'prepare') return done(task.id, resumo)
  store.stopTimer(task.id)
  return done(task.id, resumo, { timeSpent: spentSeconds(task.id) })
}

/**
 * Internal (not an MCP tool): main stops, at the end of an agent run, a timer
 * the run created. Only the timer started at that exact instant is stopped, so
 * a timer the user stopped and restarted is left alone.
 */
const stopRunTimer: Handler = (args, _scope, phase, store) => {
  const id = optionalText(args, 'id', 200)
  const task = store.tasks.find((item) => item.id === id)
  const timer = store.activeTimers.find((item) => item.taskId === id)
  const resumo = `Parar cronômetro da sessão de "${task?.title ?? id}"`
  if (!task || !timer || timer.startedAt !== args.startedAt)
    return done(id ?? '', resumo, { jaParado: true })
  if (phase === 'apply') store.stopTimer(task.id)
  return done(task.id, resumo)
}

const addTimeSpent: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const seconds = args.seconds
  if (
    typeof seconds !== 'number' ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > MAX_TIME_SECONDS
  )
    return refuse(`seconds deve ser um inteiro entre 1 e ${MAX_TIME_SECONDS}.`)
  const resumo = `Somar ${seconds} s ao tempo de "${task.title}"`
  if (phase === 'prepare') return done(task.id, resumo)
  store.addTimeSpent(task.id, seconds)
  return done(task.id, resumo, { timeSpent: spentSeconds(task.id) })
}

const deleteTask: Handler = (args, scope, phase, store) => {
  const task = resolveTask(args, scope, store)
  const project = taskProject(store, task)
  if (phase === 'apply') store.deleteTask(task.id)
  return done(task.id, `Excluir tarefa "${task.title}" do projeto ${project.name}`)
}

// ── Goals ────────────────────────────────────────────────────────────────────

function resolveGoal(args: Args, store: Store): Goal {
  const id = optionalText(args, 'id', 200)
  if (id) {
    const goal = store.goals.find((item) => item.id === id)
    if (!goal) refuse('Meta não encontrada.')
    return goal as Goal
  }
  const title = optionalText(args, 'title', LIMITS.taskTitle)
  if (!title) refuse('Informe id ou title da meta.')
  const matches = store.goals.filter((item) => sameName(item.title, title as string))
  if (matches.length > 1)
    refuse(
      'Mais de um registro com esse título; use o id.',
      matches.slice(0, 10).map((item) => ({ id: item.id, title: item.title }))
    )
  if (!matches.length) refuse('Meta não encontrada.')
  return matches[0]
}

function optionalTarget(args: Args): number | undefined {
  const value = args.target
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    refuse('target precisa ser um número maior que zero.')
  return value as number
}

/** A goal may belong to no project, so an absent projectId never falls back to the session. */
function optionalGoalProject(args: Args, store: Store): string | undefined {
  const id = optionalText(args, 'projectId', 200)
  if (!id) return undefined
  if (!store.projects.some((project) => project.id === id)) refuse('Projeto não encontrado.')
  return id
}

const createGoal: Handler = (args, _scope, phase, store) => {
  const title = requiredText(args, 'title', LIMITS.taskTitle)
  const kindRaw = optionalText(args, 'kind', 20) || 'quantity'
  if (kindRaw !== 'quantity' && kindRaw !== 'completion')
    refuse('kind precisa ser quantity ou completion.')
  const kind = kindRaw as GoalKind
  const target = kind === 'completion' ? 1 : optionalTarget(args)
  if (target === undefined) return refuse('target é obrigatório numa meta de quantidade.')
  const unit = optionalText(args, 'unit', LIMITS.goalUnit) ?? ''
  const color = optionalProjectColor(args) ?? PROJECT_COLORS[0]
  const projectId = optionalGoalProject(args, store)
  const resumo = `Criar meta "${title}"`
  if (phase === 'prepare') return done('', resumo)
  const id = store.createGoal({ title, target, unit, color, kind, projectId })
  return done(id, resumo)
}

const updateGoal: Handler = (args, _scope, phase, store) => {
  const goal = resolveGoal(args, store)
  const updates: Partial<Pick<Goal, 'title' | 'target' | 'unit' | 'color' | 'projectId'>> = {}
  const title = optionalText(args, 'newTitle', LIMITS.taskTitle)
  if (title !== undefined) {
    if (!title) refuse('newTitle não pode ser vazio.')
    updates.title = title
  }
  const target = optionalTarget(args)
  if (target !== undefined) {
    if (goalKind(goal) === 'completion' && target !== 1) refuse('Uma meta de conclusão tem alvo 1.')
    updates.target = target
  }
  const unit = optionalText(args, 'unit', LIMITS.goalUnit)
  if (unit !== undefined) updates.unit = unit
  const color = optionalProjectColor(args)
  if (color) updates.color = color
  const projectId = optionalGoalProject(args, store)
  if (projectId) updates.projectId = projectId
  if (!Object.keys(updates).length) refuse('Nada para alterar.')
  if (phase === 'apply') store.updateGoal(goal.id, updates)
  return done(goal.id, `Editar meta "${goal.title}"`)
}

const addGoalProgress: Handler = (args, _scope, phase, store) => {
  const goal = resolveGoal(args, store)
  const resumo = `Registrar progresso na meta "${goal.title}"`
  if (isGoalComplete(goal)) return done(goal.id, resumo, { jaConcluida: true })
  let value = 1
  if (goalKind(goal) === 'quantity') {
    const raw = args.value
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0)
      refuse('value precisa ser um número maior que zero.')
    value = raw as number
  }
  const date = optionalDate(args, 'date') || todayLocalISO()
  const label = optionalText(args, 'label', LIMITS.goalLabel)
  if (phase === 'prepare') return done(goal.id, resumo)
  store.addGoalEntry(goal.id, { date, value, ...(label ? { label } : {}) })
  const updated = useKanbanStore.getState().goals.find((item) => item.id === goal.id)
  return done(goal.id, resumo, {
    progresso: updated ? goalCurrent(updated) : value,
    concluida: updated ? isGoalComplete(updated) : false
  })
}

const deleteGoal: Handler = (args, _scope, phase, store) => {
  const goal = resolveGoal(args, store)
  if (phase === 'apply') store.deleteGoal(goal.id)
  return done(goal.id, `Excluir meta "${goal.title}"`)
}

// ── Notes ────────────────────────────────────────────────────────────────────

const NOTE_GRID = { originX: 100, originY: 100, stepX: 220, stepY: 170, perRow: 5 } as const
const NOTE_SIZE = { width: 200, height: 150 } as const

/** First grid cell whose note-sized box overlaps no existing note. */
export function freeNotePosition(notes: Pick<StickyNote, 'x' | 'y' | 'width' | 'height'>[]): {
  x: number
  y: number
} {
  const overlaps = (x: number, y: number): boolean =>
    notes.some(
      (note) =>
        x < note.x + note.width &&
        note.x < x + NOTE_SIZE.width &&
        y < note.y + note.height &&
        note.y < y + NOTE_SIZE.height
    )
  for (let cell = 0; ; cell++) {
    const x = NOTE_GRID.originX + (cell % NOTE_GRID.perRow) * NOTE_GRID.stepX
    const y = NOTE_GRID.originY + Math.floor(cell / NOTE_GRID.perRow) * NOTE_GRID.stepY
    if (!overlaps(x, y)) return { x, y }
  }
}

function optionalNoteColor(args: Args): string | undefined {
  const color = optionalText(args, 'color', 20)
  if (color === undefined || color === '') return undefined
  if (!(NOTE_COLORS as readonly string[]).includes(color))
    refuse(`color precisa ser uma de: ${NOTE_COLORS.join(', ')}.`)
  return color
}

function resolveNote(args: Args, store: Store): StickyNote {
  const id = requiredText(args, 'id', 200)
  const note = store.notes.find((item) => item.id === id)
  if (!note) refuse('Nota não encontrada.')
  return note as StickyNote
}

const noteLabel = (content: string): string =>
  content.length > 40 ? `${content.slice(0, 40)}…` : content

const createNote: Handler = (args, scope, phase, store) => {
  const project = resolveProject(args, scope, store)
  const content = requiredText(args, 'content', LIMITS.description)
  const color = optionalNoteColor(args)
  const resumo = `Criar nota "${noteLabel(content)}" em ${project.name}`
  if (phase === 'prepare') return done('', resumo)
  const position = freeNotePosition(store.notes.filter((note) => note.projectId === project.id))
  const id = store.createNote(project.id, { content, ...position, ...(color ? { color } : {}) })
  return done(id, resumo)
}

const updateNote: Handler = (args, _scope, phase, store) => {
  const note = resolveNote(args, store)
  const updates: Partial<Pick<StickyNote, 'content' | 'color'>> = {}
  const content = optionalText(args, 'content', LIMITS.description)
  if (content !== undefined) updates.content = content
  const color = optionalNoteColor(args)
  if (color) updates.color = color
  if (!Object.keys(updates).length) refuse('Nada para alterar.')
  if (phase === 'apply') store.updateNote(note.id, updates)
  return done(note.id, `Editar nota "${noteLabel(note.content)}"`)
}

const deleteNote: Handler = (args, _scope, phase, store) => {
  const note = resolveNote(args, store)
  if (phase === 'apply') store.deleteNote(note.id)
  return done(note.id, `Excluir nota "${noteLabel(note.content)}"`)
}

// ── Finance (always the session's profile) ───────────────────────────────────

const MONEY_PATTERN = /^\d+([.,]\d{1,2})?$/

/**
 * Positive amount as a 2-place canonical decimal string, or null.
 *
 * A thousands separator is refused rather than guessed: `new Decimal('1.500')`
 * is 1.5, so guessing would turn R$ 1.500 into R$ 1,50.
 */
export function parseMcpMoney(raw: unknown): string | null {
  const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw
  if (typeof text !== 'string' || !MONEY_PATTERN.test(text.trim())) return null
  const amount = new Decimal(text.trim().replace(',', '.'))
  return amount.greaterThan(0) ? amount.toDecimalPlaces(2).toString() : null
}

/** Display-only: "R$ 1.500,00", "¥ 1.500", "$ 1,500.50". */
export function formatMcpMoney(amount: string, currency: Currency): string {
  const { symbol, decimals } = CURRENCY_CONFIG[currency]
  const formatted = new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(amount))
  return `${symbol} ${formatted}`
}

const TRANSACTION_TYPES: Record<string, FinancialTransaction['type']> = {
  receita: 'income',
  despesa: 'expense'
}
const TYPE_LABEL: Record<FinancialTransaction['type'], string> = {
  income: 'receita',
  expense: 'despesa'
}
const TABLE_REFUSAL = 'Tabela indisponível nesta sessão MCP.'
const TRANSACTION_REFUSAL = 'Transação indisponível nesta sessão MCP.'
const DEBT_REFUSAL = 'Esta transação pertence a uma dívida; altere-a no Sagyou.'

function sessionProfile(scope: McpScope, store: Store): FinancialProfile {
  const profile = store.financialProfiles.find((item) => item.id === scope.financialProfileId)
  if (!profile) refuse('O perfil financeiro da sessão não existe mais.')
  return profile as FinancialProfile
}

/** Another profile's table and a missing one get the same answer, so existence never leaks. */
function resolveTable(args: Args, scope: McpScope, store: Store): FinancialTable {
  const id = optionalText(args, 'tableId', 200)
  const table = store.lists.find((item) => item.id === id)
  if (!table || (table.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID) !== scope.financialProfileId)
    refuse(TABLE_REFUSAL)
  return table as FinancialTable
}

function resolveTransaction(args: Args, table: FinancialTable): FinancialTransaction {
  const id = optionalText(args, 'id', 200)
  const transaction = table.transactions.find((item) => item.id === id)
  if (!transaction) refuse(TRANSACTION_REFUSAL)
  if ((transaction as FinancialTransaction).debtId) refuse(DEBT_REFUSAL)
  return transaction as FinancialTransaction
}

function readType(args: Args, required: boolean): FinancialTransaction['type'] | undefined {
  const raw = optionalText(args, 'type', 20)
  if (raw === undefined && !required) return undefined
  const type = TRANSACTION_TYPES[raw ?? '']
  if (!type) refuse('type precisa ser receita ou despesa.')
  return type
}

function readAmount(args: Args, required: boolean): string | undefined {
  if (args.amount === undefined && !required) return undefined
  const amount = parseMcpMoney(args.amount)
  if (!amount)
    refuse(
      'amount precisa ser um valor positivo sem separador de milhar (ex.: 1500.50 ou 1500,50).'
    )
  return amount as string
}

type BankFields = Partial<Pick<FinancialTransaction, 'source' | 'counterparty' | 'bankReference'>>

const BANK_FIELDS = [
  ['source', LIMITS.transactionSource, 'origem'],
  ['counterparty', LIMITS.counterparty, 'contraparte'],
  ['bankReference', LIMITS.bankReference, 'ref.']
] as const

/**
 * Creation omits an empty field; an update keeps the key with `undefined`, so
 * `applyFinancialTransactionEdit` records the removal in the audit.
 */
function readBankFields(args: Args, mode: 'create' | 'update'): BankFields {
  const fields: BankFields = {}
  for (const [key, max] of BANK_FIELDS) {
    const value = optionalText(args, key, max)
    if (value) fields[key] = value
    else if (value === '' && mode === 'update') fields[key] = undefined
  }
  return fields
}

const bankResumo = (fields: BankFields): string =>
  BANK_FIELDS.filter(([key]) => Object.hasOwn(fields, key))
    .map(([key, , label]) => ` · ${label} ${fields[key] ?? 'removida'}`)
    .join('')

/** Same autocomplete suggestions the transaction panel saves, in the session's profile. */
function saveBankSuggestions(store: Store, scope: McpScope, fields: BankFields): void {
  if (fields.source) store.addFinancialSource(scope.financialProfileId, fields.source)
  if (fields.counterparty)
    store.addFinancialCounterparty(scope.financialProfileId, fields.counterparty)
}

const createTransaction: Handler = (args, scope, phase, store) => {
  const table = resolveTable(args, scope, store)
  const type = readType(args, true) as FinancialTransaction['type']
  const amount = readAmount(args, true) as string
  const description = requiredText(args, 'description', LIMITS.transactionDescription)
  const date = optionalDate(args, 'date') || todayLocalISO()
  const category = optionalText(args, 'category', LIMITS.category)
  const bank = readBankFields(args, 'create')
  const value = formatMcpMoney(amount, table.currency)
  const resumo =
    `Lançar ${TYPE_LABEL[type]} de ${value} em ${table.name} — ${description} — ${date}` +
    bankResumo(bank)
  if (phase === 'prepare') return done('', resumo)
  const id = store.addTransaction(table.id, {
    description,
    amount,
    type,
    date,
    ...(category ? { category } : {}),
    ...bank
  })
  saveBankSuggestions(store, scope, bank)
  return done(id, resumo)
}

const updateTransaction: Handler = (args, scope, phase, store) => {
  const table = resolveTable(args, scope, store)
  const transaction = resolveTransaction(args, table)
  const updates: Partial<Omit<FinancialTransaction, 'id'>> = {}
  const type = readType(args, false)
  if (type) updates.type = type
  const amount = readAmount(args, false)
  if (amount) updates.amount = amount
  const description = optionalText(args, 'description', LIMITS.transactionDescription)
  if (description !== undefined) {
    if (!description) refuse('description não pode ser vazia.')
    updates.description = description
  }
  const date = optionalDate(args, 'date')
  if (date !== undefined) {
    if (!date) refuse('date não pode ser vazia.')
    updates.date = date
  }
  const category = optionalText(args, 'category', LIMITS.category)
  if (category !== undefined) updates.category = category || undefined
  const bank = readBankFields(args, 'update')
  Object.assign(updates, bank)
  if (!Object.keys(updates).length) refuse('Nada para alterar.')
  // updateTransaction silently keeps the old amount when its details exceed the new one.
  const detailed = (transaction.details ?? []).reduce(
    (total, detail) => total.plus(D(detail.amount)),
    new Decimal(0)
  )
  if (updates.amount && detailed.greaterThan(new Decimal(updates.amount)))
    refuse(
      `Os detalhes desta transação somam ${formatMcpMoney(detailed.toString(), table.currency)}; ajuste-os antes de reduzir o valor.`
    )
  const value = formatMcpMoney(updates.amount ?? transaction.amount, table.currency)
  const label = TYPE_LABEL[updates.type ?? transaction.type]
  const resumo =
    `Editar ${label} "${transaction.description}" em ${table.name} (${value})` + bankResumo(bank)
  if (phase === 'apply') {
    store.updateTransaction(table.id, transaction.id, updates)
    saveBankSuggestions(store, scope, bank)
  }
  return done(transaction.id, resumo)
}

const deleteTransaction: Handler = (args, scope, phase, store) => {
  const table = resolveTable(args, scope, store)
  const transaction = resolveTransaction(args, table)
  const value = formatMcpMoney(transaction.amount, table.currency)
  const label = TYPE_LABEL[transaction.type]
  const resumo = `Excluir ${label} "${transaction.description}" de ${value} em ${table.name}`
  if (phase === 'apply') store.deleteTransaction(table.id, transaction.id)
  return done(transaction.id, resumo)
}

const createFinancialTable: Handler = (args, scope, phase, store) => {
  const profile = sessionProfile(scope, store)
  const name = requiredText(args, 'name', LIMITS.financialName)
  const currency = optionalText(args, 'currency', 3) ?? ''
  if (!(currency in CURRENCY_CONFIG))
    refuse(`currency precisa ser uma de: ${Object.keys(CURRENCY_CONFIG).join(', ')}.`)
  const resumo = `Criar tabela financeira "${name}" (${currency}) em ${profile.name}`
  if (phase === 'prepare') return done('', resumo)
  return done(store.createList(name, currency as Currency, profile.id), resumo)
}

const addFinancialCategory: Handler = (args, scope, phase, store) => {
  const profile = sessionProfile(scope, store)
  const category = requiredText(args, 'category', LIMITS.category)
  const resumo = `Adicionar categoria "${category}" em ${profile.name}`
  if (profile.customCategories?.some((item) => sameName(item, category)))
    return done(profile.id, resumo, { existente: true })
  if (phase === 'apply') store.addFinancialCategory(profile.id, category)
  return done(profile.id, resumo)
}

const removeFinancialCategory: Handler = (args, scope, phase, store) => {
  const profile = sessionProfile(scope, store)
  const requested = requiredText(args, 'category', LIMITS.category)
  const stored = profile.customCategories?.find((item) => sameName(item, requested))
  if (!stored)
    return refuse(`A categoria "${requested}" não está nas categorias de ${profile.name}.`)
  if (phase === 'apply') store.removeFinancialCategory(profile.id, stored)
  return done(profile.id, `Remover categoria "${stored}" de ${profile.name}`)
}

const createFinancialProfile: Handler = (args, _scope, phase, store) => {
  const name = requiredText(args, 'name', LIMITS.financialName)
  const resumo = `Criar perfil financeiro "${name}"`
  const existing = store.financialProfiles.find((item) => sameName(item.name, name))
  if (existing) return done(existing.id, resumo, { existente: true })
  if (phase === 'prepare') return done('', resumo)
  return done(store.createFinancialProfile(name), resumo)
}

const renameFinancialProfile: Handler = (args, scope, phase, store) => {
  const profile = sessionProfile(scope, store)
  const name = requiredText(args, 'name', LIMITS.financialName)
  if (store.financialProfiles.some((item) => item.id !== profile.id && sameName(item.name, name)))
    refuse(`Já existe um perfil financeiro chamado "${name}".`)
  if (phase === 'apply') store.renameFinancialProfile(profile.id, name)
  return done(profile.id, `Renomear perfil financeiro "${profile.name}" para "${name}"`)
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
  delete_column: deleteColumn,
  update_task: updateTask,
  move_task: moveTask,
  complete_task: completeTask,
  reopen_task: reopenTask,
  delete_task: deleteTask,
  start_task_timer: startTaskTimer,
  stop_task_timer: stopTaskTimer,
  add_time_spent: addTimeSpent,
  stop_run_timer: stopRunTimer,
  create_sprint: createSprint,
  create_goal: createGoal,
  update_goal: updateGoal,
  add_goal_progress: addGoalProgress,
  delete_goal: deleteGoal,
  create_note: createNote,
  update_note: updateNote,
  delete_note: deleteNote,
  create_transaction: createTransaction,
  update_transaction: updateTransaction,
  delete_transaction: deleteTransaction,
  create_financial_table: createFinancialTable,
  add_financial_category: addFinancialCategory,
  remove_financial_category: removeFinancialCategory,
  create_financial_profile: createFinancialProfile,
  rename_financial_profile: renameFinancialProfile
}

function run(name: string, args: Args, scope: McpScope, phase: Phase): McpActionResult {
  const handler = HANDLERS[name]
  if (!handler) return { ok: false, error: 'Ferramenta indisponível nesta sessão MCP.' }
  // Before loadData (lock screen, reload) the store is empty: flushing it would
  // save an empty state over the database, so nothing may be written yet.
  if (!useKanbanStore.getState().isLoaded)
    return {
      ok: false,
      error: 'O Sagyou ainda está carregando ou bloqueado; tente de novo em instantes.'
    }
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
