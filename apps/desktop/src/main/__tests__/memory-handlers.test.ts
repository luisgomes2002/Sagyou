// @vitest-environment node
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { IpcMain } from 'electron'
import { registerMemoryHandlers } from '../handlers/memory'
import * as memoryRules from '../modules/ai/memory'
import type { AiMemory } from '../modules/ai/memory'

const DAY = 86_400_000

function memory(over: Partial<AiMemory> & { id: string }): AiMemory {
  const now = new Date().toISOString()
  return {
    projectId: 'p1',
    type: 'handoff',
    title: 'Sessão de terminal',
    body: 'corpo',
    tags: ['handoff', 'terminal', 'completed'],
    pinned: false,
    source: 'modelo',
    sourceConversationId: null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    archivedAt: null,
    ...over
  }
}

// Seven handoffs of one project, r1 the oldest, all recently touched (none is stale by decay).
const sevenHandoffs = (): AiMemory[] =>
  [1, 2, 3, 4, 5, 6, 7].map((n) =>
    memory({
      id: `handoff:p1:r${n}`,
      updatedAt: new Date(Date.now() - (8 - n) * DAY).toISOString()
    })
  )

interface Harness {
  handlers: Map<string, (...args: unknown[]) => unknown>
  archiveMemories: Mock
  replaceMemories: Mock
  onReplaced: Mock
  state: AiMemory[]
}

function setup(
  list: AiMemory[],
  extra: { liveRunIds?: Set<string>; replaceFails?: boolean } = {}
): Harness {
  const state = list
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  } as unknown as IpcMain
  const archiveMemories = vi.fn((ids: string[], now: string) => {
    for (const m of state) if (ids.includes(m.id)) m.archivedAt = now
  })
  const replaceMemories = vi.fn(() => {
    if (extra.replaceFails) throw new Error('falhou')
  })
  const onReplaced = vi.fn()
  registerMemoryHandlers(ipcMain, {
    store: {
      archiveMemories,
      replaceMemories,
      listMemories: (opts?: { includeArchived?: boolean }) =>
        state.filter((m) => opts?.includeArchived || !m.archivedAt)
    } as never,
    memory: memoryRules as never,
    newId: () => 'id',
    liveRunIds: () => extra.liveRunIds ?? new Set<string>(),
    onReplaced
  })
  return { handlers, archiveMemories, replaceMemories, onReplaced, state }
}

describe('ai:memory:prune', () => {
  it('archives the handoffs past the newest five of a project', () => {
    const { handlers, archiveMemories } = setup(sevenHandoffs())
    expect(handlers.get('ai:memory:prune')?.({})).toEqual({ archived: 2 })
    const ids = archiveMemories.mock.calls.flatMap(([archived]) => archived)
    expect(ids.sort()).toEqual(['handoff:p1:r1', 'handoff:p1:r2'])
  })

  it('never archives the running handoff of a live run, nor counts an id twice', () => {
    const list = sevenHandoffs()
    list[0] = { ...list[0], tags: ['handoff', 'terminal', 'em-andamento'] }
    const stale = memory({
      id: 'fato-velho',
      type: 'fato',
      projectId: null,
      lastAccessedAt: new Date(Date.now() - 400 * DAY).toISOString()
    })
    const { handlers, state } = setup([...list, stale], { liveRunIds: new Set(['r1']) })
    // The stale fact and r2 go; r1 stays because its run is alive.
    expect(handlers.get('ai:memory:prune')?.({})).toEqual({ archived: 2 })
    expect(state.find((m) => m.id === 'handoff:p1:r1')?.archivedAt).toBeNull()
    expect(state.find((m) => m.id === 'handoff:p1:r2')?.archivedAt).not.toBeNull()
    expect(state.find((m) => m.id === 'fato-velho')?.archivedAt).not.toBeNull()
  })

  it('does nothing when no project is over the limit', () => {
    const { handlers, archiveMemories } = setup(sevenHandoffs().slice(0, 5))
    expect(handlers.get('ai:memory:prune')?.({})).toEqual({ archived: 0 })
    expect(archiveMemories).toHaveBeenCalledTimes(1)
    expect(archiveMemories.mock.calls[0][0]).toEqual([])
  })
})

describe('ai:memory:replace', () => {
  it('tells the app once every memory was replaced', () => {
    const { handlers, replaceMemories, onReplaced } = setup([])
    handlers.get('ai:memory:replace')?.({}, [{ id: 'm1' }])
    expect(replaceMemories).toHaveBeenCalledWith([{ id: 'm1' }])
    expect(onReplaced).toHaveBeenCalledTimes(1)
  })

  it('does not tell it when the replace failed', () => {
    const { handlers, onReplaced } = setup([], { replaceFails: true })
    expect(() => handlers.get('ai:memory:replace')?.({}, [])).toThrow('falhou')
    expect(onReplaced).not.toHaveBeenCalled()
  })
})
