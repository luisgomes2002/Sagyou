import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HomeView } from '../../components/views/HomeView'
import type { FinancialTransaction } from '../../types'

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
    {
      id: 'table-2',
      profileId: 'personal',
      name: 'Reserva',
      currency: 'BRL',
      transactions: [] as FinancialTransaction[]
    }
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

  afterEach(() => {
    dashboard.lists[1].currency = 'BRL'
    dashboard.lists[1].transactions = []
    vi.unstubAllGlobals()
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

  it('mostra na abertura o saldo acumulado até hoje mesmo sem registro no mês atual', () => {
    const year = new Date().getFullYear()
    dashboard.lists[1].transactions = [
      {
        id: 'past-income',
        description: 'Saldo anterior',
        amount: '100',
        type: 'income',
        date: `${year - 1}-01-01`
      },
      {
        id: 'future-expense',
        description: 'Pagamento agendado',
        amount: '40',
        type: 'expense',
        date: `${year + 1}-01-01`
      }
    ]
    localStorage.setItem('sagyou-home-financial-table:personal', 'table-2')

    render(<HomeView projects={[]} onNavigate={vi.fn()} />)

    expect(screen.getByText('Saldo até hoje')).toBeInTheDocument()
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument()
    expect(screen.queryByText('R$ 60,00')).not.toBeInTheDocument()
  })

  it('exibe o valor nativo da tabela em ienes mesmo com câmbio disponível', async () => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`
    dashboard.lists[1].currency = 'JPY'
    dashboard.lists[1].transactions = [
      {
        id: 'yen-income',
        description: 'Pagamento',
        amount: '20015',
        type: 'income',
        date: today
      }
    ]
    const fetchExchangeRate = vi.fn().mockResolvedValue({ rate: '0.03' })
    vi.stubGlobal('electronAPI', { financial: { fetchExchangeRate } })

    render(<HomeView projects={[]} onNavigate={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Tabela financeira do dashboard' }), {
      target: { value: 'table-2' }
    })

    await waitFor(() => expect(fetchExchangeRate).toHaveBeenCalledWith('JPY-BRL'))
    await waitFor(() => expect(screen.getAllByText('¥20.015').length).toBeGreaterThan(0))
    expect(screen.queryByText('¥600')).not.toBeInTheDocument()
  })
})
