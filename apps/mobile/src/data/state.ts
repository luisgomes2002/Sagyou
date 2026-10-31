import type {
  FinancialProfile,
  FinancialTable,
  Goal,
  Habit,
  Project,
  Routine,
  Sprint,
  StickyNote,
  StoredFile,
  Task,
  TimeBlock
} from '@sagyou/core/types'

/**
 * Everything the phone syncs, in the same shape as the desktop's saved state,
 * so the core's extract/apply functions work unchanged. Kinds without a screen
 * yet (goals, planner, files…) are kept too, so nothing is lost or re-synced
 * when the v2 adds them.
 */
export interface MobileState {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  notes: StickyNote[]
  goals: Goal[]
  habits: Habit[]
  lists: FinancialTable[]
  files: StoredFile[]
  financialProfiles: FinancialProfile[]
  timeBlocks: TimeBlock[]
  routines: Routine[]
}

export function emptyState(): MobileState {
  return {
    projects: [],
    tasks: [],
    sprints: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    files: [],
    financialProfiles: [],
    timeBlocks: [],
    routines: []
  }
}
