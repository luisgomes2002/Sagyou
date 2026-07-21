import type { IStorageAdapter } from './StorageAdapter'
import type { Project, Task, Sprint, Tombstone, Backup, AIJson, StickyNote, Goal, Habit, FinancialTable, StoredFile, AIConversation, AiMemory } from '../types'

const STORAGE_KEY = 'kanban-data'
const CONVERSATIONS_KEY = 'ai-conversations'
const MEMORIES_KEY = 'ai-memories'

// Web implementation — swap ElectronStorage for this when migrating to browser
export class WebStorage implements IStorageAdapter {
  async load(): Promise<{ projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[]; notes: StickyNote[]; goals: Goal[]; habits: Habit[]; lists: FinancialTable[]; files: StoredFile[] }> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [], files: [] }
      const parsed = JSON.parse(raw)
      return {
        projects: parsed.projects || [],
        tasks: parsed.tasks || [],
        sprints: parsed.sprints || [],
        tombstones: parsed.tombstones || [],
        notes: parsed.notes || [],
        goals: parsed.goals || [],
        habits: parsed.habits || [],
        lists: parsed.lists || [],
        files: parsed.files || []
      }
    } catch {
      return { projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [], files: [] }
    }
  }

  async save(data: { projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[]; notes: StickyNote[]; goals: Goal[]; habits: Habit[]; lists: FinancialTable[]; files: StoredFile[] }): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  async exportBackup(backup: Backup): Promise<{ success: boolean; cancelled?: boolean }> {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kanban-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    return { success: true }
  }

  async importBackup(): Promise<{
    success: boolean
    cancelled?: boolean
    data?: Backup
    error?: string
  }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return resolve({ success: false, cancelled: true })
        const text = await file.text()
        try {
          resolve({ success: true, data: JSON.parse(text) as Backup })
        } catch {
          resolve({ success: false, error: 'Arquivo inválido' })
        }
      }
      input.oncancel = () => resolve({ success: false, cancelled: true })
      input.click()
    })
  }

  async importAIJson(): Promise<{
    success: boolean
    cancelled?: boolean
    data?: AIJson
    error?: string
  }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return resolve({ success: false, cancelled: true })
        const text = await file.text()
        try {
          resolve({ success: true, data: JSON.parse(text) as AIJson })
        } catch {
          resolve({ success: false, error: 'Arquivo inválido' })
        }
      }
      input.oncancel = () => resolve({ success: false, cancelled: true })
      input.click()
    })
  }

  async loadConversations(): Promise<AIConversation[]> {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async saveConversations(list: AIConversation[]): Promise<void> {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list))
  }

  async loadMemories(): Promise<AiMemory[]> {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEMORIES_KEY) || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async replaceMemories(list: AiMemory[]): Promise<void> {
    localStorage.setItem(MEMORIES_KEY, JSON.stringify(list))
  }
}
