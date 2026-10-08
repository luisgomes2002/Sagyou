import type { IpcMain } from 'electron'
import type { MemoryInput } from '../memory'

interface MemoryHandlerDeps {
  store: Pick<
    typeof import('../store'),
    | 'archiveMemories'
    | 'deleteMemory'
    | 'getMemory'
    | 'listMemories'
    | 'memoriesForContext'
    | 'replaceMemories'
    | 'searchMemories'
    | 'touchMemories'
    | 'upsertMemory'
  >
  memory: Pick<
    typeof import('../memory'),
    | 'buildMemory'
    | 'findConflicts'
    | 'formatMemoriesForPrompt'
    | 'handoffId'
    | 'MEMORY_TYPES'
    | 'selectStale'
    | 'summarizeMemories'
  >
  newId: () => string
}

export function registerMemoryHandlers(ipcMain: IpcMain, deps: MemoryHandlerDeps): void {
  // Shared lazy decay pass for the explicit prune call and run-start briefing.
  // Global, since a cold page is cold regardless of the current project.
  function runMemoryPrune(): number {
    const now = Date.now()
    const stale = deps.memory.selectStale(deps.store.listMemories({ includeArchived: false }), now)
    deps.store.archiveMemories(stale, new Date(now).toISOString())
    return stale.length
  }

  // --- AI memory (durable facts across conversations; kanban.db, outside
  // persistAll — see store.ts). save scrubs secrets in buildMemory; prune
  // archives cold pages (never hard-deletes); delete is the explicit user act.
  ipcMain.handle(
    'ai:memory:list',
    (_, opts?: { projectId?: string | null; includeArchived?: boolean }) => {
      if (opts?.includeArchived)
        return deps.store.listMemories({ projectId: opts.projectId, includeArchived: true })
      if (opts && 'projectId' in opts) return deps.store.memoriesForContext(opts.projectId ?? null)
      return deps.store.listMemories()
    }
  )

  ipcMain.handle('ai:memory:save', (_, input: MemoryInput & { id?: string }) => {
    const existing = input.id ? deps.store.getMemory(input.id) : null
    const res = deps.memory.buildMemory(existing, input, deps.newId(), new Date().toISOString())
    if ('error' in res) return res
    deps.store.upsertMemory(res.memory)
    return { memory: res.memory, redacted: res.redacted }
  })

  // Ranked, bounded recall stays in main so the renderer never pulls the full
  // corpus into a prompt just to find one relevant page.
  ipcMain.handle(
    'ai:memory:search',
    (
      _,
      opts: {
        projectId?: string | null
        term?: string
        type?: string
        includeArchived?: boolean
        limit?: number
      }
    ) => {
      const type = deps.memory.MEMORY_TYPES.find((item) => item === opts?.type)
      return deps.store.searchMemories({
        projectId: opts?.projectId ?? null,
        term: opts?.term,
        type,
        includeArchived: opts?.includeArchived === true,
        limit: opts?.limit
      })
    }
  )

  ipcMain.handle('ai:memory:delete', (_, id: string) => deps.store.deleteMemory(id))

  // Wholesale replace from a backup import (projects are imported first, so FK
  // scoping holds; see replaceMemories).
  ipcMain.handle('ai:memory:replace', (_, list: unknown) =>
    deps.store.replaceMemories(Array.isArray(list) ? list : [])
  )

  ipcMain.handle('ai:memory:touch', (_, ids: string[]) =>
    deps.store.touchMemories(Array.isArray(ids) ? ids : [], new Date().toISOString())
  )

  // Lazy decay pass: archive stale/overflowing pages, return how many.
  ipcMain.handle('ai:memory:prune', () => ({ archived: runMemoryPrune() }))

  // Automatic per-run handoff: one memory per project (deterministic id), upserted
  // at each run's end so a later session opens knowing where this one left off.
  // Writing it keeps it warm — lastAccessedAt = now, but access_count is NOT
  // bumped, so its TTL stays at the base and it decays ~45d after the last run on
  // this project (i.e. when the project goes quiet), instead of ballooning.
  ipcMain.handle(
    'ai:memory:handoff',
    (
      _,
      input: {
        projectId?: string | null
        title: string
        body: string
        sourceConversationId?: string | null
      }
    ) => {
      const projectId = typeof input?.projectId === 'string' ? input.projectId : null
      const id = deps.memory.handoffId(projectId)
      const now = new Date().toISOString()
      const res = deps.memory.buildMemory(
        deps.store.getMemory(id),
        {
          type: 'handoff',
          title: input?.title,
          body: input?.body,
          projectId,
          source: 'modelo',
          sourceConversationId: input?.sourceConversationId
        },
        id,
        now
      )
      if ('error' in res) return res
      res.memory.lastAccessedAt = now // writing is accessing; don't inflate the count
      deps.store.upsertMemory(res.memory)
      return { ok: true }
    }
  )

  ipcMain.handle('ai:memory:summary', () =>
    deps.memory.summarizeMemories(deps.store.listMemories({ includeArchived: true }))
  )

  ipcMain.handle('ai:memory:conflicts', () => deps.memory.findConflicts(deps.store.listMemories()))

  // The run-start briefing block for a project (its memories + the globals),
  // preformatted so the chat and the code agent share one format. Reading the
  // briefing is decay-neutral (no touch), but run start is where the lazy decay
  // pass fires: archive cold pages first, then brief on the survivors. `archived`
  // rides back so the chat can note it. Prune is guarded — a decay failure must
  // not cost the run its briefing.
  ipcMain.handle('ai:memory:briefing', (_, projectId?: string | null) => {
    let archived = 0
    try {
      archived = runMemoryPrune()
    } catch {
      /* decay is best-effort; a failure here still leaves a valid briefing */
    }
    const memories = deps.store.memoriesForContext(projectId ?? null)
    return {
      text: deps.memory.formatMemoriesForPrompt(memories),
      count: memories.filter((m) => !m.archivedAt).length,
      archived
    }
  })
}
