import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import Decimal from 'decimal.js'
import type { Project, Task, Column, Sprint, Tombstone, Backup, AIJson, Priority, StickyNote, Goal, GoalEntry, Habit, FinancialTable, FinancialTransaction, FinancialGoal, ShoppingItem, Currency, StoredFile, AIConversation, AiMemory } from '../types'
import { DEFAULT_COLUMN_NAMES } from '../types'
import { ElectronStorage } from '../services/ElectronStorage'
import { isDoneColumn } from '../utils/columns'

const storage = new ElectronStorage()
let _persistTimer: ReturnType<typeof setTimeout> | null = null

// Coerce a persisted monetary value to a canonical decimal string.
// Migrates legacy `number` amounts (production data) to string on load.
function moneyStr(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return new Decimal(v).toString()
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      const d = new Decimal(v)
      // Canonicalize (e.g. "70000.0" → "70000", "1500.50" → "1500.5").
      return d.isNaN() || !d.isFinite() ? '0' : d.toString()
    } catch {
      return '0'
    }
  }
  return '0'
}

// --- Code path selection -----------------------------------------------------
// `activeCodePathIds` is the source of truth; the legacy singular
// `activeCodePathId` is kept in sync with its first entry so older app versions
// and old backups keep reading the selection. Always go through these two.

/** The selected code path ids, migrating legacy single-selection data. */
function activeIds(p: Project): string[] {
  if (Array.isArray(p.activeCodePathIds)) return p.activeCodePathIds
  return p.activeCodePathId ? [p.activeCodePathId] : []
}

/** Both selection fields for a spread, kept consistent. */
function withActive(ids: string[]): Pick<Project, 'activeCodePathIds' | 'activeCodePathId'> {
  return { activeCodePathIds: ids, activeCodePathId: ids[0] }
}

// Normalize a persisted project: migrate the code path selection to the array
// form and drop ids whose path no longer exists (a stale id would silently
// select nothing).
function normalizeProject(p: Project, i: number): Project {
  const known = new Set((p.codePaths ?? []).map((c) => c.id))
  const ids = activeIds(p).filter((id) => known.has(id))
  return { ...p, order: p.order ?? i, ...withActive(ids) }
}

// Normalize a persisted financial table: fill missing arrays, default currency,
// and migrate monetary fields (amount, price, targetAmount) from number → string.
function normalizeList(l: FinancialTable): FinancialTable {
  return {
    ...l,
    currency: (l.currency || 'BRL') as Currency,
    items: (l.items ?? []).map((i) => ({
      ...i,
      price: i.price === null || i.price === undefined ? undefined : moneyStr(i.price)
    })),
    transactions: (l.transactions ?? []).map((t) => ({ ...t, amount: moneyStr(t.amount) })),
    goals: (l.goals ?? []).map((g) => ({ ...g, targetAmount: moneyStr(g.targetAmount) }))
  }
}

interface ActiveTimer {
  taskId: string
  startedAt: number
}

interface KanbanState {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  tombstones: Tombstone[]
  notes: StickyNote[]
  goals: Goal[]
  habits: Habit[]
  lists: FinancialTable[]
  activeProjectId: string | null
  sprintFilter: string | null
  activeTimer: ActiveTimer | null
  files: StoredFile[]
  isLoaded: boolean
}

interface KanbanActions {
  loadData: () => Promise<void>
  _persist: () => void
  _flushPersist: () => Promise<void>

  setActiveProject: (id: string | null) => void
  setSprintFilter: (sprintId: string | null) => void

  createProject: (name: string, description?: string, color?: string) => string
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'links'>>) => void
  moveProject: (id: string, direction: 'up' | 'down') => void
  deleteProject: (id: string) => void

  addCodePath: (projectId: string, path: string, label?: string) => string
  removeCodePath: (projectId: string, codePathId: string) => void
  /** Replaces the whole selection with a single path (or clears it). */
  setActiveCodePath: (projectId: string, codePathId: string | null) => void
  /** Adds/removes one path from the selection, leaving the others alone. */
  toggleCodePath: (projectId: string, codePathId: string) => void

  createColumn: (projectId: string, name: string, color?: string) => void
  updateColumn: (projectId: string, columnId: string, updates: Partial<Pick<Column, 'name' | 'color'>>) => void
  deleteColumn: (projectId: string, columnId: string) => void
  reorderColumns: (projectId: string, orderedIds: string[]) => void

  createTask: (
    data: Pick<Task, 'projectId' | 'columnId' | 'title'> &
      Partial<Pick<Task, 'description' | 'priority' | 'dueDate' | 'tags' | 'sprintId' | 'images'>>
  ) => string
  updateTask: (
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'dueDate' | 'tags' | 'columnId' | 'sprintId' | 'images'>>
  ) => void
  deleteTask: (id: string) => void
  moveTask: (taskId: string, newColumnId: string, newIndex: number) => void

  createSprint: (projectId: string, name: string) => string
  createSprints: (projectId: string, names: string[]) => void
  updateSprint: (sprintId: string, name: string) => boolean
  closeSprint: (sprintId: string) => void
  reopenSprint: (sprintId: string) => void
  deleteSprint: (sprintId: string) => void
  setTaskSprint: (taskId: string, sprintId: string | null) => void

  addTimeSpent: (taskId: string, seconds: number) => void
  startTimer: (taskId: string) => void
  stopTimer: () => void

  createNote: (
    projectId: string,
    data?: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'type'>>
  ) => string
  updateNote: (id: string, updates: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'taskId' | 'fontSize' | 'completedAt'>>) => void
  deleteNote: (id: string) => void
  connectNotes: (fromId: string, toId: string) => void
  disconnectNotes: (fromId: string, toId: string) => void

  createGoal: (data: Pick<Goal, 'title' | 'target' | 'unit' | 'color'> & { projectId?: string }) => string
  updateGoal: (id: string, updates: Partial<Pick<Goal, 'title' | 'target' | 'unit' | 'color' | 'projectId'>>) => void
  deleteGoal: (id: string) => void
  addGoalEntry: (goalId: string, data: Pick<GoalEntry, 'date' | 'value'> & { label?: string }) => void
  deleteGoalEntry: (goalId: string, entryId: string) => void

  createHabit: (data: Pick<Habit, 'name' | 'color'>) => string
  updateHabit: (id: string, updates: Partial<Pick<Habit, 'name' | 'color'>>) => void
  deleteHabit: (id: string) => void
  toggleHabit: (id: string, isoDate: string) => void

  createList: (name: string, currency?: Currency) => string
  updateList: (id: string, name: string) => void
  setListCurrency: (id: string, currency: Currency) => void
  deleteList: (id: string) => void
  addItem: (listId: string, data: Pick<ShoppingItem, 'name' | 'qty'> & { price?: string; link?: string }) => string
  updateItem: (listId: string, itemId: string, updates: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'price' | 'done' | 'link'>>) => void
  deleteItem: (listId: string, itemId: string) => void
  toggleItem: (listId: string, itemId: string) => void

  addTransaction: (listId: string, data: Omit<FinancialTransaction, 'id'>) => string
  updateTransaction: (listId: string, txId: string, updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  deleteTransaction: (listId: string, txId: string) => void
  addFinancialGoal: (listId: string, data: Omit<FinancialGoal, 'id'>) => string
  updateFinancialGoal: (listId: string, goalId: string, updates: Partial<Omit<FinancialGoal, 'id'>>) => void
  deleteFinancialGoal: (listId: string, goalId: string) => void

  exportBackup: () => Promise<boolean>
  importBackup: () => Promise<boolean>
  importAIJson: (projectId: string) => Promise<number>
  importTasksFromAIChat: (projectId: string, tasks: AIJson['tasks']) => number

  addFiles: (files: StoredFile[]) => void
  removeFile: (id: string) => void
}

export type KanbanStore = KanbanState & KanbanActions


export const useKanbanStore = create<KanbanStore>((set, get) => ({
  projects: [],
  tasks: [],
  sprints: [],
  tombstones: [],
  notes: [],
  goals: [],
  habits: [],
  lists: [],
  activeProjectId: null,
  sprintFilter: null,
  activeTimer: null,
  files: [],
  isLoaded: false,

  _flushPersist: async () => {
    const { projects, tasks, sprints, tombstones, notes, goals, habits, lists, activeTimer, files } = get()
    await storage.save({ projects, tasks, sprints, tombstones, notes, goals, habits, lists, activeTimer, files })
  },

  _persist: () => {
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => { get()._flushPersist() }, 300)
  },

  loadData: async () => {
    const data = await storage.load()
    const projects = (data.projects || []).map(normalizeProject)

    // If a timer was running when the app was last closed, commit its elapsed time
    const savedTimer = data.activeTimer as ActiveTimer | null | undefined
    let tasks: Task[] = data.tasks || []
    if (savedTimer?.taskId) {
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
      isLoaded: true,
      activeProjectId: projects[0]?.id ?? null,
      activeTimer: null
    })

    // Persist the committed elapsed time so it's durable
    if (savedTimer?.taskId) {
      await get()._flushPersist()
    }
  },

  setActiveProject: (id) => set({ activeProjectId: id }),
  setSprintFilter: (sprintId) => set({ sprintFilter: sprintId }),

  createProject: (name, description, color = '#6366f1') => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const columns: Column[] = DEFAULT_COLUMN_NAMES.map((colName, i) => ({
      id: uuidv4(), name: colName, order: i
    }))
    const project: Project = { id, name, description, color, columns, order: undefined, createdAt: now, updatedAt: now }
    set((s) => {
      const maxOrder = s.projects.reduce((m, p) => Math.max(m, p.order ?? 0), -1)
      return { projects: [...s.projects, { ...project, order: maxOrder + 1 }], activeProjectId: id }
    })
    get()._persist()
    return id
  },

  updateProject: (id, updates) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      )
    }))
    get()._persist()
  },

  addCodePath: (projectId, path, label) => {
    const id = uuidv4()
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        const codePaths = [...(p.codePaths ?? []), { id, path, label }]
        // First path added becomes the selection; later ones are opt-in.
        const active = activeIds(p)
        return {
          ...p,
          codePaths,
          ...withActive(active.length ? active : [id]),
          updatedAt: new Date().toISOString()
        }
      })
    }))
    get()._persist()
    return id
  },

  removeCodePath: (projectId, codePathId) => {
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        const codePaths = (p.codePaths ?? []).filter((c) => c.id !== codePathId)
        // Only drop the removed path. Never backfill from the survivors: an
        // empty selection is a deliberate user state (AI reads no code), and
        // auto-selecting a folder they never picked would silently hand the
        // assistant a directory to read.
        const active = activeIds(p).filter((cid) => cid !== codePathId)
        return { ...p, codePaths, ...withActive(active), updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  setActiveCodePath: (projectId, codePathId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, ...withActive(codePathId ? [codePathId] : []), updatedAt: new Date().toISOString() }
          : p
      )
    }))
    get()._persist()
  },

  toggleCodePath: (projectId, codePathId) => {
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        const active = activeIds(p)
        const next = active.includes(codePathId)
          ? active.filter((cid) => cid !== codePathId)
          : [...active, codePathId]
        return { ...p, ...withActive(next), updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  moveProject: (id, direction) => {
    set((s) => {
      const sorted = [...s.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const idx = sorted.findIndex((p) => p.id === id)
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return s
      const aOrder = sorted[idx].order ?? idx
      const bOrder = sorted[swapIdx].order ?? swapIdx
      return {
        projects: s.projects.map((p) => {
          if (p.id === sorted[idx].id) return { ...p, order: bOrder }
          if (p.id === sorted[swapIdx].id) return { ...p, order: aOrder }
          return p
        })
      }
    })
    get()._persist()
  },

  deleteProject: (id) => {
    const now = new Date().toISOString()
    const remaining = get().projects.filter((p) => p.id !== id)
    const deletedTaskIds = get().tasks.filter((t) => t.projectId === id).map((t) => t.id)
    const newTombstones: Tombstone[] = [
      { id, type: 'project', deletedAt: now },
      ...deletedTaskIds.map((tid) => ({ id: tid, type: 'task' as const, deletedAt: now }))
    ]
    set((s) => ({
      projects: remaining,
      tasks: s.tasks.filter((t) => t.projectId !== id),
      tombstones: [...s.tombstones, ...newTombstones],
      activeProjectId: s.activeProjectId === id ? (remaining[0]?.id ?? null) : s.activeProjectId
    }))
    get()._persist()
  },

  createColumn: (projectId, name, color) => {
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        const col: Column = { id: uuidv4(), name, color, order: p.columns.length }
        return { ...p, columns: [...p.columns, col], updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  updateColumn: (projectId, columnId, updates) => {
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        return {
          ...p,
          columns: p.columns.map((c) => (c.id === columnId ? { ...c, ...updates } : c)),
          updatedAt: new Date().toISOString()
        }
      })
    }))
    get()._persist()
  },

  deleteColumn: (projectId, columnId) => {
    const now = new Date().toISOString()
    const deletedTaskIds = get().tasks
      .filter((t) => t.projectId === projectId && t.columnId === columnId)
      .map((t) => t.id)
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        return { ...p, columns: p.columns.filter((c) => c.id !== columnId), updatedAt: now }
      }),
      tasks: s.tasks.filter((t) => !(t.projectId === projectId && t.columnId === columnId)),
      tombstones: [
        ...s.tombstones,
        ...deletedTaskIds.map((tid) => ({ id: tid, type: 'task' as const, deletedAt: now }))
      ]
    }))
    get()._persist()
  },

  reorderColumns: (projectId, orderedIds) => {
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p
        const map = Object.fromEntries(p.columns.map((c) => [c.id, c]))
        return {
          ...p,
          columns: orderedIds.map((id, i) => ({ ...map[id], order: i })),
          updatedAt: new Date().toISOString()
        }
      })
    }))
    get()._persist()
  },

  createTask: (data) => {
    const now = new Date().toISOString()
    const columnTasks = get().tasks.filter((t) => t.columnId === data.columnId)
    const task: Task = {
      id: uuidv4(),
      projectId: data.projectId,
      columnId: data.columnId,
      title: data.title,
      description: data.description,
      priority: data.priority ?? 'medium',
      dueDate: data.dueDate,
      tags: data.tags ?? [],
      sprintId: data.sprintId,
      images: data.images ?? [],
      order: columnTasks.length,
      createdAt: now,
      updatedAt: now
    }
    set((s) => ({ tasks: [...s.tasks, task] }))
    get()._persist()
    return task.id
  },

  updateTask: (id, updates) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t
        const now = new Date().toISOString()
        const next = { ...t, ...updates, updatedAt: now }
        if (updates.columnId !== undefined) {
          const project = s.projects.find((p) => p.id === t.projectId)
          const col = project?.columns.find((c) => c.id === updates.columnId)
          const isDone = isDoneColumn(col)
          next.completedAt = isDone ? (t.completedAt ?? now) : undefined
        }
        return next
      })
    }))
    const s = get()
    if (s.activeTimer?.taskId === id && s.tasks.find((t) => t.id === id)?.completedAt) {
      s.stopTimer()
    }
    get()._persist()
  },

  deleteTask: (id) => {
    const now = new Date().toISOString()
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      tombstones: [...s.tombstones, { id, type: 'task', deletedAt: now }]
    }))
    get()._persist()
  },

  moveTask: (taskId, newColumnId, newIndex) => {
    set((s) => {
      const task = s.tasks.find((t) => t.id === taskId)
      if (!task) return s
      const now = new Date().toISOString()
      const project = s.projects.find((p) => p.id === task.projectId)
      const newCol = project?.columns.find((c) => c.id === newColumnId)
      const isDone = isDoneColumn(newCol)
      const otherTasks = s.tasks.filter((t) => t.id !== taskId)
      const columnTasks = otherTasks
        .filter((t) => t.columnId === newColumnId && t.projectId === task.projectId)
        .sort((a, b) => a.order - b.order)
      const updatedTask: Task = {
        ...task,
        columnId: newColumnId,
        updatedAt: now,
        completedAt: isDone ? (task.completedAt ?? now) : undefined
      }
      columnTasks.splice(newIndex, 0, updatedTask)
      const reordered = columnTasks.map((t, i) => ({ ...t, order: i }))
      const untouched = otherTasks.filter(
        (t) => !(t.columnId === newColumnId && t.projectId === task.projectId)
      )
      return { tasks: [...untouched, ...reordered] }
    })
    const s = get()
    if (s.activeTimer?.taskId === taskId && s.tasks.find((t) => t.id === taskId)?.completedAt) {
      s.stopTimer()
    }
    get()._persist()
  },

  createSprint: (projectId, name) => {
    const existing = get().sprints.find(
      (s) => s.projectId === projectId && s.name.toLowerCase() === name.trim().toLowerCase()
    )
    if (existing) return existing.id
    const id = uuidv4()
    const sprint: Sprint = { id, projectId, name: name.trim(), createdAt: new Date().toISOString() }
    set((s) => ({ sprints: [...s.sprints, sprint] }))
    get()._persist()
    return id
  },

  createSprints: (projectId, names) => {
    const now = new Date().toISOString()
    const existingNames = new Set(
      get().sprints
        .filter((s) => s.projectId === projectId)
        .map((s) => s.name.toLowerCase())
    )
    const newSprints: Sprint[] = names
      .map((n) => n.trim())
      .filter((n) => n && !existingNames.has(n.toLowerCase()))
      .map((name) => ({ id: uuidv4(), projectId, name, createdAt: now }))
    if (newSprints.length === 0) return
    set((s) => ({ sprints: [...s.sprints, ...newSprints] }))
    get()._persist()
  },

  updateSprint: (sprintId, name) => {
    const trimmed = name.trim()
    const sprints = get().sprints
    const sprint = sprints.find((s) => s.id === sprintId)
    if (!sprint || sprint.closedAt || !trimmed) return false
    const duplicate = sprints.some(
      (s) => s.id !== sprintId && s.projectId === sprint.projectId && s.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (duplicate) return false
    set((s) => ({
      sprints: s.sprints.map((sp) => sp.id === sprintId ? { ...sp, name: trimmed } : sp)
    }))
    get()._persist()
    return true
  },

  closeSprint: (sprintId) => {
    set((s) => ({
      sprints: s.sprints.map((sp) =>
        sp.id === sprintId ? { ...sp, closedAt: new Date().toISOString() } : sp
      ),
      sprintFilter: s.sprintFilter === sprintId ? null : s.sprintFilter
    }))
    get()._persist()
  },

  reopenSprint: (sprintId) => {
    set((s) => ({
      sprints: s.sprints.map((sp) => {
        if (sp.id !== sprintId) return sp
        const { closedAt: _, ...rest } = sp
        return rest as typeof sp
      })
    }))
    get()._persist()
  },

  deleteSprint: (sprintId) => {
    const now = new Date().toISOString()
    set((s) => ({
      sprints: s.sprints.filter((sp) => sp.id !== sprintId),
      tasks: s.tasks.map((t) => t.sprintId === sprintId ? { ...t, sprintId: undefined } : t),
      tombstones: [...s.tombstones, { id: sprintId, type: 'sprint', deletedAt: now }],
      sprintFilter: s.sprintFilter === sprintId ? null : s.sprintFilter
    }))
    get()._persist()
  },

  setTaskSprint: (taskId, sprintId) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, sprintId: sprintId ?? undefined, updatedAt: new Date().toISOString() } : t
      )
    }))
    get()._persist()
  },

  addTimeSpent: (taskId, seconds) => {
    if (seconds <= 0) return
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? { ...t, timeSpent: (t.timeSpent ?? 0) + seconds, updatedAt: new Date().toISOString() }
          : t
      )
    }))
    get()._persist()
  },

  startTimer: (taskId) => {
    const { activeTimer } = get()
    if (activeTimer) {
      const elapsed = Math.floor((Date.now() - activeTimer.startedAt) / 1000)
      get().addTimeSpent(activeTimer.taskId, elapsed)
    }
    set({ activeTimer: { taskId, startedAt: Date.now() } })
  },

  stopTimer: () => {
    const { activeTimer } = get()
    if (!activeTimer) return
    const elapsed = Math.floor((Date.now() - activeTimer.startedAt) / 1000)
    get().addTimeSpent(activeTimer.taskId, elapsed)
    set({ activeTimer: null })
  },

  createNote: (projectId, data = {}) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const note: StickyNote = {
      id,
      projectId,
      content: data.content ?? '',
      color: data.color ?? '#fef08a',
      x: data.x ?? 100,
      y: data.y ?? 100,
      width: data.width ?? 200,
      height: data.height ?? 150,
      type: data.type,
      connections: [],
      createdAt: now,
      updatedAt: now
    }
    set((s) => ({ notes: [...s.notes, note] }))
    get()._persist()
    return id
  },

  updateNote: (id, updates) => {
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
      )
    }))
    get()._persist()
  },

  deleteNote: (id) => {
    const now = new Date().toISOString()
    set((s) => ({
      notes: s.notes
        .filter((n) => n.id !== id)
        .map((n) =>
          n.connections?.includes(id)
            ? { ...n, connections: n.connections.filter((c) => c !== id), updatedAt: now }
            : n
        )
    }))
    get()._persist()
  },

  connectNotes: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== fromId) return n
        const conns = n.connections ?? []
        if (conns.includes(toId)) return n
        return { ...n, connections: [...conns, toId], updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  disconnectNotes: (fromId, toId) => {
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== fromId) return n
        const conns = n.connections ?? []
        if (!conns.includes(toId)) return n
        return { ...n, connections: conns.filter((c) => c !== toId), updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  createGoal: (data) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const goal: Goal = {
      id,
      title: data.title,
      entries: [],
      target: data.target,
      unit: data.unit,
      color: data.color,
      projectId: data.projectId,
      createdAt: now,
      updatedAt: now
    }
    set((s) => ({ goals: [...s.goals, goal] }))
    get()._persist()
    return id
  },

  updateGoal: (id, updates) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g
      )
    }))
    get()._persist()
  },

  deleteGoal: (id) => {
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }))
    get()._persist()
  },

  addGoalEntry: (goalId, data) => {
    const now = new Date().toISOString()
    const entry: GoalEntry = { id: uuidv4(), date: data.date, label: data.label, value: data.value, createdAt: now }
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId ? { ...g, entries: [...g.entries, entry], updatedAt: now } : g
      )
    }))
    get()._persist()
  },

  deleteGoalEntry: (goalId, entryId) => {
    const now = new Date().toISOString()
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId ? { ...g, entries: g.entries.filter((e) => e.id !== entryId), updatedAt: now } : g
      )
    }))
    get()._persist()
  },

  createHabit: (data) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const habit: Habit = { id, name: data.name, color: data.color, completions: [], createdAt: now, updatedAt: now }
    set((s) => ({ habits: [...s.habits, habit] }))
    get()._persist()
    return id
  },

  updateHabit: (id, updates) => {
    set((s) => ({
      habits: s.habits.map((h) =>
        h.id === id ? { ...h, ...updates, updatedAt: new Date().toISOString() } : h
      )
    }))
    get()._persist()
  },

  deleteHabit: (id) => {
    set((s) => ({ habits: s.habits.filter((h) => h.id !== id) }))
    get()._persist()
  },

  toggleHabit: (id, isoDate) => {
    set((s) => ({
      habits: s.habits.map((h) => {
        if (h.id !== id) return h
        const completions = h.completions.includes(isoDate)
          ? h.completions.filter((d) => d !== isoDate)
          : [...h.completions, isoDate]
        return { ...h, completions, updatedAt: new Date().toISOString() }
      })
    }))
    get()._persist()
  },

  createList: (name, currency = 'BRL') => {
    const now = new Date().toISOString()
    const id = uuidv4()
    set((s) => ({ lists: [...s.lists, { id, name, currency, items: [], transactions: [], goals: [], createdAt: now, updatedAt: now }] }))
    get()._persist()
    return id
  },

  updateList: (id, name) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, name, updatedAt: new Date().toISOString() } : l
      )
    }))
    get()._persist()
  },

  setListCurrency: (id, currency) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, currency, updatedAt: new Date().toISOString() } : l
      )
    }))
    get()._persist()
  },

  deleteList: (id) => {
    set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }))
    get()._persist()
  },

  addItem: (listId, data) => {
    const now = new Date().toISOString()
    const itemId = uuidv4()
    const item: ShoppingItem = { id: itemId, name: data.name, qty: data.qty, price: data.price, done: false, link: data.link }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId ? { ...l, items: [...l.items, item], updatedAt: now } : l
      )
    }))
    get()._persist()
    return itemId
  },

  updateItem: (listId, itemId, updates) => {
    const now = new Date().toISOString()
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((i) => i.id === itemId ? { ...i, ...updates } : i), updatedAt: now }
          : l
      )
    }))
    get()._persist()
  },

  deleteItem: (listId, itemId) => {
    const now = new Date().toISOString()
    const list = get().lists.find((l) => l.id === listId)
    const item = list?.items.find((i) => i.id === itemId)
    const linkedTxId = item?.done ? item.linkedTransactionId : undefined
    set((s) => ({
      lists: s.lists.map((l) => {
        if (l.id !== listId) return l
        return {
          ...l,
          items: l.items.filter((i) => i.id !== itemId),
          transactions: linkedTxId ? l.transactions.filter((t) => t.id !== linkedTxId) : l.transactions,
          updatedAt: now
        }
      })
    }))
    get()._persist()
  },

  toggleItem: (listId, itemId) => {
    const now = new Date().toISOString()
    const list = get().lists.find((l) => l.id === listId)
    const item = list?.items.find((i) => i.id === itemId)
    if (!item) return

    if (!item.done) {
      const txId = uuidv4()
      const amount = item.price != null ? new Decimal(item.qty).times(item.price).toString() : '0'
      const tx: FinancialTransaction = {
        id: txId,
        description: item.name,
        amount,
        type: 'expense',
        date: now.slice(0, 10),
        fromShopping: true
      }
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id !== listId ? l : {
            ...l,
            updatedAt: now,
            items: l.items.map((i) => i.id === itemId ? { ...i, done: true, linkedTransactionId: txId } : i),
            transactions: [...l.transactions, tx]
          }
        )
      }))
    } else {
      const linkedTxId = item.linkedTransactionId
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id !== listId ? l : {
            ...l,
            updatedAt: now,
            items: l.items.map((i) => i.id === itemId ? { ...i, done: false, linkedTransactionId: undefined } : i),
            transactions: linkedTxId ? l.transactions.filter((t) => t.id !== linkedTxId) : l.transactions
          }
        )
      }))
    }
    get()._persist()
  },

  addTransaction: (listId, data) => {
    const txId = uuidv4()
    const tx: FinancialTransaction = { id: txId, ...data }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : { ...l, transactions: [...l.transactions, tx], updatedAt: new Date().toISOString() }
      )
    }))
    get()._persist()
    return txId
  },

  updateTransaction: (listId, txId, updates) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : {
          ...l,
          transactions: l.transactions.map((t) => t.id === txId ? { ...t, ...updates } : t),
          updatedAt: new Date().toISOString()
        }
      )
    }))
    get()._persist()
  },

  deleteTransaction: (listId, txId) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : {
          ...l,
          transactions: l.transactions.filter((t) => t.id !== txId),
          updatedAt: new Date().toISOString()
        }
      )
    }))
    get()._persist()
  },

  addFinancialGoal: (listId, data) => {
    const goalId = uuidv4()
    const goal: FinancialGoal = { id: goalId, ...data }
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : { ...l, goals: [...l.goals, goal], updatedAt: new Date().toISOString() }
      )
    }))
    get()._persist()
    return goalId
  },

  updateFinancialGoal: (listId, goalId, updates) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : {
          ...l,
          goals: l.goals.map((g) => g.id === goalId ? { ...g, ...updates } : g),
          updatedAt: new Date().toISOString()
        }
      )
    }))
    get()._persist()
  },

  deleteFinancialGoal: (listId, goalId) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id !== listId ? l : {
          ...l,
          goals: l.goals.filter((g) => g.id !== goalId),
          updatedAt: new Date().toISOString()
        }
      )
    }))
    get()._persist()
  },

  exportBackup: async () => {
    const { projects, tasks, sprints, tombstones, notes, goals, habits, lists } = get()
    // Chat history isn't part of the store — read it straight from storage.
    // A failure here shouldn't cost the user the rest of the backup.
    let conversations: AIConversation[] = []
    try {
      conversations = await storage.loadConversations()
    } catch {
      conversations = []
    }
    // AI memory rides along like chat history — same store-external treatment,
    // same "a failure here shouldn't cost the rest of the backup" guard.
    let memories: AiMemory[] = []
    try {
      memories = await storage.loadMemories()
    } catch {
      memories = []
    }
    const backup: Backup = {
      version: 4,
      exportedAt: new Date().toISOString(),
      projects,
      tasks,
      sprints,
      tombstones,
      notes,
      goals,
      habits,
      lists,
      conversations,
      memories
    }
    const result = await storage.exportBackup(backup)
    return result.success
  },

  importBackup: async () => {
    const result = await storage.importBackup()
    if (!result.success || result.cancelled || !result.data) return false

    const backup = result.data as Backup

    const tombstones: Tombstone[] = backup.tombstones || []
    const tombstoneIds = new Set(tombstones.map((t) => t.id))

    const projects = (backup.projects || [])
      .filter((p: Project) => !tombstoneIds.has(p.id))
      .map(normalizeProject)
    const tasks: Task[] = (backup.tasks || []).filter((t: Task) => !tombstoneIds.has(t.id))
    const sprints: Sprint[] = backup.sprints || []
    const notes: StickyNote[] = backup.notes || []
    const goals: Goal[] = backup.goals || []

    const localHabits = get().habits
    const habits: Habit[] = (backup.habits || []).map((h: Habit) => {
      const local = localHabits.find((lh) => lh.id === h.id)
      if (!local) return h
      return { ...h, completions: [...new Set([...local.completions, ...h.completions])] }
    })

    const lists: FinancialTable[] = (backup.lists || []).map(normalizeList)

    const activeProjectId = projects[0]?.id ?? null

    const files = get().files  // preserve local files — backup doesn't carry file bytes
    set({ projects, tasks, sprints, tombstones, notes, goals, habits, lists, files, activeProjectId, activeTimer: null })
    await get()._flushPersist()

    // Only touch the chat history when the backup actually carries it: a v2
    // file has no `conversations` key and must leave local history alone.
    if (Array.isArray(backup.conversations)) {
      try {
        await storage.saveConversations(backup.conversations)
      } catch {
        // History is secondary — a failure here doesn't undo the import above.
      }
    }
    // Same rule for memory (v4+): absent key = leave local memory untouched.
    // Written after the store flush above, so projects exist when a memory's
    // FK is checked (see replaceMemories).
    if (Array.isArray(backup.memories)) {
      try {
        await storage.replaceMemories(backup.memories)
      } catch {
        // Memory is secondary — a failure here doesn't undo the import above.
      }
    }
    return true
  },

  importAIJson: async (projectId) => {
    const result = await storage.importAIJson()
    if (!result.success || result.cancelled || !result.data) return 0

    const aiJson = result.data as AIJson
    if (!Array.isArray(aiJson.tasks) || aiJson.tasks.length === 0) return 0

    return get().importTasksFromAIChat(projectId, aiJson.tasks)
  },

  // Create tasks directly from an AI-produced task list (no file dialog).
  // Shares the column/sprint-matching logic used by importAIJson.
  importTasksFromAIChat: (projectId, inputs) => {
    if (!Array.isArray(inputs) || inputs.length === 0) return 0

    const { projects, tasks, sprints } = get()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return 0

    const now = new Date().toISOString()
    const columnTaskCounts: Record<string, number> = {}
    for (const t of tasks.filter((t) => t.projectId === projectId)) {
      columnTaskCounts[t.columnId] = (columnTaskCounts[t.columnId] ?? 0) + 1
    }

    const projectSprints = sprints.filter((s) => s.projectId === projectId)

    const newTasks: Task[] = inputs.map((input) => {
      const col =
        project.columns.find((c) => c.name.toLowerCase() === (input.column ?? '').toLowerCase())
        ?? project.columns[0]
      const order = columnTaskCounts[col.id] ?? 0
      columnTaskCounts[col.id] = order + 1

      const matchedSprint = input.sprint
        ? projectSprints.find((s) => s.name.toLowerCase() === input.sprint!.toLowerCase())
        : undefined

      return {
        id: uuidv4(),
        projectId,
        columnId: col.id,
        title: input.title,
        description: input.description,
        priority: (input.priority as Priority) ?? 'medium',
        dueDate: input.dueDate,
        tags: input.tags ?? [],
        sprintId: matchedSprint?.id,
        order,
        createdAt: now,
        updatedAt: now
      }
    })

    set((s) => ({ tasks: [...s.tasks, ...newTasks] }))
    get()._persist()
    return newTasks.length
  },

  addFiles: (files) => {
    set((s) => ({ files: [...s.files, ...files] }))
    get()._persist()
  },

  removeFile: (id) => {
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }))
    get()._persist()
  }
}))
