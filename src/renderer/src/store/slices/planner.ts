import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { TimeBlock, Routine } from '../../types'

export interface PlannerSlice {
  timeBlocks: TimeBlock[]
  routines: Routine[]
  createTimeBlock: (data: Omit<TimeBlock, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateTimeBlock: (id: string, updates: Partial<Pick<TimeBlock, 'title' | 'description' | 'startTime' | 'endTime' | 'taskId' | 'habitId' | 'color' | 'order'>>) => void
  deleteTimeBlock: (id: string) => void
  setTimeBlocks: (blocks: TimeBlock[]) => void
  createRoutine: (data: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateRoutine: (id: string, updates: Partial<Pick<Routine, 'title' | 'description' | 'startTime' | 'endTime' | 'daysOfWeek' | 'color' | 'active'>>) => void
  deleteRoutine: (id: string) => void
}

export const createPlannerSlice: StateCreator<
  PlannerSlice & { _persist: () => void },
  [],
  [],
  PlannerSlice
> = (set, get) => ({
  timeBlocks: [],
  routines: [],

  createTimeBlock: (data) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const block: TimeBlock = { ...data, id, createdAt: now, updatedAt: now }
    set((s) => ({ timeBlocks: [...s.timeBlocks, block] }))
    get()._persist()
    return id
  },

  updateTimeBlock: (id, updates) => {
    const now = new Date().toISOString()
    set((s) => ({
      timeBlocks: s.timeBlocks.map((tb) =>
        tb.id === id ? { ...tb, ...updates, updatedAt: now } : tb
      )
    }))
    get()._persist()
  },

  deleteTimeBlock: (id) => {
    set((s) => ({ timeBlocks: s.timeBlocks.filter((tb) => tb.id !== id) }))
    get()._persist()
  },

  setTimeBlocks: (blocks) => {
    set({ timeBlocks: blocks })
    get()._persist()
  },

  createRoutine: (data) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const routine: Routine = { ...data, id, createdAt: now, updatedAt: now }
    set((s) => ({ routines: [...s.routines, routine] }))
    get()._persist()
    return id
  },

  updateRoutine: (id, updates) => {
    const now = new Date().toISOString()
    set((s) => ({
      routines: s.routines.map((r) =>
        r.id === id ? { ...r, ...updates, updatedAt: now } : r
      )
    }))
    get()._persist()
  },

  deleteRoutine: (id) => {
    set((s) => ({ routines: s.routines.filter((r) => r.id !== id) }))
    get()._persist()
  }
})
