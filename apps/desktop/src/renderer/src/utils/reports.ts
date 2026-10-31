import type { Sprint, Task } from '../types'

export interface SprintVelocityEntry {
  sprint: Sprint
  count: number
  active: boolean
}

export function computeSprintVelocity(sprints: Sprint[], doneTasks: Task[]): SprintVelocityEntry[] {
  // Tally done tasks per sprint in a single pass rather than re-filtering the
  // whole list for each sprint. Tasks whose sprintId isn't in the window are
  // simply never read back out of the map.
  const counts = new Map<string, number>()
  for (const t of doneTasks) {
    if (t.sprintId) counts.set(t.sprintId, (counts.get(t.sprintId) ?? 0) + 1)
  }

  return [...sprints]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-8)
    .map((sprint) => ({
      sprint,
      count: counts.get(sprint.id) ?? 0,
      active: !sprint.closedAt,
    }))
}
