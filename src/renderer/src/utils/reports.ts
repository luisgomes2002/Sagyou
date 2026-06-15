import type { Sprint, Task } from '../types'

export interface SprintVelocityEntry {
  sprint: Sprint
  count: number
  active: boolean
}

export function computeSprintVelocity(sprints: Sprint[], doneTasks: Task[]): SprintVelocityEntry[] {
  return [...sprints]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-8)
    .map((sprint) => ({
      sprint,
      count: doneTasks.filter((t) => t.sprintId === sprint.id).length,
      active: !sprint.closedAt,
    }))
}
