import { addDays, format } from 'date-fns'
import type { Task, Project } from './types'
import { isDoneColumn } from './columns'

export interface DueDateEntry {
  task: Task
  project: Project | undefined
}

export interface DueDateData {
  overdue: DueDateEntry[]
  upcoming: DueDateEntry[]
  list: DueDateEntry[]
  todayStr: string
}

export function computeDueDateData(
  activeTasks: Task[],
  projectMap: Map<string, Project>,
  today: Date
): DueDateData {
  const todayStr = format(today, 'yyyy-MM-dd')
  const in7Str = format(addDays(today, 7), 'yyyy-MM-dd')

  const overdue: DueDateEntry[] = []
  const upcoming: DueDateEntry[] = []

  for (const t of activeTasks) {
    if (!t.dueDate) continue
    const project = projectMap.get(t.projectId)
    if (t.dueDate < todayStr) overdue.push({ task: t, project })
    else if (t.dueDate <= in7Str) upcoming.push({ task: t, project })
  }

  const list = [...overdue, ...upcoming].sort((a, b) =>
    a.task.dueDate!.localeCompare(b.task.dueDate!)
  )

  return { overdue, upcoming, list, todayStr }
}

/**
 * Every unfinished task with a due date, in a project that is not archived,
 * sorted by date (so overdue ones come first). Unlike computeDueDateData there is
 * no 7-day cut: the phone's "Próximas" list shows everything that has a deadline.
 */
export function upcomingTasks(tasks: Task[], projects: Project[]): Task[] {
  const active = new Map(projects.filter((p) => !p.archivedAt).map((p) => [p.id, p]))
  return tasks
    .filter((t) => {
      if (!t.dueDate || t.completedAt) return false
      const project = active.get(t.projectId)
      if (!project) return false
      return !isDoneColumn(project.columns.find((c) => c.id === t.columnId))
    })
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.order - b.order)
}
