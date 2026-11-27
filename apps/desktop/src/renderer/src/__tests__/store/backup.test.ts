// Backup export and import of the store: what a restore replaces, keeps and refuses.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock ElectronStorage before importing the store
vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      })
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.autoSaveBackup = vi.fn().mockResolvedValue({ success: true })
      this.commitBackupBlobs = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadMemories = vi.fn().mockResolvedValue([])
      this.replaceMemories = vi.fn().mockResolvedValue(undefined)
      this.rebuildSearchIndex = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { ElectronStorage } from '../../services/ElectronStorage'

type StorageMock = {
  load: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  importBackup: ReturnType<typeof vi.fn>
  exportBackup: ReturnType<typeof vi.fn>
  autoSaveBackup: ReturnType<typeof vi.fn>
  commitBackupBlobs: ReturnType<typeof vi.fn>
  loadMemories: ReturnType<typeof vi.fn>
  replaceMemories: ReturnType<typeof vi.fn>
  rebuildSearchIndex: ReturnType<typeof vi.fn>
}

function getStorageMock(): StorageMock {
  return vi.mocked(ElectronStorage).mock.instances[0] as unknown as StorageMock
}

function resetStore(): void {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    activeProjectId: null,
    sprintFilter: null,
    activeTimers: [],
    isLoaded: false
  })
}

// ── Chat history is no longer part of backups ────────────────────────────────────────────────

describe('backups ignore the removed AI chat history', () => {
  beforeEach(resetStore)

  const conversation = {
    id: 'c1',
    title: 'Planejar sprint',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    messages: [
      { role: 'user' as const, content: 'oi' },
      // Display-only agent trace — must survive a round-trip like any other line.
      { role: 'status' as const, content: 'Lendo src/App.tsx' },
      { role: 'assistant' as const, content: 'olá' }
    ]
  }

  it('exportBackup has no conversations or chatImages, keeps memories and file metadata at version 7', async () => {
    const storage = getStorageMock()
    const memory = {
      id: 'm1',
      projectId: null,
      type: 'fato',
      title: 't',
      body: 'b',
      tags: [],
      pinned: false,
      source: 'modelo',
      createdAt: 'x',
      updatedAt: 'x',
      lastAccessedAt: 'x',
      accessCount: 0,
      archivedAt: null
    }
    storage.loadMemories.mockResolvedValueOnce([memory])
    const file = {
      id: 'f1',
      name: 'doc.pdf',
      ext: '.pdf',
      size: 10,
      createdAt: 'x',
      projectId: 'p1'
    }
    useKanbanStore.setState({ files: [file] })

    await useKanbanStore.getState().exportBackup()

    const backup = storage.exportBackup.mock.calls[0][0]
    expect(backup.version).toBe(7)
    expect(backup).not.toHaveProperty('conversations')
    expect(backup).not.toHaveProperty('chatImages')
    expect(backup.memories).toEqual([memory])
    // Attachment metadata rides along now; the bytes are attached in main.
    expect(backup.files).toEqual([file])
  })

  it('importBackup restores file metadata from a v5 backup', async () => {
    const storage = getStorageMock()
    const file = {
      id: 'f1',
      name: 'doc.pdf',
      ext: '.pdf',
      size: 10,
      createdAt: 'x',
      projectId: 'p1'
    }
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 5,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: [],
        files: [file]
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().files).toEqual([file])
  })

  it('restores a financial receipt link and its record metadata with the file', async () => {
    const storage = getStorageMock()
    useKanbanStore.setState({ files: [] })
    const listId = useKanbanStore.getState().createList('Brasil', 'BRL')
    const txId = useKanbanStore.getState().addTransaction(listId, {
      description: 'Pagamento',
      amount: '100',
      type: 'expense',
      date: '2026-10-06'
    })
    const file = {
      id: 'receipt-1',
      name: 'pix.pdf',
      ext: '.pdf',
      size: 10,
      createdAt: '2026-10-06T12:00:00Z'
    }
    useKanbanStore.getState().addFiles([file])
    useKanbanStore.getState().updateTransaction(listId, txId, {
      receiptFileIds: [file.id],
      bankReference: 'E2E-123',
      counterparty: 'Loja',
      reconciledAt: '2026-10-06T13:00:00Z'
    })

    await useKanbanStore.getState().exportBackup()
    const backup = storage.exportBackup.mock.calls.at(-1)![0]
    expect(backup.lists[0].transactions[0]).toMatchObject({
      receiptFileIds: [file.id],
      bankReference: 'E2E-123',
      counterparty: 'Loja',
      reconciledAt: '2026-10-06T13:00:00Z'
    })
    useKanbanStore.setState({ lists: [], files: [] })
    storage.importBackup.mockResolvedValueOnce({ success: true, data: backup })

    expect(await useKanbanStore.getState().importBackup()).toBe(true)
    expect(useKanbanStore.getState().files).toEqual([file])
    expect(useKanbanStore.getState().lists[0].transactions[0]).toMatchObject({
      receiptFileIds: [file.id],
      bankReference: 'E2E-123',
      counterparty: 'Loja',
      reconciledAt: '2026-10-06T13:00:00Z'
    })
  })

  it('importBackup leaves local files alone for a pre-v5 backup (no files key)', async () => {
    const local = { id: 'local', name: 'keep.txt', ext: '.txt', size: 1, createdAt: 'x' }
    useKanbanStore.setState({ files: [local] })
    const storage = getStorageMock()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 4,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().files).toEqual([local])
  })

  it('exportBackup still succeeds when memory cannot be read', async () => {
    const storage = getStorageMock()
    storage.loadMemories.mockRejectedValueOnce(new Error('db locked'))

    const result = await useKanbanStore.getState().exportBackup()

    expect(result).toBe(true)
    expect(storage.exportBackup.mock.calls.at(-1)![0].memories).toEqual([])
  })

  it('importBackup restores memories from a v4 backup', async () => {
    const storage = getStorageMock()
    const memory = {
      id: 'm1',
      projectId: null,
      type: 'fato',
      title: 't',
      body: 'b',
      tags: [],
      pinned: false,
      source: 'modelo',
      createdAt: 'x',
      updatedAt: 'x',
      lastAccessedAt: 'x',
      accessCount: 0,
      archivedAt: null
    }
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 4,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: [],
        memories: [memory]
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(storage.replaceMemories).toHaveBeenCalledWith([memory])
  })

  it('importBackup leaves local memory alone for a backup without the key', async () => {
    const storage = getStorageMock()
    storage.replaceMemories.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 3,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(storage.replaceMemories).not.toHaveBeenCalled()
  })

  it('importBackup ignores conversations and chatImages but restores tasks and memories', async () => {
    const storage = getStorageMock()
    storage.replaceMemories.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 7,
        exportedAt: new Date().toISOString(),
        projects: [{ id: 'p9', name: 'Importado', columns: [{ id: 'c9', name: 'A', order: 0 }] }],
        tasks: [{ id: 't9', title: 'Tarefa', projectId: 'p9', columnId: 'c9' }],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: [],
        conversations: [conversation],
        chatImages: [{ id: 'x.png', base64: 'AAAA' }],
        memories: [{ id: 'm9', title: 'Fato', body: 'corpo', sourceConversationId: 'c1' }]
      }
    })

    expect(await useKanbanStore.getState().importBackup()).toBe(true)

    expect(useKanbanStore.getState().tasks.map((t) => t.id)).toContain('t9')
    expect(storage.replaceMemories).toHaveBeenCalledOnce()
    expect(storage).not.toHaveProperty('saveConversations')
    expect(storage).not.toHaveProperty('loadConversations')
  })
})

describe('appearance preferences', () => {
  beforeEach(resetStore)

  it('persists the chosen appearance in backups', async () => {
    const storage = getStorageMock()
    useKanbanStore.getState().setUiPreferences({
      theme: 'light',
      fontSize: 'large',
      reduceMotion: true,
      highContrast: true
    })

    await useKanbanStore.getState().exportBackup()

    expect(storage.exportBackup.mock.calls.at(-1)![0].uiPreferences).toEqual({
      theme: 'light',
      fontSize: 'large',
      reduceMotion: true,
      highContrast: true
    })
  })

  it('keeps local appearance when an older backup has no preference', async () => {
    const storage = getStorageMock()
    const preferences = {
      theme: 'light' as const,
      fontSize: 'large' as const,
      reduceMotion: true,
      highContrast: false
    }
    useKanbanStore.getState().setUiPreferences(preferences)
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 7,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      }
    })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().uiPreferences).toEqual(preferences)
  })
})

// ── importBackup ──────────────────────────────────────────────────────────────

describe('importBackup', () => {
  it('rebuilds search after the restored store and memories are saved', async () => {
    resetStore()
    const storage = getStorageMock()
    storage.rebuildSearchIndex.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 7,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: [],
        memories: []
      }
    })

    expect(await useKanbanStore.getState().importBackup()).toBe(true)
    expect(storage.rebuildSearchIndex).toHaveBeenCalledOnce()
    const rebuildOrder = storage.rebuildSearchIndex.mock.invocationCallOrder[0]
    expect(storage.save.mock.invocationCallOrder.at(-1)).toBeLessThan(rebuildOrder)
    expect(storage.replaceMemories.mock.invocationCallOrder.at(-1)).toBeLessThan(rebuildOrder)
  })

  it('migrates legacy money identically when loading data and importing a backup', async () => {
    resetStore()
    const legacyList = {
      id: 'old-table',
      name: 'Old table',
      items: [{ id: 'item', name: 'Item', price: 3.75 }],
      transactions: [
        { id: 'tx', amount: 12.5, details: [{ id: 'part', description: 'Part', amount: 20 }] }
      ],
      goals: [{ id: 'goal', targetAmount: 100 }],
      actualBalance: 42.25,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    }
    const data = {
      projects: [],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: [legacyList]
    }
    const storage = getStorageMock()
    storage.load.mockResolvedValueOnce(data)
    await useKanbanStore.getState().loadData()
    const loaded = useKanbanStore.getState().lists[0]

    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: { ...data, version: 2, exportedAt: '2026-01-01' }
    })
    expect(await useKanbanStore.getState().importBackup()).toBe(true)
    const imported = useKanbanStore.getState().lists[0]

    expect(imported).toEqual(loaded)
    expect(imported).toMatchObject({
      currency: 'BRL',
      items: [{ price: '3.75' }],
      transactions: [{ amount: '12.5', details: [{ amount: '12.5' }] }],
      goals: [{ targetAmount: '100' }],
      actualBalance: '42.25'
    })
  })

  beforeEach(resetStore)

  it('keeps current data and blobs when the pre-import snapshot fails', async () => {
    const localId = useKanbanStore.getState().createProject('Local')
    const storage = getStorageMock()
    storage.commitBackupBlobs.mockClear()
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: { version: 7, exportedAt: new Date().toISOString(), projects: [], tasks: [] }
    })
    storage.autoSaveBackup.mockResolvedValueOnce({ success: false })

    expect(await useKanbanStore.getState().importBackup()).toBe(false)
    expect(useKanbanStore.getState().projects[0].id).toBe(localId)
    expect(storage.commitBackupBlobs).not.toHaveBeenCalled()
  })

  it('rolls back state and memories when a sidecar write fails during restore', async () => {
    const localId = useKanbanStore.getState().createProject('Local')
    const storage = getStorageMock()
    const previousMemories = [{ id: 'old', title: 'Anterior', body: 'x' }]
    // exportBackup(true) reads memories for the restore point before importBackup
    // captures the state it must restore on failure.
    storage.loadMemories.mockResolvedValueOnce([]).mockResolvedValueOnce(previousMemories)
    storage.replaceMemories
      .mockRejectedValueOnce(new Error('disco cheio'))
      .mockResolvedValueOnce(undefined)
    storage.importBackup.mockResolvedValueOnce({
      success: true,
      data: {
        version: 7,
        exportedAt: new Date().toISOString(),
        projects: [],
        tasks: [],
        memories: [{ id: 'new', title: 'Novo', body: 'y' }]
      }
    })

    await expect(useKanbanStore.getState().importBackup()).rejects.toThrow(
      'dados anteriores foram preservados'
    )
    expect(useKanbanStore.getState().projects.map((project) => project.id)).toEqual([localId])
    expect(storage.replaceMemories).toHaveBeenLastCalledWith(previousMemories)
    expect(storage.commitBackupBlobs).not.toHaveBeenCalled()
  })

  it('returns false and leaves state unchanged when cancelled', async () => {
    const pid = useKanbanStore.getState().createProject('Local project')
    getStorageMock().importBackup.mockResolvedValueOnce({ success: false, cancelled: true })

    const result = await useKanbanStore.getState().importBackup()

    expect(result).toBe(false)
    expect(useKanbanStore.getState().projects).toHaveLength(1)
    expect(useKanbanStore.getState().projects[0].id).toBe(pid)
  })

  it('replaces all local state with backup data', async () => {
    useKanbanStore.getState().createProject('Local project')
    useKanbanStore.getState().createHabit({ name: 'Local habit', color: '#fff' })

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [
        {
          id: 'bp1',
          name: 'Backup project',
          color: '#ff0000',
          columns: [],
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tasks: [
        {
          id: 'bt1',
          projectId: 'bp1',
          columnId: 'c1',
          title: 'Backup task',
          order: 0,
          priority: 'medium',
          tags: [],
          images: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [
        {
          id: 'bh1',
          name: 'Backup habit',
          color: '#0f0',
          completions: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    const result = await useKanbanStore.getState().importBackup()

    expect(result).toBe(true)
    const state = useKanbanStore.getState()
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].id).toBe('bp1')
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0].id).toBe('bt1')
    expect(state.habits).toHaveLength(1)
    expect(state.habits[0].id).toBe('bh1')
  })

  it('sets activeProjectId to the first backup project', async () => {
    useKanbanStore.getState().createProject('Local')

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [
        {
          id: 'first',
          name: 'First',
          color: '#fff',
          columns: [],
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'second',
          name: 'Second',
          color: '#000',
          columns: [],
          order: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeProjectId).toBe('first')
  })

  it('sets activeProjectId to null when backup has no projects', async () => {
    useKanbanStore.getState().createProject('Local')

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeProjectId).toBeNull()
  })

  it('clears any running timer on restore', async () => {
    const pid = useKanbanStore.getState().createProject('P')
    const col = useKanbanStore.getState().projects[0].columns[0]
    const tid = useKanbanStore
      .getState()
      .createTask({ projectId: pid, columnId: col.id, title: 'T' })
    useKanbanStore.getState().startTimer(tid)
    expect(useKanbanStore.getState().activeTimers).toHaveLength(1)

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    expect(useKanbanStore.getState().activeTimers).toEqual([])
  })

  it('applies defaults for missing optional fields in backup lists', async () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: [
        {
          id: 'l1',
          name: 'Old list',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    const list = useKanbanStore.getState().lists[0]
    expect(list.transactions).toEqual([])
    expect(list.goals).toEqual([])
    expect(list.currency).toBe('BRL')
  })

  it('assigns order to backup projects that are missing it', async () => {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projects: [
        {
          id: 'p1',
          name: 'A',
          color: '#fff',
          columns: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'p2',
          name: 'B',
          color: '#000',
          columns: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tasks: [],
      sprints: [],
      tombstones: [],
      notes: [],
      goals: [],
      habits: [],
      lists: []
    }
    getStorageMock().importBackup.mockResolvedValueOnce({ success: true, data: backup })

    await useKanbanStore.getState().importBackup()

    const projects = useKanbanStore.getState().projects
    expect(projects[0].order).toBe(0)
    expect(projects[1].order).toBe(1)
  })
})
