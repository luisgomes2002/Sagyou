import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Project, Task, Column, Sprint, Tombstone, Backup, AIJson, Priority, TaskImage } from '../types'
import { DEFAULT_COLUMN_NAMES } from '../types'
import { ElectronStorage } from '../services/ElectronStorage'

const storage = new ElectronStorage()

interface KanbanState {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  tombstones: Tombstone[]
  activeProjectId: string | null
  sprintFilter: string | null
  isLoaded: boolean
}

interface KanbanActions {
  loadData: () => Promise<void>
  _persist: () => Promise<void>

  setActiveProject: (id: string | null) => void
  setSprintFilter: (sprintId: string | null) => void

  createProject: (name: string, description?: string, color?: string) => string
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color'>>) => void
  deleteProject: (id: string) => void

  createColumn: (projectId: string, name: string, color?: string) => void
  updateColumn: (projectId: string, columnId: string, updates: Partial<Pick<Column, 'name' | 'color'>>) => void
  deleteColumn: (projectId: string, columnId: string) => void
  reorderColumns: (projectId: string, orderedIds: string[]) => void

  createTask: (
    data: Pick<Task, 'projectId' | 'columnId' | 'title'> &
      Partial<Pick<Task, 'description' | 'priority' | 'dueDate' | 'tags' | 'sprintId' | 'images'>>
  ) => void
  updateTask: (
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'dueDate' | 'tags' | 'columnId' | 'sprintId' | 'images'>>
  ) => void
  deleteTask: (id: string) => void
  moveTask: (taskId: string, newColumnId: string, newIndex: number) => void

  createSprint: (projectId: string, name: string) => string
  createSprints: (projectId: string, names: string[]) => void
  closeSprint: (sprintId: string) => void
  deleteSprint: (sprintId: string) => void
  setTaskSprint: (taskId: string, sprintId: string | null) => void

  exportBackup: () => Promise<boolean>
  importBackup: () => Promise<boolean>
  importAIJson: (projectId: string) => Promise<number>
}

export type KanbanStore = KanbanState & KanbanActions

// ── Merge helpers ─────────────────────────────────────────────────────────────

function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>()
  for (const t of [...a, ...b]) {
    const ex = map.get(t.id)
    if (!ex || t.deletedAt > ex.deletedAt) map.set(t.id, t)
  }
  return Array.from(map.values())
}

function isDeleted(tombstones: Map<string, Tombstone>, id: string, updatedAt: string): boolean {
  const t = tombstones.get(id)
  return !!t && t.deletedAt > updatedAt
}

function mergeEntities<T extends { id: string; updatedAt: string }>(
  local: T[],
  remote: T[],
  tombstones: Map<string, Tombstone>
): T[] {
  const map = new Map<string, T>()
  for (const item of local) {
    if (!isDeleted(tombstones, item.id, item.updatedAt)) map.set(item.id, item)
  }
  for (const item of remote) {
    if (isDeleted(tombstones, item.id, item.updatedAt)) continue
    const ex = map.get(item.id)
    if (!ex || item.updatedAt > ex.updatedAt) map.set(item.id, item)
  }
  return Array.from(map.values())
}

// Sprints don't have updatedAt — use createdAt as fallback
function mergeSprints(local: Sprint[], remote: Sprint[], tombstones: Map<string, Tombstone>): Sprint[] {
  const toEntity = (s: Sprint) => ({ ...s, updatedAt: s.closedAt ?? s.createdAt })
  const merged = mergeEntities(local.map(toEntity), remote.map(toEntity), tombstones)
  return merged.map(({ updatedAt: _u, ...s }) => s as Sprint)
}

// ──────────────────────────────────────────────────────────────────────────────

export const useKanbanStore = create<KanbanStore>((set, get) => ({
  projects: [],
  tasks: [],
  sprints: [],
  tombstones: [],
  activeProjectId: null,
  sprintFilter: null,
  isLoaded: false,

  _persist: async () => {
    const { projects, tasks, sprints, tombstones } = get()
    await storage.save({ projects, tasks, sprints, tombstones })
  },

  loadData: async () => {
    const data = await storage.load()
    const projects = data.projects || []
    set({
      projects,
      tasks: data.tasks || [],
      sprints: data.sprints || [],
      tombstones: data.tombstones || [],
      isLoaded: true,
      activeProjectId: projects[0]?.id ?? null
    })
  },

  setActiveProject: (id) => set({ activeProjectId: id }),
  setSprintFilter: (sprintId) => set({ sprintFilter: sprintId }),

  createProject: (name, description, color = '#6366f1') => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const columns: Column[] = DEFAULT_COLUMN_NAMES.map((colName, i) => ({
      id: uuidv4(), name: colName, order: i
    }))
    const project: Project = { id, name, description, color, columns, createdAt: now, updatedAt: now }
    set((s) => ({ projects: [...s.projects, project], activeProjectId: id }))
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
  },

  updateTask: (id, updates) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
      )
    }))
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
      const otherTasks = s.tasks.filter((t) => t.id !== taskId)
      const columnTasks = otherTasks
        .filter((t) => t.columnId === newColumnId && t.projectId === task.projectId)
        .sort((a, b) => a.order - b.order)
      const updatedTask: Task = { ...task, columnId: newColumnId, updatedAt: new Date().toISOString() }
      columnTasks.splice(newIndex, 0, updatedTask)
      const reordered = columnTasks.map((t, i) => ({ ...t, order: i }))
      const untouched = otherTasks.filter(
        (t) => !(t.columnId === newColumnId && t.projectId === task.projectId)
      )
      return { tasks: [...untouched, ...reordered] }
    })
    get()._persist()
  },

  createSprint: (projectId, name) => {
    const id = uuidv4()
    const sprint: Sprint = { id, projectId, name, createdAt: new Date().toISOString() }
    set((s) => ({ sprints: [...s.sprints, sprint] }))
    get()._persist()
    return id
  },

  createSprints: (projectId, names) => {
    const now = new Date().toISOString()
    const newSprints: Sprint[] = names
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ id: uuidv4(), projectId, name, createdAt: now }))
    set((s) => ({ sprints: [...s.sprints, ...newSprints] }))
    get()._persist()
  },

  closeSprint: (sprintId) => {
    set((s) => ({
      sprints: s.sprints.map((sp) =>
        sp.id === sprintId ? { ...sp, closedAt: new Date().toISOString() } : sp
      )
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

  exportBackup: async () => {
    const { projects, tasks, sprints, tombstones } = get()
    const backup: Backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects,
      tasks,
      sprints,
      tombstones
    }
    const result = await storage.exportBackup(backup)
    return result.success
  },

  importBackup: async () => {
    const result = await storage.importBackup()
    if (!result.success || result.cancelled || !result.data) return false

    const backup = result.data as Backup
    const local = get()

    // Merge tombstones first
    const mergedTombstones = mergeTombstones(
      local.tombstones,
      backup.tombstones || []
    )
    const tombstoneMap = new Map(mergedTombstones.map((t) => [t.id, t]))

    // Merge each entity type
    const projects = mergeEntities(local.projects, backup.projects || [], tombstoneMap)
    const tasks = mergeEntities(local.tasks, backup.tasks || [], tombstoneMap)
    const sprints = mergeSprints(local.sprints, backup.sprints || [], tombstoneMap)

    const activeProjectId = projects.find((p) => p.id === local.activeProjectId)
      ? local.activeProjectId
      : (projects[0]?.id ?? null)

    set({ projects, tasks, sprints, tombstones: mergedTombstones, activeProjectId })
    await get()._persist()
    return true
  },

  importAIJson: async (projectId) => {
    const result = await storage.importAIJson()
    if (!result.success || result.cancelled || !result.data) return 0

    const aiJson = result.data as AIJson
    if (!Array.isArray(aiJson.tasks) || aiJson.tasks.length === 0) return 0

    const { projects, tasks } = get()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return 0

    const now = new Date().toISOString()
    const columnTaskCounts: Record<string, number> = {}
    for (const t of tasks.filter((t) => t.projectId === projectId)) {
      columnTaskCounts[t.columnId] = (columnTaskCounts[t.columnId] ?? 0) + 1
    }

    const { sprints } = get()
    const projectSprints = sprints.filter((s) => s.projectId === projectId)

    const newTasks: Task[] = aiJson.tasks.map((input) => {
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
    await get()._persist()
    return newTasks.length
  }
}))
