import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Task, Goal, GoalEntry, FeatureId } from '../types'
import { DEFAULT_FINANCIAL_PROFILE_ID, normalizeFeaturePreferences } from '../types'
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

// --- Core slice (lifecycle + persistence) ---

interface CoreState {
  isLoaded: boolean
  /** Undefined means this installation has not answered feature onboarding yet. */
  featurePreferences?: FeatureId[]
}

interface CoreActions {
  loadData: () => Promise<void>
  _persist: () => void
  _flushPersist: () => Promise<void>
  setFeaturePreferences: (features: FeatureId[]) => void
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

const createCoreSlice: StateCreator<KanbanStore, [], [], CoreSlice> = (set, get) => ({
  isLoaded: false,

  _flushPersist: async () => {
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
      activeTimers,
      files,
      timeBlocks,
      routines
    } = get()
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
      activeTimers,
      files,
      timeBlocks,
      routines,
      activeTimer: activeTimers[0] ?? null
    })
  },

  _persist: () => {
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      get()._flushPersist()
    }, 300)
  },

  setFeaturePreferences: (features) => {
    set({ featurePreferences: normalizeFeaturePreferences(features) ?? [] })
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
