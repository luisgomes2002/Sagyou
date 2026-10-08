import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Project, Task, Sprint } from '../../types'
import { DoneView } from '../../components/views/DoneView'

const now = '2026-10-08T10:00:00.000Z'
const project = (id: string): Project => ({
  id,
  name: `Projeto ${id}`,
  color: '#7c3aed',
  columns: [{ id: `${id}-done`, name: 'Done', order: 0 }],
  createdAt: now,
  updatedAt: now
})
const task = (number: number, projectId: string, sprintId?: string): Task => ({
  id: `task-${number}`,
  projectId,
  columnId: `${projectId}-done`,
  title: `Tarefa ${number}`,
  priority: 'low',
  tags: [],
  order: number,
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  ...(sprintId ? { sprintId } : {})
})

describe('DoneView pagination', () => {
  it('shows 25 tasks per page while preserving project and sprint groups', async () => {
    const projects = [project('a'), project('b'), project('c')]
    const tasks = [
      ...Array.from({ length: 20 }, (_, index) => task(index + 1, 'a', 'sprint-a')),
      ...Array.from({ length: 8 }, (_, index) => task(index + 21, 'b')),
      ...Array.from({ length: 3 }, (_, index) => task(index + 29, 'c'))
    ]
    const sprints: Sprint[] = [
      {
        id: 'sprint-a',
        projectId: 'a',
        name: 'Sprint A',
        createdAt: now
      }
    ]
    const props = {
      projects,
      tasks,
      sprints,
      sprintFilter: null,
      onViewTask: vi.fn(),
      onRestoreTask: vi.fn(),
      onDeleteTask: vi.fn()
    }
    const { rerender } = render(<DoneView {...props} />)

    expect(screen.getByText('Tarefa 1')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 25')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa 26')).not.toBeInTheDocument()
    expect(screen.getAllByText('Página 1 de 2')).toHaveLength(2)
    expect(screen.queryByText('Tarefa 29')).not.toBeInTheDocument()
    expect(screen.getAllByText('Exibindo 1–25 de 31')).toHaveLength(2)

    await userEvent.click(screen.getAllByRole('button', { name: 'Próxima' })[0])
    expect(screen.queryByText('Tarefa 25')).not.toBeInTheDocument()
    expect(screen.getByText('Tarefa 26')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 28')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 31')).toBeInTheDocument()
    expect(screen.getAllByText('Página 2 de 2')).toHaveLength(2)

    rerender(<DoneView {...props} tasks={tasks.slice(0, 25)} />)
    expect(screen.getByText('Tarefa 1')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa 26')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Paginação das tarefas concluídas' })
    ).not.toBeInTheDocument()

    rerender(<DoneView {...props} sprintFilter="sprint-a" />)
    expect(screen.getByText('Tarefa 20')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa 21')).not.toBeInTheDocument()
  })
})
