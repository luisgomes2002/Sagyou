import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../types'

const mocks = vi.hoisted(() => ({
  state: {
    goals: [] as Goal[],
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    addGoalEntry: vi.fn(),
    deleteGoalEntry: vi.fn()
  }
}))

vi.mock('../../store/kanban', () => ({
  useKanbanStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('../../components/GoalCard', () => ({
  GoalCard: ({ goal }: { goal: Goal }) => <div>{goal.title}</div>
}))

import { GoalView } from '../../components/views/GoalView'

const goal = (id: string, title: string, done: boolean): Goal => ({
  id,
  title,
  entries: done
    ? [{ id: `${id}-entry`, date: '2026-10-21', value: 1, createdAt: '2026-10-21' }]
    : [],
  kind: 'completion',
  target: 1,
  unit: '',
  color: '#7c3aed',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01'
})

describe('GoalView', () => {
  it('mostra os filtros na ordem em progresso, todas e concluídas e abre no primeiro', () => {
    mocks.state.goals = [goal('active', 'Ler DDD', false), goal('done', 'Curso concluído', true)]
    render(<GoalView projects={[]} />)

    const filters = screen
      .getAllByRole('button')
      .filter((button) => /^(Em progresso|Todas|Concluídas)/.test(button.textContent ?? ''))
    expect(filters.map((button) => button.textContent)).toEqual([
      'Em progresso (1)',
      'Todas (2)',
      'Concluídas (1)'
    ])
    expect(screen.getByText('Ler DDD')).toBeInTheDocument()
    expect(screen.queryByText('Curso concluído')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Todas (2)' }))
    expect(screen.getByText('Curso concluído')).toBeInTheDocument()
  })

  it('mostra uma meta concluída quando ela é o destino da navegação', () => {
    mocks.state.goals = [goal('active', 'Ler DDD', false), goal('done', 'Curso concluído', true)]

    render(<GoalView projects={[]} searchTargetId="done" />)

    expect(screen.getByText('Curso concluído')).toBeInTheDocument()
  })
})
