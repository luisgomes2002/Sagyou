import { describe, expect, it } from 'vitest'
import type { Goal } from '../../types'
import { goalKind, goalProgressPercent, isGoalComplete } from '../../utils/goals'

const legacyGoal: Goal = {
  id: 'legacy',
  title: 'Meta antiga',
  entries: [{ id: 'entry', date: '2026-10-21', value: 1, createdAt: '2026-10-21' }],
  target: 10,
  unit: 'livros',
  color: '#7c3aed',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01'
}

describe('goal helpers', () => {
  it('mantém metas antigas sem tipo como quantitativas', () => {
    expect(goalKind(legacyGoal)).toBe('quantity')
    expect(goalProgressPercent(legacyGoal)).toBe(10)
    expect(isGoalComplete(legacyGoal)).toBe(false)
  })

  it('trata a primeira entrada de uma meta única como conclusão', () => {
    const completion: Goal = { ...legacyGoal, kind: 'completion' }
    expect(goalProgressPercent(completion)).toBe(100)
    expect(isGoalComplete(completion)).toBe(true)
  })

  it('preserva o progresso de metas quantitativas com alvo fracionário', () => {
    const fractional: Goal = {
      ...legacyGoal,
      target: 0.5,
      entries: [{ ...legacyGoal.entries[0], value: 0.25 }]
    }
    expect(goalProgressPercent(fractional)).toBe(50)
  })
})
