import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryView } from '../../components/ai/MemoryView'
import type { AiMemory } from '../../types'

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
}))

const memory = (i: number, archived = false): AiMemory => ({
  id: `m${i}`,
  projectId: null,
  type: 'fato',
  title: `Memória ${i}`,
  body: '',
  tags: [],
  pinned: false,
  source: 'modelo',
  sourceConversationId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  lastAccessedAt: '2026-10-01T00:00:00.000Z',
  accessCount: 0,
  archivedAt: archived ? '2026-10-02T00:00:00.000Z' : null
})

let corpus: AiMemory[] = []

// Same contract as main's pageMemories, over the test corpus.
const page = vi.fn(
  async (opts: { includeArchived: boolean; offset: number; limit: number; focusId?: string }) => {
    const filtered = opts.includeArchived ? corpus : corpus.filter((m) => !m.archivedAt)
    const last = filtered.length ? Math.floor((filtered.length - 1) / opts.limit) * opts.limit : 0
    const focus = opts.focusId ? filtered.findIndex((m) => m.id === opts.focusId) : -1
    const offset =
      focus >= 0 ? Math.floor(focus / opts.limit) * opts.limit : Math.min(opts.offset, last)
    const archivedCount = corpus.filter((m) => m.archivedAt).length
    return {
      items: filtered.slice(offset, offset + opts.limit),
      total: filtered.length,
      offset,
      activeCount: corpus.length - archivedCount,
      archivedCount
    }
  }
)
const remove = vi.fn(async (id: string) => {
  corpus = corpus.filter((m) => m.id !== id)
})

beforeEach(() => {
  corpus = Array.from({ length: 30 }, (_, i) => memory(i))
  page.mockClear()
  remove.mockClear()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    ai: { memory: { page, delete: remove, save: vi.fn(async () => ({})) } }
  }
})

describe('MemoryView paging', () => {
  it('shows 25 per page and moves between pages', async () => {
    render(<MemoryView />)
    expect(await screen.findByText('Página 1 de 2')).toBeTruthy()
    expect(screen.getByText('Memória 0')).toBeTruthy()
    expect(screen.queryByText('Memória 25')).toBeNull()
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(await screen.findByText('Página 2 de 2')).toBeTruthy()
    expect(screen.getByText('Memória 25')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Próxima' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('turning the archived filter on goes back to page 1 and asks for archived ones', async () => {
    corpus.push(memory(30, true))
    render(<MemoryView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Próxima' }))
    await screen.findByText('Página 2 de 2')
    fireEvent.click(screen.getByRole('button', { name: 'Ver arquivadas (1)' }))
    await waitFor(() =>
      expect(page).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeArchived: true, offset: 0 })
      )
    )
    expect(await screen.findByText('Página 1 de 2')).toBeTruthy()
  })

  it('opens an archived Ctrl+K target with the filter on, on its page', async () => {
    corpus.push(memory(30, true))
    render(<MemoryView searchTargetId="m30" />)
    expect(await screen.findByText('Memória 30')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ocultar arquivadas' })).toBeTruthy()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ focusId: 'm30' }))
    expect(screen.getByText('Página 2 de 2')).toBeTruthy()
  })

  it('opens an active Ctrl+K target on its page with the filter off', async () => {
    render(<MemoryView searchTargetId="m27" />)
    expect(await screen.findByText('Memória 27')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Ver arquivadas/ })).toBeTruthy()
    expect(screen.getByText('Página 2 de 2')).toBeTruthy()
  })

  it('turns the archived filter off when a later Ctrl+K target is active', async () => {
    corpus.push(memory(30, true))
    const { rerender } = render(<MemoryView searchTargetId="m30" />)
    await screen.findByRole('button', { name: 'Ocultar arquivadas' })
    rerender(<MemoryView searchTargetId="m3" />)
    expect(await screen.findByRole('button', { name: 'Ver arquivadas (1)' })).toBeTruthy()
    expect(page).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeArchived: false, focusId: 'm3' })
    )
  })

  it('goes back a page after deleting the only memory of the last page', async () => {
    corpus = corpus.slice(0, 26)
    render(<MemoryView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Próxima' }))
    await screen.findByText('Memória 25')
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Memória 0')).toBeTruthy()
    expect(screen.queryByText(/^Página/)).toBeNull()
  })

  it('has no paging bar with a single page', async () => {
    corpus = corpus.slice(0, 5)
    render(<MemoryView />)
    expect(await screen.findByText('Memória 4')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Próxima' })).toBeNull()
  })
})
