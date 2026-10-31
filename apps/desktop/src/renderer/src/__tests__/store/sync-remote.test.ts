// A pull applied in main reaches the renderer as {generation, state}. The
// renderer takes it without saving (it is already in the database) and sends
// the generation with its next save, so main can tell a stale save apart.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { Task } from '../../types'
import type { RemoteChanges, useKanbanStore as UseKanbanStore } from '../../store/kanban'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  listeners: [] as ((changes: RemoteChanges) => void)[]
}))

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = mocks.load
    this.save = mocks.save
    this.exportBackup = vi.fn().mockResolvedValue({ success: true })
    this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
    this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
  })
}))

let useKanbanStore: typeof UseKanbanStore

/** Let the async apply (save, then load) run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const T = '2026-10-30T12:00:00.000Z'

function task(title: string, id = 't1'): Task {
  return {
    id,
    projectId: 'p1',
    columnId: 'c1',
    title,
    priority: 'medium',
    tags: [],
    order: 0,
    createdAt: T,
    updatedAt: T
  }
}

function project(): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'Projeto',
    color: '#000',
    columns: [{ id: 'c1', name: 'Backlog', order: 0 }],
    createdAt: T,
    updatedAt: T
  }
}

function remoteState(tasks: Task[]): Record<string, unknown> {
  return {
    projects: [project()],
    tasks,
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    files: [],
    timeBlocks: [],
    routines: []
  }
}

function emit(changes: RemoteChanges): void {
  for (const listener of mocks.listeners) listener(changes)
}

beforeAll(async () => {
  // The store subscribes when it is imported, so the bridge must exist first.
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    sync: {
      onRemoteChanges: (cb: (changes: RemoteChanges) => void) => {
        mocks.listeners.push(cb)
        return () => undefined
      }
    }
  }
  ;({ useKanbanStore } = await import('../../store/kanban'))
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  mocks.save.mockReset().mockResolvedValue(undefined)
  mocks.load.mockReset()
  useKanbanStore.setState({
    projects: [project() as never],
    tasks: [task('Antiga')],
    activeProjectId: 'p1',
    activeTimers: [{ taskId: 't1', startedAt: 5 }],
    isLoaded: true,
    syncGeneration: 0
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sync remote changes', () => {
  it('subscribes to the bridge once', () => {
    expect(mocks.listeners).toHaveLength(1)
  })

  it('updates tasks without saving, and the next save carries the generation', async () => {
    emit({ generation: 3, state: remoteState([task('Remota')]) })
    await settle()

    const state = useKanbanStore.getState()
    expect(state.tasks.map((t) => t.title)).toEqual(['Remota'])
    expect(state.syncGeneration).toBe(3)
    expect(state.activeTimers).toEqual([{ taskId: 't1', startedAt: 5 }])
    expect(mocks.save).not.toHaveBeenCalled()

    useKanbanStore.getState()._persist()
    vi.advanceTimersByTime(300)
    await settle()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ syncGeneration: 3 })
  })

  it('ignores a generation it has already applied', async () => {
    useKanbanStore.setState({ syncGeneration: 4 })
    emit({ generation: 4, state: remoteState([task('Velha demais')]) })
    await settle()
    expect(useKanbanStore.getState().tasks.map((t) => t.title)).toEqual(['Antiga'])
  })

  it('saves a pending local edit first, then takes the saved state', async () => {
    useKanbanStore.setState({ tasks: [task('Antiga'), task('Local', 't2')] })
    useKanbanStore.getState()._persist()
    mocks.load.mockResolvedValue({
      ...remoteState([task('Remota'), task('Local', 't2')]),
      syncGeneration: 5
    })

    emit({ generation: 5, state: remoteState([task('Remota')]) })
    await settle()

    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ syncGeneration: 0 })
    expect(useKanbanStore.getState().tasks.map((t) => t.title)).toEqual(['Remota', 'Local'])
    expect(useKanbanStore.getState().syncGeneration).toBe(5)
  })

  it('does not take a state that may predate a save still on the way', async () => {
    let release: () => void = () => undefined
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const inFlight = useKanbanStore.getState()._flushPersist()
    mocks.load.mockResolvedValue({
      ...remoteState([task('Remota'), task('Criada aqui', 't3')]),
      syncGeneration: 6
    })

    emit({ generation: 6, state: remoteState([task('Remota')]) })
    await settle()
    release()
    await inFlight

    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(useKanbanStore.getState().tasks.map((t) => t.title)).toEqual(['Remota', 'Criada aqui'])
    expect(useKanbanStore.getState().syncGeneration).toBe(6)
  })
})
