import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Habit } from '../../types'

export interface HabitsSlice {
  habits: Habit[]
  createHabit: (data: Pick<Habit, 'name' | 'color'>) => string
  updateHabit: (id: string, updates: Partial<Pick<Habit, 'name' | 'color'>>) => void
  deleteHabit: (id: string) => void
  toggleHabit: (id: string, isoDate: string) => void
}

export const createHabitsSlice: StateCreator<
  HabitsSlice & { _persist: () => void },
  [],
  [],
  HabitsSlice
> = (set, get) => ({
  habits: [],

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
  }
})
