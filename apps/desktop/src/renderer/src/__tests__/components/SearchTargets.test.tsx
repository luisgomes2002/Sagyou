import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoalView } from '../../components/views/GoalView'
import { HabitView } from '../../components/views/HabitView'
import { FilesView } from '../../components/views/FilesView'

const { state } = vi.hoisted(() => ({
  state: {
    goals: [
      { id: 'g1', title: 'Primeira meta', target: 10, entries: [], projectId: 'p1' },
      { id: 'g2', title: 'Meta procurada', target: 10, entries: [], projectId: 'p1' }
    ],
    habits: [
      { id: 'h1', name: 'Primeiro hábito', completions: [] },
      { id: 'h2', name: 'Hábito procurado', completions: [] }
    ],
    files: [
      {
        id: 'f1',
        name: 'Primeiro.pdf',
        ext: '.pdf',
        size: 10,
        createdAt: '2026-10-01',
        projectId: 'p1'
      },
      {
        id: 'f2',
        name: 'Procurado.pdf',
        ext: '.pdf',
        size: 10,
        createdAt: '2026-10-02',
        projectId: 'p1'
      },
      {
        id: 'f3',
        name: 'Geral.pdf',
        ext: '.pdf',
        size: 10,
        createdAt: '2026-10-03'
      }
    ],
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    addGoalEntry: vi.fn(),
    deleteGoalEntry: vi.fn(),
    createHabit: vi.fn(),
    updateHabit: vi.fn(),
    deleteHabit: vi.fn(),
    toggleHabit: vi.fn(),
    addFiles: vi.fn(),
    removeFile: vi.fn()
  }
}))

vi.mock('../../store/kanban', () => ({
  useKanbanStore: (select: (value: typeof state) => unknown) => select(state)
}))
vi.mock('../../components/GoalCard', () => ({
  GoalCard: ({ goal }: { goal: { title: string } }) => <div>{goal.title}</div>
}))
vi.mock('../../components/HabitCard', () => ({
  HabitCard: ({ habit }: { habit: { name: string } }) => <div>{habit.name}</div>
}))

afterEach(cleanup)

describe('search destinations', () => {
  it('highlights the requested goal instead of another card', () => {
    render(<GoalView projects={[{ id: 'p1', name: 'Projeto' } as never]} searchTargetId="g2" />)
    expect(screen.getByText('Meta procurada').closest('.ring-2')).toBeInTheDocument()
    expect(screen.getByText('Primeira meta').closest('.ring-2')).toBeNull()
  })

  it('highlights the requested habit', () => {
    render(<HabitView searchTargetId="h2" />)
    expect(screen.getByText('Hábito procurado').closest('.ring-2')).toBeInTheDocument()
    expect(screen.getByText('Primeiro hábito').closest('.ring-2')).toBeNull()
  })

  it('highlights the file in its project', () => {
    render(<FilesView activeProjectId="p1" searchTargetId="f2" />)
    expect(screen.getByText('Procurado.pdf').closest('.ring-2')).toBeInTheDocument()
    expect(screen.getByText('Primeiro.pdf').closest('.ring-2')).toBeNull()
  })

  it('shows a global file without an active project', () => {
    render(<FilesView activeProjectId={null} searchTargetId="f3" />)
    expect(screen.getByText('Geral.pdf').closest('.ring-2')).toBeInTheDocument()
    expect(screen.queryByText('Procurado.pdf')).not.toBeInTheDocument()
  })
})
