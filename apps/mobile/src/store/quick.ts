import { isDoneColumn } from '@sagyou/core/columns'
import { latestOpenSprint } from '@sagyou/core/sprints'
import type { FinancialTable, Project } from '@sagyou/core/types'
import { addDays, format } from 'date-fns'
import type { MobileState } from '../data/state'
import { tablesOfProfile } from './finance'

/** Device-only: the project of the last task or note created with the (+). */
export const PREF_QUICK_PROJECT = 'quick.lastProject'

/** Active projects in the desktop's order. */
export function activeProjects(state: MobileState): Project[] {
  return state.projects.filter((p) => !p.archivedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** The remembered project while it is active; otherwise the first active one. */
export function quickProject(state: MobileState, pref: string | null): Project | undefined {
  const active = activeProjects(state)
  return active.find((p) => p.id === pref) ?? active[0]
}

/**
 * Where a quick task lands: the first column (by order) that is not Done, or
 * the first column when there is only Done; the latest open sprint, if any.
 */
export function quickTaskTarget(
  state: MobileState,
  projectId: string
): { columnId: string; sprintId?: string } | null {
  const columns = [...(state.projects.find((p) => p.id === projectId)?.columns ?? [])].sort(
    (a, b) => a.order - b.order
  )
  const column = columns.find((c) => !isDoneColumn(c)) ?? columns[0]
  if (!column) return null
  const sprint = latestOpenSprint(state.sprints, projectId)
  return sprint ? { columnId: column.id, sprintId: sprint.id } : { columnId: column.id }
}

/** The remembered table if it belongs to this profile; otherwise the profile's first table. */
export function quickTable(
  state: MobileState,
  profileId: string,
  pref: string | null
): FinancialTable | undefined {
  const tables = tablesOfProfile(state, profileId)
  return tables.find((t) => t.id === pref) ?? tables[0]
}

/** "Hoje" / "Amanhã" as a local calendar day (YYYY-MM-DD). */
export function dueChoice(choice: 'today' | 'tomorrow', today: Date): string {
  return format(choice === 'today' ? today : addDays(today, 1), 'yyyy-MM-dd')
}
