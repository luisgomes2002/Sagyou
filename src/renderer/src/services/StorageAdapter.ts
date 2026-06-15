import type { Project, Task, Sprint, Tombstone, Backup, AIJson, StickyNote, Goal, Habit, FinancialTable } from '../types'

type SaveData = {
  projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[]
  notes: StickyNote[]; goals: Goal[]; habits: Habit[]; lists: FinancialTable[]
  activeTimer?: { taskId: string; startedAt: number } | null
}

export interface IStorageAdapter {
  load(): Promise<SaveData>
  save(data: SaveData): Promise<void>
  exportBackup(backup: Backup): Promise<{ success: boolean; cancelled?: boolean }>
  importBackup(): Promise<{ success: boolean; cancelled?: boolean; data?: Backup; error?: string }>
  importAIJson(): Promise<{ success: boolean; cancelled?: boolean; data?: AIJson; error?: string }>
}
