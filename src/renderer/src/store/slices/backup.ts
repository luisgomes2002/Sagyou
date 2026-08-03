import type { StateCreator } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Backup,
  AIJson,
  Project,
  Task,
  TaskImage,
  Sprint,
  Tombstone,
  StickyNote,
  Goal,
  Habit,
  FinancialTable,
  FinancialTransactionDetail,
  StoredFile,
  TimeBlock,
  Routine,
  AIConversation,
  AiMemory,
  Priority,
  ActiveTimer,
  Currency
} from '../../types'
import { D, moneyStr } from '../../utils/money'

interface StorageDep {
  exportBackup: (backup: Backup) => Promise<{ success: boolean }>
  importBackup: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown }>
  importAIJson: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown }>
  loadConversations: () => Promise<AIConversation[]>
  saveConversations: (list: AIConversation[]) => Promise<void>
  loadMemories: () => Promise<AiMemory[]>
  replaceMemories: (list: AiMemory[]) => Promise<void>
}

// --- Code path selection -----------------------------------------------------
// `activeCodePathIds` is the source of truth; the legacy singular
// `activeCodePathId` is kept in sync with its first entry so older app versions
// and old backups keep reading the selection. Always go through these two.

/** The selected code path ids, migrating legacy single-selection data. */
function activeIds(p: Project): string[] {
  if (Array.isArray(p.activeCodePathIds)) return p.activeCodePathIds
  return p.activeCodePathId ? [p.activeCodePathId] : []
}

/** Both selection fields for a spread, kept consistent. */
function withActive(ids: string[]): Pick<Project, 'activeCodePathIds' | 'activeCodePathId'> {
  return { activeCodePathIds: ids, activeCodePathId: ids[0] }
}

// Normalize a persisted project: migrate the code path selection to the array
// form and drop ids whose path no longer exists (a stale id would silently
// select nothing).
function normalizeProject(p: Project, i: number): Project {
  const known = new Set((p.codePaths ?? []).map((c) => c.id))
  const ids = activeIds(p).filter((id) => known.has(id))
  return { ...p, order: p.order ?? i, ...withActive(ids) }
}

// Normalize a persisted financial table: fill missing arrays, default currency,
// and migrate monetary fields (amount, price, targetAmount) from number → string.
// Keep in sync with the identical normalizeList in src/renderer/src/store/kanban.ts.
function normalizeList(l: FinancialTable): FinancialTable {
  return {
    ...l,
    currency: (l.currency || 'BRL') as Currency,
    items: (l.items ?? []).map((i) => ({
      ...i,
      price: i.price === null || i.price === undefined ? undefined : moneyStr(i.price)
    })),
    transactions: (l.transactions ?? []).map((t) => {
      const amount = moneyStr(t.amount)
      return { ...t, amount, details: normalizeTransactionDetails(t.details, amount) }
    }),
    actualBalance: l.actualBalance == null ? undefined : moneyStr(l.actualBalance),
    budgets: (l.budgets ?? []).map((b) => ({ ...b, limit: moneyStr(b.limit) })),
    recurringTransactions: (l.recurringTransactions ?? []).map((r) => ({
      ...r,
      amount: moneyStr(r.amount)
    })),
    goals: (l.goals ?? []).map((g) => ({ ...g, targetAmount: moneyStr(g.targetAmount) })),
    yieldSources: (l.yieldSources ?? []).map((s) => ({ ...s })),
    yieldEntries: (l.yieldEntries ?? []).map((e) => ({ ...e, amount: moneyStr(e.amount) }))
  }
}

function normalizeTransactionDetails(value: unknown, total: string): FinancialTransactionDetail[] {
  if (!Array.isArray(value)) return []
  let remaining = D(total)
  const details: FinancialTransactionDetail[] = []
  for (const detail of value) {
    if (!detail || typeof detail !== 'object' || remaining.lessThanOrEqualTo(0)) continue
    const item = detail as Partial<FinancialTransactionDetail>
    if (typeof item.id !== 'string' || typeof item.description !== 'string') continue
    const requested = D(item.amount)
    if (requested.lessThanOrEqualTo(0)) continue
    const amount = requested.lessThan(remaining) ? requested : remaining
    details.push({
      id: item.id,
      description: item.description,
      amount: amount.toString(),
      ...(typeof item.category === 'string' && item.category.trim()
        ? { category: item.category.trim() }
        : {}),
      ...(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? { date: item.date }
        : {})
    })
    remaining = remaining.minus(amount)
  }
  return details
}

export interface BackupSlice {
  exportBackup: () => Promise<boolean>
  importBackup: () => Promise<boolean>
  importAIJson: (projectId: string) => Promise<number>
  importTasksFromAIChat: (projectId: string, tasks: AIJson['tasks']) => number
}

export function createBackupSlice(storage: StorageDep): StateCreator<
  BackupSlice & {
    _persist: () => void
    _flushPersist: () => Promise<void>
    projects: Project[]
    tasks: Task[]
    sprints: Sprint[]
    tombstones: Tombstone[]
    notes: StickyNote[]
    goals: Goal[]
    habits: Habit[]
    lists: FinancialTable[]
    files: StoredFile[]
    timeBlocks: TimeBlock[]
    routines: Routine[]
    activeTimers: ActiveTimer[]
    activeProjectId: string | null
  },
  [],
  [],
  BackupSlice
> {
  return (set, get) => ({
    exportBackup: async () => {
      const { projects, tasks, sprints, tombstones, notes, goals, habits, lists } = get()
      // Chat history isn't part of the store — read it straight from storage.
      // A failure here shouldn't cost the user the rest of the backup.
      let conversations: AIConversation[] = []
      try {
        conversations = await storage.loadConversations()
      } catch {
        conversations = []
      }
      // AI memory rides along like chat history — same store-external treatment,
      // same "a failure here shouldn't cost the rest of the backup" guard.
      let memories: AiMemory[] = []
      try {
        memories = await storage.loadMemories()
      } catch {
        memories = []
      }
      const backup: Backup = {
        version: 6,
        exportedAt: new Date().toISOString(),
        projects,
        tasks,
        sprints,
        tombstones,
        notes,
        goals,
        habits,
        lists,
        conversations,
        memories,
        // Attachment metadata (new in v5). The physical bytes (fileBlobs) and the
        // chat images are attached by the main process at write time — see the
        // backup:export handler; keeping them out of the renderer avoids shipping
        // megabytes of base64 over IPC.
        files: get().files,
        timeBlocks: get().timeBlocks,
        routines: get().routines
      }
      const result = await storage.exportBackup(backup)
      return result.success
    },

    importBackup: async () => {
      const result = await storage.importBackup()
      if (!result.success || result.cancelled || !result.data) return false

      const backup = result.data as Backup

      const tombstones: Tombstone[] = backup.tombstones || []
      const tombstoneIds = new Set(tombstones.map((t) => t.id))

      const projects = (backup.projects || [])
        .filter((p: Project) => !tombstoneIds.has(p.id))
        .map(normalizeProject)
      // Legacy task images carried their bytes inline (`dataUrl`); a v5+ backup has
      // them as metadata with the bytes already written to disk by backup:import.
      // Convert any inline image to a disk file so the store only ever holds metadata.
      const tasks: Task[] = await Promise.all(
        (backup.tasks || [])
          .filter((t: Task) => !tombstoneIds.has(t.id))
          .map(async (t: Task) => {
            if (!t.images?.some((img) => img.dataUrl)) return t
            const images: TaskImage[] = []
            for (const img of t.images) {
              if (img.dataUrl) {
                const res = await window.electronAPI.taskImages.save(img.dataUrl)
                if ('error' in res) continue // undecodable → drop it, no dangling ref
                images.push({
                  id: res.id,
                  name: img.name,
                  ext: res.ext,
                  size: res.size,
                  addedAt: img.addedAt
                })
              } else {
                images.push(img)
              }
            }
            return { ...t, images }
          })
      )
      const sprints: Sprint[] = backup.sprints || []
      const notes: StickyNote[] = backup.notes || []
      const goals: Goal[] = backup.goals || []

      const localHabits = get().habits
      const habits: Habit[] = (backup.habits || []).map((h: Habit) => {
        const local = localHabits.find((lh) => lh.id === h.id)
        if (!local) return h
        return { ...h, completions: [...new Set([...local.completions, ...h.completions])] }
      })

      const lists: FinancialTable[] = (backup.lists || []).map(normalizeList)

      const activeProjectId = projects[0]?.id ?? null

      // v5+ carries attachment metadata (and the main process has already written
      // the blobs to disk during backup:import). A pre-v5 backup has no `files`
      // key — leave the local attachments untouched rather than wiping them.
      const files: StoredFile[] = Array.isArray(backup.files) ? backup.files : get().files
      const timeBlocks: TimeBlock[] = Array.isArray(backup.timeBlocks)
        ? backup.timeBlocks
        : get().timeBlocks
      const routines: Routine[] = Array.isArray(backup.routines) ? backup.routines : get().routines
      set({
        projects,
        tasks,
        sprints,
        tombstones,
        notes,
        goals,
        habits,
        lists,
        files,
        timeBlocks,
        routines,
        activeProjectId,
        activeTimers: []
      })
      await get()._flushPersist()

      // Only touch the chat history when the backup actually carries it: a v2
      // file has no `conversations` key and must leave local history alone.
      if (Array.isArray(backup.conversations)) {
        try {
          await storage.saveConversations(backup.conversations)
        } catch {
          // History is secondary — a failure here doesn't undo the import above.
        }
      }
      // Same rule for memory (v4+): absent key = leave local memory untouched.
      // Written after the store flush above, so projects exist when a memory's
      // FK is checked (see replaceMemories).
      if (Array.isArray(backup.memories)) {
        try {
          await storage.replaceMemories(backup.memories)
        } catch {
          // Memory is secondary — a failure here doesn't undo the import above.
        }
      }
      return true
    },

    importAIJson: async (projectId) => {
      const result = await storage.importAIJson()
      if (!result.success || result.cancelled || !result.data) return 0

      const aiJson = result.data as AIJson
      if (!Array.isArray(aiJson.tasks) || aiJson.tasks.length === 0) return 0

      return get().importTasksFromAIChat(projectId, aiJson.tasks)
    },

    // Create tasks directly from an AI-produced task list (no file dialog).
    // Shares the column/sprint-matching logic used by importAIJson.
    importTasksFromAIChat: (projectId, inputs) => {
      if (!Array.isArray(inputs) || inputs.length === 0) return 0

      const { projects, tasks, sprints } = get()
      const project = projects.find((p) => p.id === projectId)
      if (!project) return 0

      const now = new Date().toISOString()
      const columnTaskCounts: Record<string, number> = {}
      for (const t of tasks.filter((t) => t.projectId === projectId)) {
        columnTaskCounts[t.columnId] = (columnTaskCounts[t.columnId] ?? 0) + 1
      }

      const projectSprints = sprints.filter((s) => s.projectId === projectId)

      const newTasks: Task[] = inputs.map((input) => {
        const col =
          project.columns.find(
            (c) => c.name.toLowerCase() === (input.column ?? '').toLowerCase()
          ) ?? project.columns[0]
        const order = columnTaskCounts[col.id] ?? 0
        columnTaskCounts[col.id] = order + 1

        const matchedSprint = input.sprint
          ? projectSprints.find((s) => s.name.toLowerCase() === input.sprint!.toLowerCase())
          : undefined

        return {
          id: uuidv4(),
          projectId,
          columnId: col.id,
          title: input.title,
          description: input.description,
          priority: (input.priority as Priority) ?? 'medium',
          dueDate: input.dueDate,
          tags: input.tags ?? [],
          sprintId: matchedSprint?.id,
          order,
          createdAt: now,
          updatedAt: now
        }
      })

      set((s) => ({ tasks: [...s.tasks, ...newTasks] }))
      get()._persist()
      return newTasks.length
    }
  })
}
