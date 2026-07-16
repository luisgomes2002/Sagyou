import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({ projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [], files: [] })
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadConversations = vi.fn().mockResolvedValue([])
      this.saveConversations = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import type { StoredFile } from '../../types'

function makeFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: 'file-1',
    name: 'document.pdf',
    ext: '.pdf',
    size: 1024,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function resetStore() {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    files: [],
    activeProjectId: null,
    sprintFilter: null,
    activeTimer: null,
    isLoaded: false,
  })
}

// ── addFiles ──────────────────────────────────────────────────────────────────

describe('addFiles', () => {
  beforeEach(resetStore)

  it('adds a single file to the store', () => {
    const file = makeFile()
    useKanbanStore.getState().addFiles([file])
    expect(useKanbanStore.getState().files).toHaveLength(1)
    expect(useKanbanStore.getState().files[0]).toEqual(file)
  })

  it('adds multiple files at once', () => {
    const files = [
      makeFile({ id: 'f1', name: 'a.pdf' }),
      makeFile({ id: 'f2', name: 'b.docx', ext: '.docx' }),
      makeFile({ id: 'f3', name: 'c.xlsx', ext: '.xlsx' }),
    ]
    useKanbanStore.getState().addFiles(files)
    expect(useKanbanStore.getState().files).toHaveLength(3)
  })

  it('appends to existing files without replacing them', () => {
    useKanbanStore.getState().addFiles([makeFile({ id: 'f1', name: 'first.pdf' })])
    useKanbanStore.getState().addFiles([makeFile({ id: 'f2', name: 'second.pdf' })])
    const files = useKanbanStore.getState().files
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.id)).toEqual(['f1', 'f2'])
  })

  it('stores file with projectId when provided', () => {
    const file = makeFile({ id: 'f1', projectId: 'proj-abc' })
    useKanbanStore.getState().addFiles([file])
    expect(useKanbanStore.getState().files[0].projectId).toBe('proj-abc')
  })

  it('stores file without projectId when not provided', () => {
    const file = makeFile({ id: 'f1' })
    useKanbanStore.getState().addFiles([file])
    expect(useKanbanStore.getState().files[0].projectId).toBeUndefined()
  })

  it('preserves all file fields', () => {
    const file: StoredFile = {
      id: 'f-full',
      name: 'report.pdf',
      ext: '.pdf',
      size: 204800,
      createdAt: '2026-06-17T10:00:00.000Z',
      projectId: 'proj-1',
    }
    useKanbanStore.getState().addFiles([file])
    expect(useKanbanStore.getState().files[0]).toEqual(file)
  })
})

// ── removeFile ────────────────────────────────────────────────────────────────

describe('removeFile', () => {
  beforeEach(resetStore)

  it('removes the file with the given id', () => {
    useKanbanStore.getState().addFiles([
      makeFile({ id: 'f1', name: 'keep.pdf' }),
      makeFile({ id: 'f2', name: 'delete.pdf' }),
    ])
    useKanbanStore.getState().removeFile('f2')
    const files = useKanbanStore.getState().files
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('f1')
  })

  it('is a no-op when the id does not exist', () => {
    useKanbanStore.getState().addFiles([makeFile({ id: 'f1' })])
    useKanbanStore.getState().removeFile('non-existent')
    expect(useKanbanStore.getState().files).toHaveLength(1)
  })

  it('results in an empty list when the only file is removed', () => {
    useKanbanStore.getState().addFiles([makeFile({ id: 'f1' })])
    useKanbanStore.getState().removeFile('f1')
    expect(useKanbanStore.getState().files).toHaveLength(0)
  })

  it('does not affect other files when one is removed', () => {
    const files = [
      makeFile({ id: 'f1', name: 'a.pdf' }),
      makeFile({ id: 'f2', name: 'b.pdf' }),
      makeFile({ id: 'f3', name: 'c.pdf' }),
    ]
    useKanbanStore.getState().addFiles(files)
    useKanbanStore.getState().removeFile('f2')
    const remaining = useKanbanStore.getState().files
    expect(remaining.map((f) => f.id)).toEqual(['f1', 'f3'])
  })
})

// ── project-scoped file filtering ─────────────────────────────────────────────

describe('project-scoped files', () => {
  beforeEach(resetStore)

  it('files with different projectIds coexist in the store', () => {
    useKanbanStore.getState().addFiles([
      makeFile({ id: 'f1', projectId: 'proj-a' }),
      makeFile({ id: 'f2', projectId: 'proj-b' }),
      makeFile({ id: 'f3' }),
    ])
    expect(useKanbanStore.getState().files).toHaveLength(3)
  })

  it('filtering by projectId returns only that project files', () => {
    useKanbanStore.getState().addFiles([
      makeFile({ id: 'f1', projectId: 'proj-a' }),
      makeFile({ id: 'f2', projectId: 'proj-a' }),
      makeFile({ id: 'f3', projectId: 'proj-b' }),
      makeFile({ id: 'f4' }),
    ])
    const projectAFiles = useKanbanStore.getState().files.filter((f) => f.projectId === 'proj-a')
    expect(projectAFiles).toHaveLength(2)
    expect(projectAFiles.every((f) => f.projectId === 'proj-a')).toBe(true)
  })

  it('filtering for files without a project returns only unassigned files', () => {
    useKanbanStore.getState().addFiles([
      makeFile({ id: 'f1', projectId: 'proj-a' }),
      makeFile({ id: 'f2' }),
      makeFile({ id: 'f3' }),
    ])
    const unassigned = useKanbanStore.getState().files.filter((f) => !f.projectId)
    expect(unassigned).toHaveLength(2)
  })

  it('removing a file from one project does not affect another', () => {
    useKanbanStore.getState().addFiles([
      makeFile({ id: 'f1', projectId: 'proj-a' }),
      makeFile({ id: 'f2', projectId: 'proj-b' }),
    ])
    useKanbanStore.getState().removeFile('f1')
    const remaining = useKanbanStore.getState().files
    expect(remaining).toHaveLength(1)
    expect(remaining[0].projectId).toBe('proj-b')
  })
})

// ── loadData hydration ─────────────────────────────────────────────────────────

describe('loadData — files hydration', () => {
  beforeEach(resetStore)

  it('hydrates files from persisted data', async () => {
    const storedFiles: StoredFile[] = [
      { id: 'f1', name: 'old.pdf', ext: '.pdf', size: 512, createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = vi.mocked(ElectronStorage).mock.instances[0] as unknown as { load: ReturnType<typeof vi.fn> }
    instance.load.mockResolvedValueOnce({
      projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [], files: storedFiles,
    })
    await useKanbanStore.getState().loadData()
    expect(useKanbanStore.getState().files).toEqual(storedFiles)
  })

  it('defaults to empty array when files key is missing from persisted data', async () => {
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = vi.mocked(ElectronStorage).mock.instances[0] as unknown as { load: ReturnType<typeof vi.fn> }
    instance.load.mockResolvedValueOnce({
      projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [],
    })
    await useKanbanStore.getState().loadData()
    expect(useKanbanStore.getState().files).toEqual([])
  })

  it('hydrates files with projectId from persisted data', async () => {
    const storedFiles: StoredFile[] = [
      { id: 'f1', name: 'linked.pdf', ext: '.pdf', size: 2048, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'proj-xyz' },
    ]
    const { ElectronStorage } = await import('../../services/ElectronStorage')
    const instance = vi.mocked(ElectronStorage).mock.instances[0] as unknown as { load: ReturnType<typeof vi.fn> }
    instance.load.mockResolvedValueOnce({
      projects: [], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [], files: storedFiles,
    })
    await useKanbanStore.getState().loadData()
    expect(useKanbanStore.getState().files[0].projectId).toBe('proj-xyz')
  })
})
