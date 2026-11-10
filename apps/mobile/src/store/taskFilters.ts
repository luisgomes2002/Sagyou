import { isDoneColumn } from '@sagyou/core/columns'
import { latestOpenSprint } from '@sagyou/core/sprints'
import type { Column, Priority, Project, Task } from '@sagyou/core/types'
import type { RecordRepo } from '../data/records'
import type { MobileState } from '../data/state'
import { PRIORITY_LABELS } from './tasks'

// The Tarefas tab's filters and sections (spec 2026-11-10-mobile-tarefas-navegacao).
// Pure, so the screens only draw what comes out of here. A filter is remembered
// per project in `prefs` (device-only, erased by the wipe with the rest).

export interface TaskFilter {
  /** A sprint id, 'all', or 'none' (tasks without a sprint). */
  sprint: string
  priority: 'all' | Priority
  tag: string
}

export type FilterKind = 'sprint' | 'priority' | 'tag'
export interface FilterOption {
  value: string
  label: string
}

type PrefRepo = Pick<RecordRepo, 'readPref' | 'writePref'>

export const ALL_FILTER: TaskFilter = { sprint: 'all', priority: 'all', tag: 'all' }

export const TASK_FILTER_TEXTS = {
  all: 'Todas',
  noSprint: 'Sem sprint',
  noneHere: 'Nenhuma tarefa aqui.',
  noMatch: 'Nenhuma tarefa com estes filtros.',
  clear: 'Limpar filtros',
  noOpen: 'Nenhuma tarefa aberta.',
  allTitle: 'Todas as tarefas',
  newIn: (column: string): string => `Nova tarefa em ${column}`
} as const

const PRIORITY_ORDER: readonly Priority[] = ['urgent', 'high', 'medium', 'low']
const KIND_LABELS: Record<FilterKind, string> = {
  sprint: 'Sprint',
  priority: 'Prioridade',
  tag: 'Tag'
}

export const filterKey = (projectId: string | null): string => `tasks.filter.${projectId ?? 'all'}`

/** The latest open sprint of the project; everything when there is none (or no project). */
export function defaultFilter(state: MobileState, projectId: string | null): TaskFilter {
  if (!projectId) return ALL_FILTER
  const sprint = latestOpenSprint(state.sprints, projectId)
  return { ...ALL_FILTER, sprint: sprint ? sprint.id : 'all' }
}

function doneColumnIds(state: MobileState): Set<string> {
  const ids = new Set<string>()
  for (const p of state.projects) for (const c of p.columns) if (isDoneColumn(c)) ids.add(c.id)
  return ids
}

function activeProjects(state: MobileState): Project[] {
  return state.projects.filter((p) => !p.archivedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** The tasks a screen filters: a project's (Done too), or the open ones of every active project. */
export function scopeTasks(state: MobileState, projectId: string | null): Task[] {
  if (projectId) return state.tasks.filter((t) => t.projectId === projectId)
  const done = doneColumnIds(state)
  const active = new Set(activeProjects(state).map((p) => p.id))
  return state.tasks.filter((t) => active.has(t.projectId) && !done.has(t.columnId))
}

/**
 * The remembered filter, field by field: an unreadable value is "Todas"; a
 * missing or mistyped field is "Todas" there; a sprint that is no longer open
 * in this project falls back to the default sprint; a tag no task in scope
 * has, or an unknown priority, is "Todas".
 */
export function readFilter(
  repo: PrefRepo,
  state: MobileState,
  projectId: string | null
): TaskFilter {
  const raw = repo.readPref(filterKey(projectId))
  const fallback = defaultFilter(state, projectId)
  if (raw === null) return fallback
  let saved: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ALL_FILTER
    saved = parsed as Record<string, unknown>
  } catch {
    return ALL_FILTER
  }
  const typed: TaskFilter = {
    sprint: typeof saved.sprint === 'string' ? saved.sprint : 'all',
    priority:
      typeof saved.priority === 'string' ? (saved.priority as TaskFilter['priority']) : 'all',
    tag: typeof saved.tag === 'string' ? saved.tag : 'all'
  }
  return normalizeFilter(state, projectId, typed)
}

/**
 * The filter as it can apply to the data now: a sprint that is no longer open
 * in this project falls back to the default sprint, a tag no task in scope has
 * and an unknown priority become "Todas". Run on every render, so a sprint
 * closed or deleted on the PC while the board is open never hides everything.
 */
export function normalizeFilter(
  state: MobileState,
  projectId: string | null,
  filter: TaskFilter
): TaskFilter {
  const open = projectId ? sprintOptions(state, projectId).map((o) => o.value) : ['all']
  const sprint = !projectId
    ? 'all'
    : open.includes(filter.sprint)
      ? filter.sprint
      : defaultFilter(state, projectId).sprint
  const priority =
    filter.priority === 'all' || (PRIORITY_ORDER as readonly string[]).includes(filter.priority)
      ? filter.priority
      : 'all'
  const tags = tagOptions(scopeTasks(state, projectId)).map((o) => o.value)
  const tag = tags.includes(filter.tag) ? filter.tag : 'all'
  return { sprint, priority, tag }
}

export function writeFilter(repo: PrefRepo, projectId: string | null, filter: TaskFilter): void {
  repo.writePref(filterKey(projectId), JSON.stringify(filter))
}

export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter.sprint === 'none' && task.sprintId) return false
  if (filter.sprint !== 'all' && filter.sprint !== 'none' && task.sprintId !== filter.sprint)
    return false
  if (filter.priority !== 'all' && task.priority !== filter.priority) return false
  if (filter.tag !== 'all' && !(task.tags ?? []).includes(filter.tag)) return false
  return true
}

const byOrder = (a: Task, b: Task): number => (a.order ?? 0) - (b.order ?? 0)

/** Columns in the board's order with Done ones last, each with its filtered tasks. */
export function boardSections(
  state: MobileState,
  projectId: string,
  filter: TaskFilter
): { column: Column; tasks: Task[]; done: boolean }[] {
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return []
  const sorted = [...project.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const columns = [
    ...sorted.filter((c) => !isDoneColumn(c)),
    ...sorted.filter((c) => isDoneColumn(c))
  ]
  return columns.map((column) => ({
    column,
    done: isDoneColumn(column),
    tasks: state.tasks
      .filter(
        (t) => t.projectId === projectId && t.columnId === column.id && matchesFilter(t, filter)
      )
      .sort(byOrder)
  }))
}

/** Open tasks of every active project, grouped by project; projects with none are left out. */
export function allTaskSections(
  state: MobileState,
  filter: TaskFilter
): { project: Project; tasks: Task[] }[] {
  const open = scopeTasks(state, null)
  return activeProjects(state)
    .map((project) => ({
      project,
      tasks: open
        .filter((t) => t.projectId === project.id && matchesFilter(t, filter))
        .sort(byOrder)
    }))
    .filter((section) => section.tasks.length > 0)
}

/** "Todas", "Sem sprint", then the project's open sprints, newest first. */
export function sprintOptions(state: MobileState, projectId: string): FilterOption[] {
  const open = state.sprints
    .filter((s) => s.projectId === projectId && !s.closedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return [
    { value: 'all', label: TASK_FILTER_TEXTS.all },
    { value: 'none', label: TASK_FILTER_TEXTS.noSprint },
    ...open.map((s) => ({ value: s.id, label: s.name }))
  ]
}

export function priorityOptions(): FilterOption[] {
  return [
    { value: 'all', label: TASK_FILTER_TEXTS.all },
    ...PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))
  ]
}

/** "Todas", then every tag the tasks use, alphabetically. */
export function tagOptions(tasks: Task[]): FilterOption[] {
  const tags = [...new Set(tasks.flatMap((t) => t.tags ?? []))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  )
  return [
    { value: 'all', label: TASK_FILTER_TEXTS.all },
    ...tags.map((t) => ({ value: t, label: t }))
  ]
}

/** "Sprint: Sprint 2", "Prioridade: Alta", "Tag: casa", or "…: Todas". */
export function filterChipLabel(kind: FilterKind, filter: TaskFilter, state: MobileState): string {
  let value: string = TASK_FILTER_TEXTS.all
  if (kind === 'sprint') {
    if (filter.sprint === 'none') value = TASK_FILTER_TEXTS.noSprint
    else if (filter.sprint !== 'all')
      value = state.sprints.find((s) => s.id === filter.sprint)?.name ?? TASK_FILTER_TEXTS.all
  } else if (kind === 'priority') {
    if (filter.priority !== 'all') value = PRIORITY_LABELS[filter.priority]
  } else if (filter.tag !== 'all') value = filter.tag
  return `${KIND_LABELS[kind]}: ${value}`
}

export function openCountText(n: number): string {
  return n === 1 ? '1 aberta' : `${n} abertas`
}
