import { fireEvent, render, screen } from '@testing-library/react-native'
import { emptyState, type MobileState } from '../../data/state'
import { type AppServices, useApp } from '../../store/app'
import { NEW_SPRINT, TaskForm } from '../tasks/TaskForm'
import { UpcomingList } from '../tasks/TaskLists'

const T = '2026-10-01T00:00:00.000Z'

function seed(extra: Partial<MobileState> = {}): void {
  const state = emptyState()
  state.projects = [
    {
      id: 'p1',
      name: 'Sagyou',
      color: '#6366f1',
      order: 0,
      createdAt: T,
      updatedAt: T,
      columns: [
        { id: 'todo', name: 'A fazer', order: 0 },
        { id: 'done', name: 'Done', order: 1 }
      ]
    } as unknown as MobileState['projects'][number]
  ]
  state.sprints = [
    { id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 's2', projectId: 'p1', name: 'Sprint 2', createdAt: '2026-10-15T00:00:00.000Z' }
  ]
  useApp.setState({
    state: { ...state, ...extra },
    readOnly: false,
    services: {
      repo: { save: jest.fn() },
      runtime: { engine: { notifySaved: jest.fn() } }
    } as unknown as AppServices
  })
}

const task = (id: string, dueDate: string): MobileState['tasks'][number] => ({
  id,
  projectId: 'p1',
  columnId: 'todo',
  title: id,
  priority: 'medium',
  tags: [],
  order: 0,
  createdAt: T,
  updatedAt: T,
  dueDate
})

describe('tarefas no celular', () => {
  it('a sprint vem preenchida com a aberta mais recente', async () => {
    seed()
    await render(<TaskForm projectId="p1" onDone={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Sprint 2' })).toBeSelected()
    expect(screen.getByRole('button', { name: 'Sprint 1' })).not.toBeSelected()
  })

  it('"Nova sprint…" cria a sprint e a seleciona', async () => {
    seed()
    await render(<TaskForm projectId="p1" onDone={jest.fn()} />)
    await fireEvent.press(screen.getByRole('button', { name: NEW_SPRINT }))
    await fireEvent.changeText(screen.getByLabelText('Nome da sprint'), 'Sprint 3')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar sprint' }))
    expect(useApp.getState().state.sprints.map((s) => s.name)).toContain('Sprint 3')
    expect(screen.getByRole('button', { name: 'Sprint 3' })).toBeSelected()
  })

  it('salvar cria a tarefa na sprint escolhida e volta', async () => {
    seed()
    const onDone = jest.fn()
    await render(<TaskForm projectId="p1" onDone={onDone} />)
    await fireEvent.changeText(screen.getByLabelText('Título'), 'Comprar pão')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.tasks).toEqual([
      expect.objectContaining({ title: 'Comprar pão', sprintId: 's2', columnId: 'todo' })
    ])
    expect(onDone).toHaveBeenCalled()
  })

  it('Próximas: vencida primeiro, e a de daqui a 30 dias também aparece', async () => {
    seed({
      tasks: [
        task('daqui-30-dias', '2026-11-30'),
        task('amanha', '2026-11-01'),
        task('vencida', '2026-10-20')
      ]
    })
    await render(<UpcomingList onOpenTask={jest.fn()} today="2026-10-31" />)
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'vencida',
      'amanha',
      'daqui-30-dias'
    ])
  })
})
