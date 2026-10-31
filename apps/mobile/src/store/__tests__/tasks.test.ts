import { SPRINT_NAME_TAKEN } from '@sagyou/core/sprints'
import { emptyState, type MobileState } from '../../data/state'
import { completeTask, createSprint, createTask, moveTask, updateTask } from '../tasks'

const T = '2026-10-30T12:00:00.000Z'
const NOW = new Date('2026-10-31T12:00:00.000Z')

function state(): MobileState {
  const s = emptyState()
  s.projects = [
    {
      id: 'p1',
      name: 'Sagyou',
      color: '#000',
      order: 0,
      createdAt: T,
      updatedAt: T,
      columns: [
        { id: 'todo', name: 'A fazer', order: 0 },
        { id: 'done', name: 'Done', order: 1 }
      ]
    } as unknown as MobileState['projects'][number]
  ]
  s.tasks = [
    {
      id: 't1',
      projectId: 'p1',
      columnId: 'todo',
      title: 'Antes',
      priority: 'medium',
      tags: [],
      order: 0,
      createdAt: T,
      updatedAt: T,
      timeSpent: 3600,
      images: [{ id: 'img', name: 'a.png', ext: '.png', size: 1, addedAt: T }]
    } as MobileState['tasks'][number]
  ]
  s.sprints = [{ id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: T }]
  return s
}

describe('tarefas no celular', () => {
  it('editar só o título preserva imagens e tempo', () => {
    const next = updateTask(state(), 't1', { title: 'Depois' }, NOW)
    expect(next.tasks[0]).toMatchObject({
      title: 'Depois',
      timeSpent: 3600,
      updatedAt: NOW.toISOString()
    })
    expect(next.tasks[0].images).toEqual(state().tasks[0].images)
  })

  it('concluir move para a coluna Done e grava completedAt', () => {
    const next = completeTask(state(), 't1', NOW)
    expect(next.tasks[0]).toMatchObject({ columnId: 'done', completedAt: NOW.toISOString() })
  })

  it('sair da Done limpa completedAt', () => {
    const done = completeTask(state(), 't1', NOW)
    const back = moveTask(done, 't1', 'todo', NOW)
    expect(back.tasks[0].completedAt).toBeUndefined()
  })

  it('cria tarefa no fim da coluna, com a sprint escolhida', () => {
    const { state: next, id } = createTask(
      state(),
      { projectId: 'p1', columnId: 'todo', title: ' Nova ', sprintId: 's1' },
      NOW
    )
    expect(next.tasks.find((t) => t.id === id)).toMatchObject({
      title: 'Nova',
      order: 1,
      sprintId: 's1',
      priority: 'medium',
      tags: []
    })
  })

  it('recusa sprint com nome repetido no projeto', () => {
    expect(createSprint(state(), 'p1', 'sprint 1', NOW)).toEqual({ error: SPRINT_NAME_TAKEN })
    const ok = createSprint(state(), 'p1', 'Sprint 2', NOW)
    if ('error' in ok) throw new Error(ok.error)
    expect(ok.state.sprints.find((s) => s.id === ok.sprintId)?.name).toBe('Sprint 2')
  })
})
