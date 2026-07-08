import { addDays, format } from 'date-fns'
import type { Task, Project } from '../types'

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
