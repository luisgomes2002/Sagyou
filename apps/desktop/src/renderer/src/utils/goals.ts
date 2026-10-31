import type { Goal } from '../types'

export type GoalKind = NonNullable<Goal['kind']>

export function goalKind(goal: Goal): GoalKind {
  return goal.kind ?? 'quantity'
}

export function goalCurrent(goal: Goal): number {
  return goal.entries.reduce((sum, entry) => sum + entry.value, 0)
}

export function isGoalComplete(goal: Goal): boolean {
  const target = goalKind(goal) === 'completion' ? 1 : goal.target
  return goalCurrent(goal) >= target
}

export function goalProgressPercent(goal: Goal): number {
  const target = goalKind(goal) === 'completion' ? 1 : goal.target > 0 ? goal.target : 1
  return Math.min(Math.round((goalCurrent(goal) / target) * 100), 100)
}
