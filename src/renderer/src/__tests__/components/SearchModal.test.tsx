import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSearchHit, GlobalSearchResponse } from '../../../../main/global-search-query'
import { SearchModal } from '../../components/modals/SearchModal'

const { search } = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../../store/kanban', () => ({
  useKanbanStore: (select: (state: unknown) => unknown) =>
    select({
      projects: [{ id: 'p1', name: 'Projeto Um', archivedAt: undefined }],
      activeFinancialProfileId: 'personal'
    })
}))

function hit(type: GlobalSearchHit['type'], id: string, title: string): GlobalSearchHit {
  return {
    type,
    id,
    title,
    snippet: `Trecho de ${title}`,
    matchedField: 'content',
    projectId: type === 'task' ? 'p1' : null,
    profileId: type === 'transaction' ? 'personal' : null,
    tableId: null,
    projectArchived: false,
    memoryArchived: false,
    completed: false,
    state: null,
    date: null
  }
}

function page(
  results: GlobalSearchHit[],
  total = results.length,
  offset = 0
): GlobalSearchResponse {
  return { results, total, offset, limit: 30, hasMore: offset + results.length < total }
}

beforeEach(() => {
  search.mockReset()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { search: { global: search } }
  })
})
afterEach(cleanup)

describe('global search modal', () => {
  it('groups IPC results and opens the selected hit with arrows and Enter', async () => {
    search.mockResolvedValue(
      page([hit('transaction', 'tx1', 'Mercado'), hit('task', 't1', 'Planejar compra')])
    )
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<SearchModal open onSelect={onSelect} onClose={onClose} />)
    const input = await screen.findByRole('combobox', { name: 'Buscar em todo o aplicativo' })
    await user.type(input, 'compra')
    await screen.findByRole('option', { name: /Planejar compra/ })
    const list = screen.getByRole('listbox')
    expect(within(list).getByRole('group', { name: 'Projetos e tarefas' })).toBeInTheDocument()
    expect(within(list).getByRole('group', { name: 'Finanças' })).toBeInTheDocument()
    expect(screen.getByText('Trecho de Planejar compra')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', 'global-search-result-1')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', 'global-search-result-0')
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transaction', id: 'tx1' })
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('passes type and project filters to IPC and offers more matches', async () => {
    search.mockImplementation(async (options: { offset?: number }) =>
      options.offset
        ? page([hit('task', 't2', 'Segunda tarefa')], 31, 30)
        : page([hit('task', 't1', 'Primeira tarefa')], 31)
    )
    const user = userEvent.setup()
    render(<SearchModal open onSelect={vi.fn()} onClose={vi.fn()} />)
    await user.type(
      await screen.findByRole('combobox', { name: 'Buscar em todo o aplicativo' }),
      'tarefa'
    )
    await screen.findByText('Primeira tarefa')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'task')
    await user.selectOptions(screen.getByLabelText('Projeto'), 'p1')
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          types: ['task'],
          projectId: 'p1',
          offset: 0
        })
      )
    )
    await screen.findByText('Primeira tarefa')
    await user.click(screen.getByRole('button', { name: 'Mostrar mais (30)' }))
    await screen.findByText('Segunda tarefa')
    expect(screen.getByText('2 de 31 resultados')).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<SearchModal open onSelect={vi.fn()} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not display a financial hit from another profile', async () => {
    search.mockResolvedValue(
      page([
        { ...hit('transaction', 'foreign', 'Conta privada'), profileId: 'business' },
        hit('task', 't1', 'Conta de trabalho')
      ])
    )
    const user = userEvent.setup()
    render(<SearchModal open onSelect={vi.fn()} onClose={vi.fn()} />)
    await user.type(
      await screen.findByRole('combobox', { name: 'Buscar em todo o aplicativo' }),
      'conta'
    )
    await screen.findByText('Conta de trabalho')
    expect(screen.queryByText('Conta privada')).not.toBeInTheDocument()
  })
})
