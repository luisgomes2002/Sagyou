import type { IStorageAdapter } from './StorageAdapter'
import type { Project, Task, Sprint, Tombstone, Backup, AIJson, StickyNote, Goal, Habit, FinancialTable, StoredFile, AIConversation, AiMemory } from '../types'

export class ElectronStorage implements IStorageAdapter {
  async load() {
    const data = await window.electronAPI.store.load() as Record<string, unknown>
    return {
      projects: (data.projects || []) as Project[],
      tasks: (data.tasks || []) as Task[],
      sprints: (data.sprints || []) as Sprint[],
      tombstones: (data.tombstones || []) as Tombstone[],
      notes: (data.notes || []) as StickyNote[],
      goals: (data.goals || []) as Goal[],
      habits: (data.habits || []) as Habit[],
      lists: (data.lists || []) as FinancialTable[],
      activeTimers: (data.activeTimers ?? undefined) as { taskId: string; startedAt: number }[] | undefined,
      // Legacy single-timer field, migrated to the array by the store's loader.
      activeTimer: (data.activeTimer ?? null) as { taskId: string; startedAt: number } | null,
      files: (data.files || []) as StoredFile[]
    }
  }

  async save(data: Parameters<IStorageAdapter['save']>[0]): Promise<void> {
    await window.electronAPI.store.save(data)
  }

  async exportBackup(backup: Backup): Promise<{ success: boolean; cancelled?: boolean }> {
    return window.electronAPI.backup.export(backup)
  }

  async importBackup(): Promise<{
    success: boolean
    cancelled?: boolean
    data?: Backup
    error?: string
  }> {
    const result = await window.electronAPI.backup.import()
    return result as { success: boolean; cancelled?: boolean; data?: Backup; error?: string }
  }

  async importAIJson(): Promise<{
    success: boolean
    cancelled?: boolean
    data?: AIJson
    error?: string
  }> {
    const result = await window.electronAPI.ai.import()
    return result as { success: boolean; cancelled?: boolean; data?: AIJson; error?: string }
  }

  async loadConversations(): Promise<AIConversation[]> {
    return window.electronAPI.ai.conversations.all()
  }

  async saveConversations(list: AIConversation[]): Promise<void> {
    await window.electronAPI.ai.conversations.replace(list)
  }

  async loadMemories(): Promise<AiMemory[]> {
    // Everything, archived included — a backup must round-trip the full store.
    return window.electronAPI.ai.memory.list({ includeArchived: true })
  }

  async replaceMemories(list: AiMemory[]): Promise<void> {
    await window.electronAPI.ai.memory.replace(list)
  }
}
