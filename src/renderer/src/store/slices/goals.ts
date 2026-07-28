import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Goal, GoalEntry } from '../../types'

export interface GoalsSlice {
  goals: Goal[]
  createGoal: (data: Pick<Goal, 'title' | 'target' | 'unit' | 'color'> & { projectId?: string }) => string
  updateGoal: (id: string, updates: Partial<Pick<Goal, 'title' | 'target' | 'unit' | 'color' | 'projectId'>>) => void
  deleteGoal: (id: string) => void
  addGoalEntry: (goalId: string, data: Pick<GoalEntry, 'date' | 'value'> & { label?: string }) => void
  deleteGoalEntry: (goalId: string, entryId: string) => void
}

export const createGoalsSlice: StateCreator<
  GoalsSlice & { _persist: () => void },
  [],
  [],
  GoalsSlice
> = (set, get) => ({
  goals: [],

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
  }
})
