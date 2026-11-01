import { isDoneColumn } from '@sagyou/core/columns'
import { upcomingTasks } from '@sagyou/core/dueDates'
import { addSprint } from '@sagyou/core/sprints'
import { randomUUID } from '@sagyou/core/sync/bytes'
import type { Column, Priority, Project, Task } from '@sagyou/core/types'
import { addDays, endOfWeek, format, parseISO } from 'date-fns'
import type { MobileState } from '../data/state'

// Pure edits of the synced state, mirroring the desktop's tasks slice
// (createTask/updateTask/moveTask). The phone has no timers, so the desktop's
// "stop the timer on Done" step has nothing to do here.

/** pt-BR labels for the phone (the desktop config keeps English labels). */
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente'
}

export interface TaskInput {
  projectId: string
  columnId: string
  title: string
  description?: string
  priority?: Priority
  dueDate?: string
  tags?: string[]
  sprintId?: string
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'priority' | 'dueDate' | 'tags' | 'columnId' | 'sprintId'>
>

function columnOf(state: MobileState, projectId: string, columnId: string): Column | undefined {
  return state.projects.find((p) => p.id === projectId)?.columns.find((c) => c.id === columnId)
}

export function createTask(
  state: MobileState,
  input: TaskInput,
  now: Date
): { state: MobileState; id: string } {
  const at = now.toISOString()
  const done = isDoneColumn(columnOf(state, input.projectId, input.columnId))
  const task: Task = {
    id: randomUUID(),
    projectId: input.projectId,
    columnId: input.columnId,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate || undefined,
    tags: input.tags ?? [],
    sprintId: input.sprintId,
    images: [],
    order: state.tasks.filter((t) => t.columnId === input.columnId).length,
    createdAt: at,
    updatedAt: at,
    completedAt: done ? at : undefined
  }
  return { state: { ...state, tasks: [...state.tasks, task] }, id: task.id }
}

/** Applies the form's fields on top of the full task, so fields the phone does not show survive. */
export function updateTask(
  state: MobileState,
  id: string,
  patch: TaskPatch,
  now: Date
): MobileState {
  const at = now.toISOString()
  return {
    ...state,
    tasks: state.tasks.map((t) => {
      if (t.id !== id) return t
      const next: Task = { ...t, ...patch, updatedAt: at }
      if (patch.columnId !== undefined && patch.columnId !== t.columnId) {
        const done = isDoneColumn(columnOf(state, t.projectId, patch.columnId))
        next.completedAt = done ? (t.completedAt ?? at) : undefined
        next.order = state.tasks.filter(
          (o) => o.id !== id && o.columnId === patch.columnId && o.projectId === t.projectId
        ).length
      }
      return next
    })
  }
}

/** Moves a task to the end of another column of its project (Done sets completedAt). */
export function moveTask(state: MobileState, id: string, columnId: string, now: Date): MobileState {
  return updateTask(state, id, { columnId }, now)
}

/** Concluir: the first column named "done" of the task's project. Unchanged when there is none. */
export function completeTask(state: MobileState, id: string, now: Date): MobileState {
  const task = state.tasks.find((t) => t.id === id)
  if (!task) return state
  const done = state.projects
    .find((p) => p.id === task.projectId)
    ?.columns.slice()
    .sort((a, b) => a.order - b.order)
    .find((c) => isDoneColumn(c))
  if (!done || done.id === task.columnId) return state
  return moveTask(state, id, done.id, now)
}

export const NO_DONE_COLUMN_TEXT = 'Este projeto não tem coluna Done.'

/**
 * Desfazer a conclusão: puts back the column, position and completion the task
 * had before, on top of the task as it is NOW, so an edit that arrived in the
 * meantime (title from the PC, a tag) survives.
 */
export function revertCompletion(state: MobileState, before: Task, now: Date): MobileState {
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === before.id
        ? {
            ...t,
            columnId: before.columnId,
            order: before.order,
            completedAt: before.completedAt,
            updatedAt: now.toISOString()
          }
        : t
    )
  }
}

export type UpcomingKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

export const UPCOMING_SECTION_TITLES: Record<UpcomingKey, string> = {
  overdue: 'Atrasadas',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  week: 'Esta semana',
  later: 'Mais tarde'
}

const UPCOMING_ORDER: UpcomingKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later']

const iso = (d: Date): string => format(d, 'yyyy-MM-dd')

/** "Esta semana" runs from the day after tomorrow up to this week's Sunday. */
function sectionOf(dueDate: string, today: string): UpcomingKey {
  const day = parseISO(today)
  const tomorrow = iso(addDays(day, 1))
  const sunday = iso(endOfWeek(day, { weekStartsOn: 1 }))
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  if (dueDate === tomorrow) return 'tomorrow'
  if (dueDate <= sunday) return 'week'
  return 'later'
}

/** Próximas, grouped; empty sections are left out. Same tasks as the core's upcomingTasks. */
export function upcomingSections(
  tasks: Task[],
  projects: Project[],
  today: string
): { key: UpcomingKey; tasks: Task[] }[] {
  const groups = new Map<UpcomingKey, Task[]>()
  for (const task of upcomingTasks(tasks, projects)) {
    const key = sectionOf(task.dueDate!, today)
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  return UPCOMING_ORDER.filter((k) => groups.has(k)).map((key) => ({
    key,
    tasks: groups.get(key)!
  }))
}

export function todaySummary(
  tasks: Task[],
  projects: Project[],
  today: string
): { today: number; overdue: number } {
  let dueToday = 0
  let overdue = 0
  for (const t of upcomingTasks(tasks, projects)) {
    if (t.dueDate === today) dueToday++
    else if (t.dueDate! < today) overdue++
  }
  return { today: dueToday, overdue }
}

export function todayText({ today, overdue }: { today: number; overdue: number }): string {
  const parts: string[] = []
  if (today) parts.push(`${today} para hoje`)
  if (overdue) parts.push(`${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'}`)
  return parts.length ? parts.join(' · ') : 'Nada vence hoje'
}

/** Open = not in a Done column; the bar shows done out of total. */
export function projectProgress(
  state: MobileState,
  projectId: string
): { open: number; done: number; total: number } {
  const project = state.projects.find((p) => p.id === projectId)
  const doneColumns = new Set(project?.columns.filter((c) => isDoneColumn(c)).map((c) => c.id))
  const tasks = state.tasks.filter((t) => t.projectId === projectId)
  const done = tasks.filter((t) => doneColumns.has(t.columnId)).length
  return { open: tasks.length - done, done, total: tasks.length }
}

export function createSprint(
  state: MobileState,
  projectId: string,
  name: string,
  now: Date
): { state: MobileState; sprintId: string } | { error: string } {
  const result = addSprint(state.sprints, projectId, name, now)
  if ('error' in result) return result
  return { state: { ...state, sprints: result.sprints }, sprintId: result.sprintId }
}
