import { describe, expect, it } from 'vitest'
import { focusedEntityHit } from '../../utils/focused-entity-hit'

describe('focusedEntityHit', () => {
  it('cria o alvo de busca de uma memória', () => {
    expect(focusedEntityHit('memory', 'mem-1', '', false)).toMatchObject({
      type: 'memory',
      id: 'mem-1',
      projectId: null
    })
  })

  it('mantém o alvo de uma meta concluída', () => {
    expect(focusedEntityHit('goal', 'goal-1', 'Correr', true)).toMatchObject({
      type: 'goal',
      id: 'goal-1',
      title: 'Correr',
      snippet: 'Correr',
      matchedField: 'title',
      projectId: null
    })
  })
})
