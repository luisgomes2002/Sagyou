import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Task,
  Goal,
  GoalEntry,
  FeatureId,
  UiPreferences,
  Project,
  Sprint,
  Tombstone,
  StickyNote,
  Habit,
  FinancialTable,
  StoredFile,
  TimeBlock,
  Routine
} from '../types'
import {
  DEFAULT_FINANCIAL_PROFILE_ID,
  normalizeFeaturePreferences,
  normalizeUiPreferences,
  DEFAULT_UI_PREFERENCES
} from '../types'
import { ElectronStorage } from '../services/ElectronStorage'
import {
  normalizeFinancialProfiles,
  normalizeFinancialTable,
  normalizeNotes,
  normalizeProject,
  normalizeTimers
} from './normalization'

import type { HabitsSlice } from './slices/habits'
import { createHabitsSlice } from './slices/habits'
import type { GoalsSlice } from './slices/goals'
import { createGoalsSlice } from './slices/goals'
import type { NotesSlice } from './slices/notes'
import { createNotesSlice } from './slices/notes'
import type { PlannerSlice } from './slices/planner'
import { createPlannerSlice } from './slices/planner'
import type { FilesSlice } from './slices/files'
import { createFilesSlice } from './slices/files'
import type { ProjectsSlice } from './slices/projects'
import { createProjectsSlice } from './slices/projects'
import type { TasksSlice } from './slices/tasks'
import { createTasksSlice } from './slices/tasks'
import type { FinancialSlice } from './slices/financial'
import { createFinancialSlice } from './slices/financial'
import type { BackupSlice } from './slices/backup'
import { createBackupSlice } from './slices/backup'

const storage = new ElectronStorage()
let _persistTimer: ReturnType<typeof setTimeout> | null = null
// Saves sent to main and not answered yet. A remote state that arrives
// meanwhile may predate one of them, so it is not taken as is.
let _savesInFlight = 0

// --- Core slice (lifecycle + persistence) ---

interface CoreState {
  isLoaded: boolean
  /** Undefined means this installation has not answered feature onboarding yet. */
  featurePreferences?: FeatureId[]
  uiPreferences: UiPreferences
  /** Last sync generation applied; sent with every save so main keeps newer remote changes. */
  syncGeneration: number
}

/** What main sends on `sync:remote-changes`: the state after a pull, and its generation. */
export interface RemoteChanges {
  generation: number
  state: Record<string, unknown>
}

interface CoreActions {
  loadData: () => Promise<void>
  _persist: () => void
  _flushPersist: () => Promise<void>
  /** Take a state changed by sync. It is already in the database, so it is never saved back. */
  applyRemoteChanges: (changes: RemoteChanges) => Promise<void>
  setFeaturePreferences: (features: FeatureId[]) => void
  setUiPreferences: (preferences: UiPreferences) => void
}

type CoreSlice = CoreState & CoreActions

export type KanbanStore = CoreSlice &
  HabitsSlice &
  GoalsSlice &
  NotesSlice &
  PlannerSlice &
  FilesSlice &
  ProjectsSlice &
  TasksSlice &
  FinancialSlice &
  BackupSlice

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * The synced collections of a state from main, normalized like loadData does.
 * Device-only choices (active project and profile, timers, preferences) stay
 * with this window; a choice whose target was deleted elsewhere falls back.
 */
function syncedCollections(
  data: Record<string, unknown>,
  current: { activeProjectId: string | null; activeFinancialProfileId: string }
): Partial<KanbanStore> {
  const projects = listOf<Project>(data.projects).map(normalizeProject)
  const financialProfiles = normalizeFinancialProfiles(data.financialProfiles)
  const profileIds = new Set(financialProfiles.map((profile) => profile.id))
  return {
    projects,
    tasks: listOf<Task>(data.tasks),
    sprints: listOf<Sprint>(data.sprints),
    tombstones: listOf<Tombstone>(data.tombstones),
    notes: normalizeNotes(listOf<StickyNote>(data.notes)),
    goals: listOf<Goal>(data.goals),
    habits: listOf<Habit>(data.habits),
    financialProfiles,
    activeFinancialProfileId: profileIds.has(current.activeFinancialProfileId)
      ? current.activeFinancialProfileId
      : DEFAULT_FINANCIAL_PROFILE_ID,
    lists: listOf<FinancialTable>(data.lists)
      .map(normalizeFinancialTable)
      .map((list) => ({
        ...list,
        profileId: profileIds.has(list.profileId ?? '')
          ? list.profileId
          : DEFAULT_FINANCIAL_PROFILE_ID
      })),
    files: listOf<StoredFile>(data.files),
    timeBlocks: listOf<TimeBlock>(data.timeBlocks),
    routines: listOf<Routine>(data.routines),
    activeProjectId: projects.some((project) => project.id === current.activeProjectId)
      ? current.activeProjectId
      : (projects[0]?.id ?? null)
  }
}

const createCoreSlice: StateCreator<KanbanStore, [], [], CoreSlice> = (set, get) => ({
  isLoaded: false,
  uiPreferences: { ...DEFAULT_UI_PREFERENCES },
  syncGeneration: 0,

  _flushPersist: async () => {
    if (_persistTimer !== null) {
      clearTimeout(_persistTimer)
      _persistTimer = null
    }
    const {
      projects,
      tasks,
      sprints,
      tombstones,
      notes,
      goals,
      habits,
      lists,
      financialProfiles,
      activeFinancialProfileId,
      featurePreferences,
      uiPreferences,
      activeTimers,
      files,
      timeBlocks,
      routines,
      syncGeneration
    } = get()
    _savesInFlight += 1
    try {
      await storage.save({
        projects,
        tasks,
        sprints,
        tombstones,
        notes,
        goals,
        habits,
        lists,
        financialProfiles,
        activeFinancialProfileId,
        featurePreferences,
        uiPreferences,
        activeTimers,
        files,
        timeBlocks,
        routines,
        activeTimer: activeTimers[0] ?? null,
        syncGeneration
      })
    } finally {
      _savesInFlight -= 1
    }
  },

  _persist: () => {
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      get()._flushPersist()
    }, 300)
  },

  applyRemoteChanges: async ({ generation, state }) => {
    // Locked or not loaded yet: loadData will read the database, changes included.
    if (!get().isLoaded || generation <= get().syncGeneration) return
    if (_persistTimer !== null || _savesInFlight > 0) {
      // A local edit is waiting to be saved, or its save is still on the way,
      // so it may be missing from this state. Save (main keeps the remote
      // versions over it), then take what the database holds.
      await get()._flushPersist()
      const saved = await storage.load()
      set({
        ...syncedCollections(saved as unknown as Record<string, unknown>, get()),
        syncGeneration: Math.max(saved.syncGeneration ?? 0, generation)
      })
      return
    }
    set({ ...syncedCollections(state, get()), syncGeneration: generation })
  },

  setFeaturePreferences: (features) => {
    set({ featurePreferences: normalizeFeaturePreferences(features) ?? [] })
    get()._persist()
  },

  setUiPreferences: (uiPreferences) => {
    set({ uiPreferences: normalizeUiPreferences(uiPreferences) })
    get()._persist()
  },

  loadData: async () => {
    const data = await storage.load()
    const projects = (data.projects || []).map(normalizeProject)
    const financialProfiles = normalizeFinancialProfiles(data.financialProfiles)
    const financialProfileIds = new Set(financialProfiles.map((profile) => profile.id))
    const activeFinancialProfileId = financialProfileIds.has(data.activeFinancialProfileId ?? '')
      ? data.activeFinancialProfileId!
      : DEFAULT_FINANCIAL_PROFILE_ID

    const savedTimers = normalizeTimers(data)
    let tasks: Task[] = data.tasks || []
    for (const savedTimer of savedTimers) {
      const elapsed = Math.floor((Date.now() - savedTimer.startedAt) / 1000)
      if (elapsed > 0) {
        tasks = tasks.map((t) =>
          t.id === savedTimer.taskId
            ? { ...t, timeSpent: (t.timeSpent ?? 0) + elapsed, updatedAt: new Date().toISOString() }
            : t
        )
      }
    }

    set({
      projects,
      tasks,
      sprints: data.sprints || [],
      tombstones: data.tombstones || [],
      notes: normalizeNotes(data.notes || []),
      goals: (data.goals || []).map((g: Goal & { current?: number }) => {
        if (Array.isArray(g.entries)) return g as Goal
        const entries: GoalEntry[] = []
        if (typeof g.current === 'number' && g.current > 0) {
          entries.push({
            id: uuidv4(),
            date: g.createdAt.slice(0, 10),
            value: g.current,
            createdAt: g.createdAt
          })
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { current: _c, ...rest } = g
        return { ...rest, entries } as Goal
      }),
      habits: data.habits || [],
      financialProfiles,
      activeFinancialProfileId,
      featurePreferences: normalizeFeaturePreferences(data.featurePreferences),
      uiPreferences: normalizeUiPreferences(data.uiPreferences),
      lists: (data.lists || []).map(normalizeFinancialTable).map((list) => ({
        ...list,
        profileId: financialProfileIds.has(list.profileId ?? '')
          ? list.profileId
          : DEFAULT_FINANCIAL_PROFILE_ID
      })),
      files: data.files || [],
      timeBlocks: data.timeBlocks || [],
      routines: data.routines || [],
      isLoaded: true,
      syncGeneration: data.syncGeneration ?? 0,
      activeProjectId: projects[0]?.id ?? null,
      activeTimers: []
    })

    if (savedTimers.length > 0) {
      await get()._flushPersist()
    }
  }
})

export const useKanbanStore = create<KanbanStore>()((...a) => ({
  ...createCoreSlice(...a),
  ...createHabitsSlice(...a),
  ...createGoalsSlice(...a),
  ...createNotesSlice(...a),
  ...createPlannerSlice(...a),
  ...createFilesSlice(...a),
  ...createProjectsSlice(...a),
  ...createTasksSlice(...a),
  ...createFinancialSlice(...a),
  ...createBackupSlice(storage)(...a)
}))

// The preload is absent in tests and in a browser build.
window.electronAPI?.sync?.onRemoteChanges((changes) => {
  void useKanbanStore.getState().applyRemoteChanges(changes)
})
