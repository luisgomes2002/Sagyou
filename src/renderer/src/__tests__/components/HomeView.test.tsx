import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HomeView } from '../../components/views/HomeView'

const dashboard = vi.hoisted(() => ({
  tasks: [],
  sprints: [],
  habits: [],
  goals: [],
  lists: [
    {
      id: 'table-1',
      profileId: 'personal',
      name: 'Conta principal',
      currency: 'BRL',
      transactions: []
    },
    { id: 'table-2', profileId: 'personal', name: 'Reserva', currency: 'BRL', transactions: [] }
  ],
  financialProfiles: [{ id: 'personal', name: 'Minhas finanças' }],
  activeFinancialProfileId: 'personal',
  setActiveFinancialProfile: vi.fn()
}))

vi.mock('../../store/kanban', () => ({
  useKanbanStore: (selector: (state: typeof dashboard) => unknown) => selector(dashboard)
}))

vi.mock('../../store/aiRun', () => ({
  useAiRunStore: (selector: (state: { running: Set<string> }) => unknown) =>
    selector({ running: new Set() })
}))

describe('Tabela financeira da Home', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restaura a última tabela escolhida ao reabrir a Home', () => {
    const first = render(<HomeView projects={[]} onNavigate={vi.fn()} />)
    const select = screen.getByRole('combobox', { name: 'Tabela financeira do dashboard' })

    fireEvent.change(select, { target: { value: 'table-2' } })
    expect(select).toHaveValue('table-2')

    first.unmount()
    render(<HomeView projects={[]} onNavigate={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Tabela financeira do dashboard' })).toHaveValue(
      'table-2'
    )
  })

  it('mostra o consolidado quando a tabela salva foi removida', () => {
    localStorage.setItem('sagyou-home-financial-table:personal', 'deleted-table')

    render(<HomeView projects={[]} onNavigate={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Tabela financeira do dashboard' })).toHaveValue(
      '__consolidated__'
    )
  })
})
