import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Project, Column, Tombstone } from '../../types'
import { DEFAULT_COLUMN_NAMES } from '../../types'

function activeIds(p: Project): string[] {
  if (Array.isArray(p.activeCodePathIds)) return p.activeCodePathIds
  return p.activeCodePathId ? [p.activeCodePathId] : []
}

function withActive(ids: string[]): Pick<Project, 'activeCodePathIds' | 'activeCodePathId'> {
  return { activeCodePathIds: ids, activeCodePathId: ids[0] }
}

export interface ProjectsSlice {
  projects: Project[]
  activeProjectId: string | null
  setActiveProject: (id: string | null) => void
  createProject: (name: string, description?: string, color?: string) => string
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'links' | 'archivedAt'>>) => void
  moveProject: (id: string, direction: 'up' | 'down') => void
  deleteProject: (id: string) => void
  archiveProject: (id: string) => void
  unarchiveProject: (id: string) => void
  addCodePath: (projectId: string, path: string, label?: string) => string
  removeCodePath: (projectId: string, codePathId: string) => void
  setActiveCodePath: (projectId: string, codePathId: string | null) => void
  toggleCodePath: (projectId: string, codePathId: string) => void
  createColumn: (projectId: string, name: string, color?: string) => void
  updateColumn: (projectId: string, columnId: string, updates: Partial<Pick<Column, 'name' | 'color'>>) => void
  deleteColumn: (projectId: string, columnId: string) => void
  reorderColumns: (projectId: string, orderedIds: string[]) => void
}

export const createProjectsSlice: StateCreator<
  ProjectsSlice & {
    _persist: () => void
    _flushPersist: () => Promise<void>
    tasks: { id: string; projectId: string; columnId: string; completedAt?: string; images?: { id: string; ext: string }[] }[]
    tombstones: Tombstone[]
  },
  [],
  [],
  ProjectsSlice
> = (set, get) => ({
  projects: [],
  activeProjectId: null,

  setActiveProject: (id) => set({ activeProjectId: id }),

  createProject: (name, description, color = '#7c3aed') => {
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

  archiveProject: (id) => {
    const now = new Date().toISOString()
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, archivedAt: now, updatedAt: now } : p
      ),
      activeProjectId: s.activeProjectId === id
        ? (s.projects.find((p) => p.id !== id && !p.archivedAt)?.id ?? null)
        : s.activeProjectId
    }))
    get()._persist()
  },

  unarchiveProject: (id) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, archivedAt: undefined, updatedAt: new Date().toISOString() } : p
      )
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
  }
})
