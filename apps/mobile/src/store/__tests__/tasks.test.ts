import { SPRINT_NAME_TAKEN } from '@sagyou/core/sprints'
import { emptyState, type MobileState } from '../../data/state'
import {
  UPCOMING_SECTION_TITLES,
  completeTask,
  createSprint,
  createTask,
  moveTask,
  projectProgress,
  revertCompletion,
  todaySummary,
  todayText,
  updateTask,
  upcomingSections
} from '../tasks'

type TaskT = MobileState['tasks'][number]

const due = (id: string, dueDate: string, columnId = 'todo'): TaskT =>
  ({
    id,
    projectId: 'p1',
    columnId,
    title: id,
    priority: 'medium',
    tags: [],
    order: 0,
    createdAt: T,
    updatedAt: T,
    dueDate
  }) as TaskT

describe('Próximas e resumo de hoje', () => {
  // 2026-11-04 is a Wednesday; that week ends on Sunday 2026-11-08.
  const WED = '2026-11-04'

  it('agrupa em Atrasadas, Hoje, Amanhã, Esta semana e Mais tarde', () => {
    const s = state()
    s.tasks = [
      due('ontem', '2026-11-03'),
      due('hoje', '2026-11-04'),
      due('amanha', '2026-11-05'),
      due('sexta', '2026-11-06'),
      due('domingo', '2026-11-08'),
      due('segunda', '2026-11-09'),
      due('feita', '2026-11-04', 'done')
    ]
    const sections = upcomingSections(s.tasks, s.projects, WED)
    expect(sections.map((x) => [x.key, x.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['ontem']],
      ['today', ['hoje']],
      ['tomorrow', ['amanha']],
      ['week', ['sexta', 'domingo']],
      ['later', ['segunda']]
    ])
    expect(UPCOMING_SECTION_TITLES).toEqual({
      overdue: 'Atrasadas',
      today: 'Hoje',
      tomorrow: 'Amanhã',
      week: 'Esta semana',
      later: 'Mais tarde'
    })
  })

  it('num domingo não há "Esta semana" e as seções vazias somem', () => {
    const s = state()
    s.tasks = [due('terca', '2026-11-10')]
    expect(upcomingSections(s.tasks, s.projects, '2026-11-08').map((x) => x.key)).toEqual(['later'])
  })

  it('conta o que vence hoje e o que está atrasado', () => {
    const s = state()
    s.tasks = [due('a', '2026-11-04'), due('b', '2026-11-03'), due('c', '2026-11-05')]
    expect(todaySummary(s.tasks, s.projects, WED)).toEqual({ today: 1, overdue: 1 })
    expect(todayText({ today: 3, overdue: 1 })).toBe('3 para hoje · 1 atrasada')
    expect(todayText({ today: 0, overdue: 2 })).toBe('2 atrasadas')
    expect(todayText({ today: 1, overdue: 0 })).toBe('1 para hoje')
    expect(todayText({ today: 0, overdue: 0 })).toBe('Nada vence hoje')
  })

  it('progresso do projeto conta Done pelo nome da coluna', () => {
    const s = state()
    s.tasks = [due('a', '2026-11-04'), due('b', '2026-11-04', 'done'), due('c', '2026-11-04')]
    expect(projectProgress(s, 'p1')).toEqual({ open: 2, done: 1, total: 3 })
  })
})

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

  it('desfazer a conclusão volta coluna, ordem e conclusão e mantém o resto', () => {
    const before = state().tasks[0]
    const done = completeTask(state(), 't1', NOW)
    // A remote edit lands on the same task while the notice is up.
    const edited = updateTask(done, 't1', { title: 'Título do PC' }, NOW)
    const back = revertCompletion(edited, before, new Date('2026-10-31T12:00:05.000Z'))
    expect(back.tasks[0]).toMatchObject({
      columnId: 'todo',
      order: 0,
      title: 'Título do PC',
      timeSpent: 3600,
      updatedAt: '2026-10-31T12:00:05.000Z'
    })
    expect(back.tasks[0].completedAt).toBeUndefined()
    expect(back.tasks[0].images).toEqual(before.images)
  })

  it('recusa sprint com nome repetido no projeto', () => {
    expect(createSprint(state(), 'p1', 'sprint 1', NOW)).toEqual({ error: SPRINT_NAME_TAKEN })
    const ok = createSprint(state(), 'p1', 'Sprint 2', NOW)
    if ('error' in ok) throw new Error(ok.error)
    expect(ok.state.sprints.find((s) => s.id === ok.sprintId)?.name).toBe('Sprint 2')
  })
})
