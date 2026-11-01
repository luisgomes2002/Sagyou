import { isDoneColumn } from '@sagyou/core/columns'
import { addSprint } from '@sagyou/core/sprints'
import { randomUUID } from '@sagyou/core/sync/bytes'
import type { Column, Priority, Task } from '@sagyou/core/types'
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
