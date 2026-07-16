import type { Project, Task, Sprint, Tombstone, Backup, AIJson, StickyNote, Goal, Habit, FinancialTable, StoredFile, AIConversation } from '../types'

type SaveData = {
  projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[]
  notes: StickyNote[]; goals: Goal[]; habits: Habit[]; lists: FinancialTable[]
  files: StoredFile[]
  activeTimer?: { taskId: string; startedAt: number } | null
}

export interface IStorageAdapter {
  load(): Promise<SaveData>
  save(data: SaveData): Promise<void>
  exportBackup(backup: Backup): Promise<{ success: boolean; cancelled?: boolean }>
  importBackup(): Promise<{ success: boolean; cancelled?: boolean; data?: Backup; error?: string }>
  importAIJson(): Promise<{ success: boolean; cancelled?: boolean; data?: AIJson; error?: string }>
  // AI chat history lives outside the main store (its own file in userData),
  // so backup export/import reaches it through these.
  loadConversations(): Promise<AIConversation[]>
  saveConversations(list: AIConversation[]): Promise<void>
}
