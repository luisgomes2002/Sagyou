import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Task, Sprint, Tombstone, ActiveTimer } from '../../types'
import { isDoneColumn } from '../../utils/columns'

export interface TasksSlice {
  tasks: Task[]
  sprints: Sprint[]
  tombstones: Tombstone[]
  sprintFilter: string | null
  activeTimers: ActiveTimer[]
  setSprintFilter: (sprintId: string | null) => void
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
  stopTimer: (taskId: string) => void
}

export const createTasksSlice: StateCreator<
  TasksSlice & {
    _persist: () => void
    _flushPersist: () => Promise<void>
    projects: { id: string; columns: { id: string; name: string; order: number; color?: string }[] }[]
    addTimeSpent: (taskId: string, seconds: number) => void
    stopTimer: (taskId: string) => void
  },
  [],
  [],
  TasksSlice
> = (set, get) => ({
  tasks: [],
  sprints: [],
  tombstones: [],
  sprintFilter: null,
  activeTimers: [],

  setSprintFilter: (sprintId) => set({ sprintFilter: sprintId }),

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
    if (s.activeTimers.some((t) => t.taskId === id) && s.tasks.find((t) => t.id === id)?.completedAt) {
      s.stopTimer(id)
    }
    get()._persist()
  },

  deleteTask: (id) => {
    const now = new Date().toISOString()
    const doomed = get().tasks.find((t) => t.id === id)?.images ?? []
    const blobs = doomed.filter((i) => i.ext).map((i) => ({ id: i.id, ext: i.ext }))
    if (blobs.length) void window.electronAPI.taskImages.delete(blobs)
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
    if (s.activeTimers.some((t) => t.taskId === taskId) && s.tasks.find((t) => t.id === taskId)?.completedAt) {
      s.stopTimer(taskId)
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
    if (get().activeTimers.some((t) => t.taskId === taskId)) return
    set((s) => ({ activeTimers: [...s.activeTimers, { taskId, startedAt: Date.now() }] }))
  },

  stopTimer: (taskId) => {
    const timer = get().activeTimers.find((t) => t.taskId === taskId)
    if (!timer) return
    const elapsed = Math.floor((Date.now() - timer.startedAt) / 1000)
    set((s) => ({ activeTimers: s.activeTimers.filter((t) => t.taskId !== taskId) }))
    get().addTimeSpent(taskId, elapsed)
  }
})
