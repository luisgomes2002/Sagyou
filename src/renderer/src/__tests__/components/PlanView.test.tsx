import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PlanView } from '../../components/views/PlanView'
import { todayString } from '../../utils/planner'

const planner = vi.hoisted(() => ({
  timeBlocks: [] as unknown[],
  routines: [
    {
      id: 'routine-1',
      title: 'Academia',
      startTime: '07:00',
      endTime: '08:00',
      color: '#20b858',
      borderStyle: 'solid' as 'solid' | 'dashed',
      daysOfWeek: [new Date().getDay()],
      active: true
    }
  ],
  createTimeBlock: vi.fn(),
  updateTimeBlock: vi.fn(),
  deleteTimeBlock: vi.fn(),
  createRoutine: vi.fn(),
  updateRoutine: vi.fn(),
  deleteRoutine: vi.fn()
}))

vi.mock('../../store/kanban', () => ({
  useKanbanStore: Object.assign(
    (selector: (state: typeof planner) => unknown) => selector(planner),
    { getState: () => planner }
  )
}))

describe('Planejamento', () => {
  beforeEach(() => {
    planner.timeBlocks = []
    planner.routines.splice(1)
    planner.routines[0].daysOfWeek = [new Date().getDay()]
    planner.routines[0].borderStyle = 'solid'
    planner.createTimeBlock.mockClear()
    planner.createRoutine.mockClear()
    planner.updateRoutine.mockClear()
  })

  it('cria um bloco a partir de uma rotina com cor e borda escolhidas', () => {
    render(<PlanView />)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar bloco às 09:00' }))
    expect(planner.createTimeBlock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Criar a partir de'), {
      target: { value: 'routine-1' }
    })
    expect(screen.getByPlaceholderText('Nome do bloco')).toHaveValue('Academia')

    fireEvent.click(screen.getByRole('button', { name: 'Pontilhada' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar bloco' }))

    expect(planner.createTimeBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Academia',
        startTime: '07:00',
        endTime: '08:00',
        color: '#20b858',
        borderStyle: 'dashed',
        type: 'routine'
      })
    )
  })

  it('oferece apenas rotinas do dia e aplica a borda da rotina ao bloco', () => {
    planner.routines[0].borderStyle = 'dashed'
    planner.routines.push({
      ...planner.routines[0],
      id: 'other-day',
      title: 'Outro dia',
      daysOfWeek: [(new Date().getDay() + 1) % 7]
    })

    render(<PlanView />)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar bloco às 09:00' }))

    expect(screen.getByRole('option', { name: /Academia/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Outro dia/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Criar a partir de'), {
      target: { value: 'routine-1' }
    })
    expect(screen.getByRole('button', { name: 'Pontilhada' })).toHaveClass('border-[#7c3aed]')
    fireEvent.click(screen.getByRole('button', { name: 'Criar bloco' }))
    expect(planner.createTimeBlock).toHaveBeenCalledWith(
      expect.objectContaining({ borderStyle: 'dashed' })
    )
  })

  it('salva a borda escolhida ao criar uma rotina', () => {
    render(<PlanView />)
    fireEvent.click(screen.getByRole('button', { name: 'Rotinas' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Nova' }))
    fireEvent.change(screen.getByPlaceholderText('Nome da rotina (ex: Academia)'), {
      target: { value: 'Leitura' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Seg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pontilhada' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar rotina' }))

    expect(planner.createRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Leitura', borderStyle: 'dashed', daysOfWeek: [1] })
    )
  })

  it('mostra o bloco em grafite com cor no horário nas visões diária e semanal', () => {
    planner.timeBlocks = [
      {
        id: 'block-1',
        date: todayString(),
        title: 'Academia',
        startTime: '07:00',
        endTime: '08:00',
        color: '#7c3aed',
        borderStyle: 'dashed',
        type: 'routine',
        order: 0
      }
    ]

    render(<PlanView />)
    const dayBlock = screen.getByText('Academia').closest('div[style*="background-color"]')
    expect(dayBlock).toHaveStyle({
      backgroundColor: '#16161a',
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderColor: '#3b3b42'
    })
    expect(screen.getByText('07:00–08:00')).toHaveStyle({ color: '#7c3aed' })

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }))
    const weekBlock = screen.getByText('Academia').closest('div[style*="background-color"]')
    expect(weekBlock).toHaveStyle({
      backgroundColor: '#16161a',
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderColor: '#3b3b42'
    })
  })

  it('deixa visíveis dois blocos consecutivos de dez minutos nas visões diária e semanal', () => {
    planner.timeBlocks = [
      {
        id: 'short-1',
        date: todayString(),
        title: 'Curta A',
        startTime: '10:00',
        endTime: '10:10',
        color: '#7c3aed',
        type: 'custom',
        order: 0
      },
      {
        id: 'short-2',
        date: todayString(),
        title: 'Curta B',
        startTime: '10:10',
        endTime: '10:20',
        color: '#20b858',
        type: 'custom',
        order: 1
      }
    ]

    render(<PlanView />)
    for (const mode of ['Dia', 'Semana']) {
      if (mode === 'Semana') fireEvent.click(screen.getByRole('button', { name: mode }))
      const first = screen
        .getByText('Curta A')
        .closest('div[style*="background-color"]') as HTMLElement
      const second = screen
        .getByText('Curta B')
        .closest('div[style*="background-color"]') as HTMLElement
      expect(
        Number.parseFloat(first.style.top) + Number.parseFloat(first.style.height)
      ).toBeLessThan(Number.parseFloat(second.style.top))
    }
  })
})
