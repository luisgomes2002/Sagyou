import type { Project, Task, Sprint, Tombstone, Backup, AIJson } from '../types'

export interface IStorageAdapter {
  load(): Promise<{ projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[] }>
  save(data: { projects: Project[]; tasks: Task[]; sprints: Sprint[]; tombstones: Tombstone[] }): Promise<void>
  exportBackup(backup: Backup): Promise<{ success: boolean; cancelled?: boolean }>
  importBackup(): Promise<{ success: boolean; cancelled?: boolean; data?: Backup; error?: string }>
  importAIJson(): Promise<{ success: boolean; cancelled?: boolean; data?: AIJson; error?: string }>
}
