import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Project, Task, Goal, GoalEntry, FinancialTable, ActiveTimer, Currency
} from '../types'
import { moneyStr } from '../utils/money'
import { ElectronStorage } from '../services/ElectronStorage'

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

// --- Code path selection helpers (also mirrored in slices/projects.ts) ---

function activeIds(p: Project): string[] {
  if (Array.isArray(p.activeCodePathIds)) return p.activeCodePathIds
  return p.activeCodePathId ? [p.activeCodePathId] : []
}

function withActive(ids: string[]): Pick<Project, 'activeCodePathIds' | 'activeCodePathId'> {
  return { activeCodePathIds: ids, activeCodePathId: ids[0] }
}

function normalizeProject(p: Project, i: number): Project {
  const known = new Set((p.codePaths ?? []).map((c) => c.id))
  const ids = activeIds(p).filter((id) => known.has(id))
  return { ...p, order: p.order ?? i, ...withActive(ids) }
}

// Keep in sync with the identical normalizeList in src/renderer/src/store/slices/backup.ts.
function normalizeList(l: FinancialTable): FinancialTable {
  return {
    ...l,
    currency: (l.currency || 'BRL') as Currency,
    items: (l.items ?? []).map((i) => ({
      ...i,
      price: i.price === null || i.price === undefined ? undefined : moneyStr(i.price)
    })),
    transactions: (l.transactions ?? []).map((t) => ({ ...t, amount: moneyStr(t.amount) })),
    goals: (l.goals ?? []).map((g) => ({ ...g, targetAmount: moneyStr(g.targetAmount) })),
    yieldSources: (l.yieldSources ?? []).map((s) => ({ ...s })),
    yieldEntries: (l.yieldEntries ?? []).map((e) => ({ ...e, amount: moneyStr(e.amount) }))
  }
}

function normalizeTimers(data: {
  activeTimers?: unknown
  activeTimer?: unknown
}): ActiveTimer[] {
  const valid = (t: unknown): t is ActiveTimer =>
    !!t &&
    typeof (t as ActiveTimer).taskId === 'string' &&
    typeof (t as ActiveTimer).startedAt === 'number'
  if (Array.isArray(data.activeTimers)) return data.activeTimers.filter(valid)
  return valid(data.activeTimer) ? [data.activeTimer] : []
}

// --- Core slice (lifecycle + persistence) ---

interface CoreState {
  isLoaded: boolean
}

interface CoreActions {
  loadData: () => Promise<void>
  _persist: () => void
  _flushPersist: () => Promise<void>
}

type CoreSlice = CoreState & CoreActions

export type KanbanStore = CoreSlice &
  HabitsSlice & GoalsSlice & NotesSlice & PlannerSlice & FilesSlice &
  ProjectsSlice & TasksSlice & FinancialSlice & BackupSlice

const createCoreSlice: StateCreator<
  KanbanStore,
  [],
  [],
  CoreSlice
> = (set, get) => ({
  isLoaded: false,

  _flushPersist: async () => {
    const { projects, tasks, sprints, tombstones, notes, goals, habits, lists, activeTimers, files, timeBlocks, routines } = get()
    await storage.save({
      projects, tasks, sprints, tombstones, notes, goals, habits, lists, activeTimers, files, timeBlocks, routines,
      activeTimer: activeTimers[0] ?? null
    })
  },

  _persist: () => {
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => { get()._flushPersist() }, 300)
  },

  loadData: async () => {
    const data = await storage.load()
    const projects = (data.projects || []).map(normalizeProject)

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
      notes: data.notes || [],
      goals: (data.goals || []).map((g: Goal & { current?: number }) => {
        if (Array.isArray(g.entries)) return g as Goal
        const entries: GoalEntry[] = []
        if (typeof g.current === 'number' && g.current > 0) {
          entries.push({ id: uuidv4(), date: g.createdAt.slice(0, 10), value: g.current, createdAt: g.createdAt })
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { current: _c, ...rest } = g
        return { ...rest, entries } as Goal
      }),
      habits: data.habits || [],
      lists: (data.lists || []).map(normalizeList),
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
