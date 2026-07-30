import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { StickyNote } from '../../types'

export interface NotesSlice {
  notes: StickyNote[]
  createNote: (
    projectId: string,
    data?: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'type'>>
  ) => string
  updateNote: (id: string, updates: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'taskId' | 'taskIds' | 'connections' | 'goalIds' | 'fontSize' | 'completedAt'>>) => void
  deleteNote: (id: string) => void
  connectNotes: (fromId: string, toId: string) => void
  disconnectNotes: (fromId: string, toId: string) => void
}

export const createNotesSlice: StateCreator<
  NotesSlice & { _persist: () => void },
  [],
  [],
  NotesSlice
> = (set, get) => ({
  notes: [],

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
  }
})
