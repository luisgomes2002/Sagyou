import type { Project, Task, Sprint, Tombstone, Backup, AIJson, StickyNote, Goal, Habit, FinancialTable, StoredFile, AIConversation, AiMemory, TimeBlock, Routine } from '../types'

type SaveData = {
  projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[]
  notes: StickyNote[]; goals: Goal[]; habits: Habit[]; lists: FinancialTable[]
  files: StoredFile[]
  timeBlocks?: TimeBlock[]
  routines?: Routine[]
  activeTimers?: { taskId: string; startedAt: number }[]
  // Legacy single-timer mirror (activeTimers[0]); kept so an older app version
  // reading the same DB still resolves one running timer.
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
  // AI memory lives in the DB but outside the Zustand store, so backup
  // export/import reaches it through these (like conversations above).
  loadMemories(): Promise<AiMemory[]>
  replaceMemories(list: AiMemory[]): Promise<void>
}
