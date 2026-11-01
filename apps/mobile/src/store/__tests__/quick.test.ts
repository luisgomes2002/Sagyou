import { emptyState, type MobileState } from '../../data/state'
import { T, project, table } from '../../__tests__/seed'
import { dueChoice, quickProject, quickTable, quickTaskTarget } from '../quick'

function state(partial: Partial<MobileState>): MobileState {
  return { ...emptyState(), ...partial }
}

describe('padrões do criar rápido', () => {
  const ativo = project('p1', 'Sagyou', undefined, { order: 1 })
  const primeiro = project('p0', 'Casa', undefined, { order: 0 })
  const arquivado = project('pa', 'Velho', undefined, { archivedAt: T } as never)

  it('usa o projeto do pref quando ele está ativo', () => {
    expect(quickProject(state({ projects: [primeiro, ativo] }), 'p1')?.id).toBe('p1')
  })

  it('pref de projeto arquivado ou inexistente cai no primeiro ativo pela ordem', () => {
    const s = state({ projects: [ativo, arquivado, primeiro] })
    expect(quickProject(s, 'pa')?.id).toBe('p0')
    expect(quickProject(s, 'sumiu')?.id).toBe('p0')
    expect(quickProject(s, null)?.id).toBe('p0')
  })

  it('sem projetos não há destino', () => {
    expect(quickProject(state({}), 'p1')).toBeUndefined()
  })

  it('cria na primeira coluna que não é Done, pela ordem', () => {
    const p = project('p1', 'Sagyou', [
      { id: 'done', name: 'Done', order: 0 },
      { id: 'todo', name: 'A Fazer', order: 1 }
    ])
    expect(quickTaskTarget(state({ projects: [p] }), 'p1')).toEqual({ columnId: 'todo' })
  })

  it('só com Done, cria em Done; sem colunas, não cria', () => {
    const soDone = project('p1', 'Sagyou', [{ id: 'done', name: 'Done', order: 0 }])
    expect(quickTaskTarget(state({ projects: [soDone] }), 'p1')).toEqual({ columnId: 'done' })
    const vazio = project('p2', 'Vazio', [])
    expect(quickTaskTarget(state({ projects: [vazio] }), 'p2')).toBeNull()
  })

  it('usa a sprint aberta mais recente e ignora a fechada', () => {
    const s = state({
      projects: [ativo],
      sprints: [
        { id: 's1', projectId: 'p1', name: 'S1', createdAt: '2026-10-01T00:00:00.000Z' },
        {
          id: 's2',
          projectId: 'p1',
          name: 'S2',
          createdAt: '2026-10-20T00:00:00.000Z',
          closedAt: '2026-10-25T00:00:00.000Z'
        }
      ]
    })
    expect(quickTaskTarget(s, 'p1')).toEqual({ columnId: 'p1-todo', sprintId: 's1' })
  })

  it('tabela do pref de outro perfil nunca é escolhida', () => {
    const s = state({
      lists: [
        table('outra', 'Outra', 'trabalho'),
        table('conta', 'Conta'),
        table('cartao', 'Cartão')
      ]
    })
    expect(quickTable(s, 'personal', 'outra')?.id).toBe('conta')
    expect(quickTable(s, 'personal', 'cartao')?.id).toBe('cartao')
    expect(quickTable(s, 'nenhum', null)).toBeUndefined()
  })

  it('Hoje e Amanhã viram a data local', () => {
    const today = new Date(2026, 10, 1, 23, 30)
    expect(dueChoice('today', today)).toBe('2026-11-01')
    expect(dueChoice('tomorrow', today)).toBe('2026-11-02')
  })
})
