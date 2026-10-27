import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileImport } from '../../components/useFileImport'
import { useKanbanStore } from '../../store/kanban'
import type { StoredFile } from '../../types'

const existing = (name: string, projectId?: string): StoredFile => ({
  id: `old-${name}`,
  name,
  ext: name.slice(name.lastIndexOf('.')),
  size: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  projectId
})

const importMock = vi.fn(async (items: { token: string; name: string }[]) =>
  items.map((item) => ({
    id: `new-${item.token}`,
    name: item.name,
    ext: item.name.slice(item.name.lastIndexOf('.')),
    size: 1,
    createdAt: '2026-10-27T00:00:00.000Z'
  }))
)
const discardMock = vi.fn(async () => {})

let runImport: ReturnType<typeof useFileImport>['runImport']

function Harness({ projectId }: { projectId: string | null }) {
  const fileImport = useFileImport(projectId)
  runImport = fileImport.runImport
  return <>{fileImport.dialog}</>
}

const staged = (...names: string[]) => ({
  staged: names.map((name, i) => ({ token: `t${i}`, name, size: 1 })),
  skipped: 0,
  overLimit: 0
})

beforeEach(() => {
  importMock.mockClear()
  discardMock.mockClear()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    files: { import: importMock, discard: discardMock }
  }
  useKanbanStore.setState({
    files: [existing('relatorio.pdf', 'p1'), existing('foto.png', 'p1'), existing('nota.txt', 'p1')]
  })
})

describe('useFileImport', () => {
  it('imports files without duplicates directly and tags the project', async () => {
    render(<Harness projectId="p1" />)
    await act(async () => {
      await runImport(staged('novo.txt'))
    })
    expect(screen.queryByText('Arquivo já existe')).toBeNull()
    expect(importMock).toHaveBeenCalledWith([{ token: 't0', name: 'novo.txt' }])
    expect(useKanbanStore.getState().files.find((f) => f.id === 'new-t0')?.projectId).toBe('p1')
  })

  it('asks about a duplicate and skipping discards it', async () => {
    render(<Harness projectId="p1" />)
    let done!: Promise<StoredFile[]>
    act(() => {
      done = runImport(staged('novo.txt', 'Relatorio.pdf'))
    })
    expect(await screen.findByText('Arquivo já existe')).toBeInTheDocument()
    expect(
      screen.getByText('“Relatorio.pdf” já está neste projeto. Quer salvar outra cópia?')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/Aplicar aos próximos/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))
    await act(async () => {
      await done
    })
    expect(discardMock).toHaveBeenCalledWith(['t1'])
    expect(importMock).toHaveBeenCalledWith([{ token: 't0', name: 'novo.txt' }])
  })

  it('saves a copy under the next free name', async () => {
    render(<Harness projectId="p1" />)
    let done!: Promise<StoredFile[]>
    act(() => {
      done = runImport(staged('relatorio.pdf'))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar cópia' }))
    await act(async () => {
      await done
    })
    expect(importMock).toHaveBeenCalledWith([{ token: 't0', name: 'relatorio (2).pdf' }])
  })

  it('applies one decision to the remaining duplicates', async () => {
    render(<Harness projectId="p1" />)
    let done!: Promise<StoredFile[]>
    act(() => {
      done = runImport(staged('relatorio.pdf', 'foto.png', 'nota.txt'))
    })
    fireEvent.click(await screen.findByLabelText('Aplicar aos próximos (2)'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cópia' }))
    await act(async () => {
      await done
    })
    await waitFor(() => expect(screen.queryByText('Arquivo já existe')).toBeNull())
    expect(importMock).toHaveBeenCalledWith([
      { token: 't0', name: 'relatorio (2).pdf' },
      { token: 't1', name: 'foto (2).png' },
      { token: 't2', name: 'nota (2).txt' }
    ])
  })

  it('uses the general files as scope without a project', async () => {
    useKanbanStore.setState({ files: [existing('geral.pdf')] })
    render(<Harness projectId={null} />)
    let done!: Promise<StoredFile[]>
    act(() => {
      done = runImport(staged('geral.pdf'))
    })
    expect(
      await screen.findByText('“geral.pdf” já está nos arquivos gerais. Quer salvar outra cópia?')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))
    await act(async () => {
      expect(await done).toEqual([])
    })
    expect(importMock).not.toHaveBeenCalled()
  })
})
