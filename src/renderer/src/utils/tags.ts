import type { Task } from '../types'

export interface TagCount {
  tag: string
  count: number
}

export function computeTagData(activeTasks: Task[]): TagCount[] {
  const map = new Map<string, number>()
  for (const t of activeTasks) {
    for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))
}
