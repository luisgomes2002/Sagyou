import { describe, expect, it } from 'vitest'
import { SPRINT_NAME_EMPTY, SPRINT_NAME_TAKEN, addSprint, latestOpenSprint } from '../sprints'
import type { Sprint } from '../types'

const now = new Date('2026-10-31T12:00:00.000Z')
const existing: Sprint[] = [
  { id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: '2026-10-01T00:00:00.000Z' }
]

describe('addSprint', () => {
  it('recusa nome repetido no projeto, sem diferenciar maiúsculas nem espaços', () => {
    expect(addSprint(existing, 'p1', ' sprint 1 ', now)).toEqual({ error: SPRINT_NAME_TAKEN })
    expect(SPRINT_NAME_TAKEN).toBe('Já existe uma sprint com esse nome neste projeto.')
  })

  it('recusa nome vazio', () => {
    expect(addSprint(existing, 'p1', '   ', now)).toEqual({ error: SPRINT_NAME_EMPTY })
    expect(SPRINT_NAME_EMPTY).toBe('Dê um nome à sprint.')
  })

  it('aceita o mesmo nome em outro projeto e devolve o id da nova', () => {
    const result = addSprint(existing, 'p2', 'Sprint 1', now)
    if ('error' in result) throw new Error(result.error)
    const created = result.sprints.find((s) => s.id === result.sprintId)
    expect(created).toMatchObject({
      projectId: 'p2',
      name: 'Sprint 1',
      createdAt: now.toISOString()
    })
    expect(result.sprints).toHaveLength(2)
  })
})

describe('latestOpenSprint', () => {
  it('escolhe a aberta mais recente e ignora as encerradas', () => {
    const sprints: Sprint[] = [
      ...existing,
      { id: 's2', projectId: 'p1', name: 'Sprint 2', createdAt: '2026-10-15T00:00:00.000Z' },
      {
        id: 's3',
        projectId: 'p1',
        name: 'Sprint 3',
        createdAt: '2026-10-20T00:00:00.000Z',
        closedAt: '2026-10-21T00:00:00.000Z'
      }
    ]
    expect(latestOpenSprint(sprints, 'p1')?.id).toBe('s2')
    expect(latestOpenSprint(sprints, 'p9')).toBeUndefined()
  })
})
