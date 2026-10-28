import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesView } from '../../components/views/FilesView'
import { useKanbanStore } from '../../store/kanban'
import type { StoredFile } from '../../types'

// addFiles schedules a debounced store save; keep it off window.electronAPI.store.
vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
}))

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

describe('FilesView rename', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      files: [stored('r1', 'IMG_1422.jpg', 10, 'p3'), stored('r2', 'Recibo.jpg', 10, 'p3')]
    })
  })
  const row = (name: string): HTMLElement => screen.getByText(name).closest('.group') as HTMLElement
  const nameOf = (id: string): string | undefined =>
    useKanbanStore.getState().files.find((f) => f.id === id)?.name

  it('opens the field with the name without its extension and saves on Enter', () => {
    render(<FilesView activeProjectId="p3" />)
    fireEvent.click(within(row('IMG_1422.jpg')).getByRole('button', { name: 'Renomear' }))
    const input = screen.getByRole('textbox', { name: 'Novo nome do arquivo' }) as HTMLInputElement
    expect(input.value).toBe('IMG_1422')
    expect(screen.getByText('.jpg')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Conta de luz' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(nameOf('r1')).toBe('Conta de luz.jpg')
    expect(screen.getByText('Conta de luz.jpg')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Novo nome do arquivo' })).toBeNull()
  })

  it('cancels on Escape without saving', () => {
    render(<FilesView activeProjectId="p3" />)
    fireEvent.click(within(row('IMG_1422.jpg')).getByRole('button', { name: 'Renomear' }))
    const input = screen.getByRole('textbox', { name: 'Novo nome do arquivo' })
    fireEvent.change(input, { target: { value: 'Outro' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(nameOf('r1')).toBe('IMG_1422.jpg')
    expect(screen.getByText('IMG_1422.jpg')).toBeTruthy()
  })

  it('shows the error and keeps the field open for a name taken in the project', () => {
    render(<FilesView activeProjectId="p3" />)
    fireEvent.click(within(row('IMG_1422.jpg')).getByRole('button', { name: 'Renomear' }))
    const input = screen.getByRole('textbox', { name: 'Novo nome do arquivo' })
    fireEvent.change(input, { target: { value: 'recibo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert').textContent).toBe('Já existe um arquivo com esse nome aqui.')
    expect(nameOf('r1')).toBe('IMG_1422.jpg')
    expect(screen.getByRole('textbox', { name: 'Novo nome do arquivo' })).toBeTruthy()
  })
})
