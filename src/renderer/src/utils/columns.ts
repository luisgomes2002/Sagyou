import type { Column, Project, Task } from '../types'

export function isDoneColumn(col: Column | undefined): boolean {
  return col?.name.toLowerCase() === 'done'
}

export function isTaskDone(task: Task, projects: Project[]): boolean {
  const project = projects.find((p) => p.id === task.projectId)
  return isDoneColumn(project?.columns.find((c) => c.id === task.columnId))
}
