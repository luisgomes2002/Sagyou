import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesView } from '../../components/views/FilesView'
import { useKanbanStore } from '../../store/kanban'
import type { StoredFile } from '../../types'

const stored = (id: string, name: string, size: number, projectId?: string): StoredFile => ({
  id,
  name,
  ext: name.slice(name.lastIndexOf('.')),
  size,
  createdAt: `2026-10-2${id.length}T00:00:00.000Z`,
  projectId
})

const pick = vi.fn()
const stageDropped = vi.fn()
const importFiles = vi.fn(async (items: { token: string; name: string }[]) =>
  items.map((item) => ({
    id: `new-${item.token}`,
    name: item.name,
    ext: '.txt',
    size: 3,
    createdAt: '2026-10-27T00:00:00.000Z'
  }))
)

beforeEach(() => {
  pick.mockReset()
  stageDropped.mockReset()
  importFiles.mockClear()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    files: { pick, stageDropped, import: importFiles, discard: vi.fn(async () => {}) }
  }
  useKanbanStore.setState({
    files: [
      stored('a', 'contrato.pdf', 100, 'p1'),
      stored('bb', 'Contrato.pdf', 100, 'p1'),
      stored('ccc', 'contrato.pdf', 999, 'p1'),
      stored('dddd', 'outro.pdf', 100, 'p2')
    ]
  })
})

const filesDrag = (types: string[], count = 2): { dataTransfer: Record<string, unknown> } => ({
  dataTransfer: { types, items: { length: count }, files: [], dropEffect: 'none' }
})

describe('FilesView', () => {
  it('imports picked files into the active project', async () => {
    pick.mockResolvedValue({
      staged: [{ token: 't1', name: 'novo.txt', size: 3 }],
      skipped: 0,
      overLimit: 0
    })
    render(<FilesView activeProjectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar arquivos' }))
    await waitFor(() =>
      expect(useKanbanStore.getState().files.find((f) => f.id === 'new-t1')?.projectId).toBe('p1')
    )
  })

  it('tags repeated files and filters by them', () => {
    render(<FilesView activeProjectId="p1" />)
    expect(screen.getAllByText('Repetido')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Repetidos (2)' }))
    expect(screen.getAllByText(/contrato\.pdf/i)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Repetidos (2)' }))
    expect(screen.getAllByText(/contrato\.pdf/i)).toHaveLength(3)
  })

  it('hides the repeated filter when there are none', () => {
    render(<FilesView activeProjectId="p2" />)
    expect(screen.queryByRole('button', { name: /Repetidos/ })).toBeNull()
    expect(screen.queryByText('Repetido')).toBeNull()
  })

  it('shows the drop overlay only for files', () => {
    render(<FilesView activeProjectId="p1" />)
    const zone = screen.getByTestId('files-drop-zone')
    fireEvent.dragEnter(zone, filesDrag(['text/plain']))
    expect(screen.queryByText(/Solte para importar/)).toBeNull()
    fireEvent.dragEnter(zone, filesDrag(['Files'], 2))
    expect(screen.getByText('Solte para importar 2 arquivo(s)')).toBeInTheDocument()
    // Moving onto a row fires enter on the row before leave on the zone.
    const row = screen.getAllByText(/contrato\.pdf/i)[0]
    fireEvent.dragEnter(row, filesDrag(['Files'], 2))
    fireEvent.dragLeave(zone, filesDrag(['Files']))
    expect(screen.getByText('Solte para importar 2 arquivo(s)')).toBeInTheDocument()
    fireEvent.dragLeave(row, filesDrag(['Files']))
    expect(screen.queryByText(/Solte para importar/)).toBeNull()
  })

  it('turns the repeated filter off when the project changes', () => {
    const { rerender } = render(<FilesView activeProjectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Repetidos (2)' }))
    rerender(<FilesView activeProjectId="p2" />)
    useKanbanStore.setState({
      files: [
        ...useKanbanStore.getState().files,
        stored('eeeee', 'outro.pdf', 100, 'p2')
      ]
    })
    rerender(<FilesView activeProjectId="p2" />)
    expect(screen.getByRole('button', { name: 'Repetidos (2)' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('shows a notice when the import fails', async () => {
    pick.mockRejectedValue(new Error('ipc down'))
    render(<FilesView activeProjectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar arquivos' }))
    expect(await screen.findByText('Não foi possível importar os arquivos.')).toBeInTheDocument()
  })

  it('keeps the drop overlay in view while the list scrolls', () => {
    render(<FilesView activeProjectId="p1" />)
    const zone = screen.getByTestId('files-drop-zone')
    fireEvent.dragEnter(zone, filesDrag(['Files'], 1))
    const overlay = screen.getByText('Solte para importar 1 arquivo(s)').parentElement
    // The overlay must not live inside the element that scrolls.
    expect(zone.className).not.toContain('overflow-y-auto')
    expect(overlay?.parentElement).toBe(zone)
  })

  it('imports dropped files and warns about skipped folders', async () => {
    stageDropped.mockResolvedValue({
      staged: [{ token: 'd1', name: 'solto.txt', size: 3 }],
      skipped: 1,
      overLimit: 0
    })
    render(<FilesView activeProjectId="p1" />)
    const zone = screen.getByTestId('files-drop-zone')
    const dropped = [new File(['x'], 'solto.txt')]
    fireEvent.dragEnter(zone, filesDrag(['Files'], 1))
    const drop = createEvent.drop(zone)
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: dropped, items: { length: 1 } }
    })
    await act(async () => {
      fireEvent(zone, drop)
    })
    expect(stageDropped).toHaveBeenCalledWith(dropped)
    expect(await screen.findByText('Pastas não são importadas; arraste os arquivos.')).toBeInTheDocument()
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith([{ token: 'd1', name: 'solto.txt' }]))
    expect(screen.queryByText(/Solte para importar/)).toBeNull()
  })

  it('warns when more than the limit was dropped', async () => {
    stageDropped.mockResolvedValue({ staged: [], skipped: 0, overLimit: 3 })
    render(<FilesView activeProjectId="p1" />)
    const zone = screen.getByTestId('files-drop-zone')
    const drop = createEvent.drop(zone)
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['x'], 'a.txt')], items: { length: 1 } }
    })
    await act(async () => {
      fireEvent(zone, drop)
    })
    const toolbar = screen.getByTestId('files-toolbar')
    expect(
      await within(toolbar).findByText('Só 200 arquivos por vez; o restante foi ignorado.')
    ).toBeInTheDocument()
  })
})
