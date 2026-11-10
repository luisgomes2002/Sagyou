import { emptyState, type MobileState } from '../../data/state'
import { T, project } from '../../__tests__/seed'
import {
  ALL_FILTER,
  allTaskSections,
  boardSections,
  defaultFilter,
  filterChipLabel,
  filterKey,
  matchesFilter,
  openCountText,
  priorityOptions,
  readFilter,
  sprintOptions,
  tagOptions,
  writeFilter,
  type TaskFilter
} from '../taskFilters'

type TaskT = MobileState['tasks'][number]

const task = (id: string, over: Partial<TaskT> = {}): TaskT =>
  ({
    id,
    projectId: 'p1',
    columnId: 'p1-todo',
    title: id,
    priority: 'medium',
    tags: [],
    order: 0,
    createdAt: T,
    updatedAt: T,
    ...over
  }) as TaskT

function state(): MobileState {
  return {
    ...emptyState(),
    projects: [
      project('p1', 'Casa'),
      project('p2', 'Sagyou'),
      { ...project('p3', 'Velho'), archivedAt: T }
    ],
    sprints: [
      { id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 's2', projectId: 'p1', name: 'Sprint 2', createdAt: '2026-10-08T00:00:00.000Z' },
      {
        id: 's0',
        projectId: 'p1',
        name: 'Antiga',
        createdAt: '2026-09-01T00:00:00.000Z',
        closedAt: T
      }
    ],
    tasks: [
      task('a', { sprintId: 's2', priority: 'high', tags: ['casa'], order: 2 }),
      task('b', { sprintId: 's1', tags: ['mercado', 'casa'], order: 1 }),
      task('c', { order: 0 }),
      task('d', { columnId: 'p1-done', sprintId: 's2', tags: ['feito'] }),
      task('e', { projectId: 'p2', columnId: 'p2-todo', priority: 'urgent', tags: ['dev'] }),
      task('f', { projectId: 'p3', columnId: 'p3-todo', tags: ['velha'] })
    ]
  }
}

function memoryRepo(initial: Record<string, string> = {}): {
  readPref(key: string): string | null
  writePref(key: string, value: string | null): void
  prefs: Record<string, string>
} {
  const prefs = { ...initial }
  return {
    prefs,
    readPref: (key) => prefs[key] ?? null,
    writePref: (key, value) => {
      if (value === null) delete prefs[key]
      else prefs[key] = value
    }
  }
}

describe('filtro padrão e lembrado', () => {
  it('padrão: a sprint aberta mais recente; sem projeto ou sem sprint aberta, tudo', () => {
    const s = state()
    expect(defaultFilter(s, 'p1')).toEqual({ sprint: 's2', priority: 'all', tag: 'all' })
    expect(defaultFilter(s, 'p2')).toEqual(ALL_FILTER)
    expect(defaultFilter(s, null)).toEqual(ALL_FILTER)
    expect(ALL_FILTER).toEqual({ sprint: 'all', priority: 'all', tag: 'all' })
  })

  it('chaves das preferências', () => {
    expect(filterKey('p1')).toBe('tasks.filter.p1')
    expect(filterKey(null)).toBe('tasks.filter.all')
  })

  it('sem preferência usa o padrão; gravar e ler devolve o mesmo filtro', () => {
    const s = state()
    const repo = memoryRepo()
    expect(readFilter(repo, s, 'p1')).toEqual(defaultFilter(s, 'p1'))
    const chosen: TaskFilter = { sprint: 'none', priority: 'high', tag: 'casa' }
    writeFilter(repo, 'p1', chosen)
    expect(JSON.parse(repo.prefs['tasks.filter.p1'])).toEqual(chosen)
    expect(readFilter(repo, s, 'p1')).toEqual(chosen)
  })

  it('valor ilegível vira Todas', () => {
    const repo = memoryRepo({ 'tasks.filter.p1': '{não é json' })
    expect(readFilter(repo, state(), 'p1')).toEqual(ALL_FILTER)
  })

  it('campo ausente ou de tipo errado vira Todas naquele campo', () => {
    const repo = memoryRepo({ 'tasks.filter.p1': JSON.stringify({ sprint: 5, tag: 'casa' }) })
    expect(readFilter(repo, state(), 'p1')).toEqual({
      sprint: 'all',
      priority: 'all',
      tag: 'casa'
    })
  })

  it('sprint encerrada ou apagada volta para a sprint padrão; tag sumida e prioridade inválida viram Todas', () => {
    const s = state()
    for (const sprint of ['s0', 'nao-existe']) {
      const repo = memoryRepo({
        'tasks.filter.p1': JSON.stringify({ sprint, priority: 'xyz', tag: 'sumiu' })
      })
      expect(readFilter(repo, s, 'p1')).toEqual({ sprint: 's2', priority: 'all', tag: 'all' })
    }
  })

  it('em Todas, a sprint é sempre Todas e a tag é validada pelas tarefas abertas', () => {
    const repo = memoryRepo({
      'tasks.filter.all': JSON.stringify({ sprint: 's2', priority: 'urgent', tag: 'feito' })
    })
    expect(readFilter(repo, state(), null)).toEqual({
      sprint: 'all',
      priority: 'urgent',
      tag: 'all'
    })
  })
})

describe('quais tarefas passam', () => {
  it('sprint, Sem sprint, prioridade e tag', () => {
    const [a, b, c] = state().tasks
    expect(matchesFilter(a, { ...ALL_FILTER, sprint: 's2' })).toBe(true)
    expect(matchesFilter(b, { ...ALL_FILTER, sprint: 's2' })).toBe(false)
    expect(matchesFilter(c, { ...ALL_FILTER, sprint: 'none' })).toBe(true)
    expect(matchesFilter(a, { ...ALL_FILTER, sprint: 'none' })).toBe(false)
    expect(matchesFilter(a, { ...ALL_FILTER, priority: 'high' })).toBe(true)
    expect(matchesFilter(b, { ...ALL_FILTER, priority: 'high' })).toBe(false)
    expect(matchesFilter(b, { ...ALL_FILTER, tag: 'mercado' })).toBe(true)
    expect(matchesFilter(a, { ...ALL_FILTER, tag: 'mercado' })).toBe(false)
  })
})

describe('seções', () => {
  it('projeto: uma seção por coluna, Done no fim, ordem do quadro, filtro em todas', () => {
    const s = state()
    const all = boardSections(s, 'p1', ALL_FILTER)
    expect(all.map((x) => [x.column.name, x.done, x.tasks.map((t) => t.id)])).toEqual([
      ['A fazer', false, ['c', 'b', 'a']],
      ['Done', true, ['d']]
    ])
    const filtered = boardSections(s, 'p1', { ...ALL_FILTER, sprint: 's2' })
    expect(filtered.map((x) => x.tasks.map((t) => t.id))).toEqual([['a'], ['d']])
  })

  it('todas: abertas, por projeto, sem arquivados e sem projeto vazio', () => {
    const s = state()
    expect(
      allTaskSections(s, ALL_FILTER).map((x) => [x.project.name, x.tasks.map((t) => t.id)])
    ).toEqual([
      ['Casa', ['c', 'b', 'a']],
      ['Sagyou', ['e']]
    ])
    expect(
      allTaskSections(s, { ...ALL_FILTER, priority: 'urgent' }).map((x) => x.project.name)
    ).toEqual(['Sagyou'])
  })
})

describe('opções e rótulos', () => {
  it('sprint: Todas, Sem sprint e as abertas da mais nova para a mais antiga', () => {
    expect(sprintOptions(state(), 'p1')).toEqual([
      { value: 'all', label: 'Todas' },
      { value: 'none', label: 'Sem sprint' },
      { value: 's2', label: 'Sprint 2' },
      { value: 's1', label: 'Sprint 1' }
    ])
  })

  it('prioridade e tag', () => {
    expect(priorityOptions().map((o) => o.label)).toEqual([
      'Todas',
      'Urgente',
      'Alta',
      'Média',
      'Baixa'
    ])
    expect(tagOptions(state().tasks.slice(0, 4))).toEqual([
      { value: 'all', label: 'Todas' },
      { value: 'casa', label: 'casa' },
      { value: 'feito', label: 'feito' },
      { value: 'mercado', label: 'mercado' }
    ])
  })

  it('rótulos dos chips', () => {
    const s = state()
    expect(filterChipLabel('sprint', ALL_FILTER, s)).toBe('Sprint: Todas')
    expect(filterChipLabel('sprint', { ...ALL_FILTER, sprint: 'none' }, s)).toBe(
      'Sprint: Sem sprint'
    )
    expect(filterChipLabel('sprint', { ...ALL_FILTER, sprint: 's2' }, s)).toBe('Sprint: Sprint 2')
    expect(filterChipLabel('priority', ALL_FILTER, s)).toBe('Prioridade: Todas')
    expect(filterChipLabel('priority', { ...ALL_FILTER, priority: 'high' }, s)).toBe(
      'Prioridade: Alta'
    )
    expect(filterChipLabel('tag', ALL_FILTER, s)).toBe('Tag: Todas')
    expect(filterChipLabel('tag', { ...ALL_FILTER, tag: 'casa' }, s)).toBe('Tag: casa')
  })

  it('contador de abertas', () => {
    expect(openCountText(1)).toBe('1 aberta')
    expect(openCountText(12)).toBe('12 abertas')
    expect(openCountText(0)).toBe('0 abertas')
  })
})
