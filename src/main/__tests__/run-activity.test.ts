// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRunActivity, summarizeRunActivity } from '../modules/agent/run-activity'

describe('createRunActivity', () => {
  it('keeps entries per run, capped, and take() empties the run', () => {
    const activity = createRunActivity()
    for (let i = 0; i < 45; i++) activity.record('run-1', { name: 'update_task', resumo: `#${i}` })
    activity.record('run-2', { name: 'create_note', resumo: 'nota' })
    const taken = activity.take('run-1')
    expect(taken).toHaveLength(40)
    expect(taken[0].resumo).toBe('#0')
    expect(activity.take('run-1')).toEqual([])
    expect(activity.take('run-2')).toEqual([{ name: 'create_note', resumo: 'nota' }])
  })
})

describe('summarizeRunActivity', () => {
  it('derives subject, actions, decisions and pending tasks from what was applied', () => {
    const summary = summarizeRunActivity([
      { name: 'start_task_timer', resumo: 'Iniciar cronômetro de "A"', id: 'a' },
      { name: 'start_task_timer', resumo: 'Iniciar cronômetro de "B"', id: 'b' },
      { name: 'complete_task', resumo: 'Concluir tarefa "A"', id: 'a' },
      {
        name: 'save_memory',
        resumo: 'Salvar memória decisao "Comprovantes ficam manuais"',
        decision: 'Comprovantes ficam manuais'
      }
    ])
    expect(summary).toEqual({
      subject: 'Iniciar cronômetro de "A"',
      actions: [
        'Iniciar cronômetro de "A"',
        'Iniciar cronômetro de "B"',
        'Concluir tarefa "A"',
        'Salvar memória decisao "Comprovantes ficam manuais"'
      ],
      decisions: ['Comprovantes ficam manuais'],
      pending: ['Iniciar cronômetro de "B"']
    })
  })

  it('caps the actions at 12 and has no subject without activity', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: 'update_task', resumo: `#${i}` }))
    expect(summarizeRunActivity(many).actions).toHaveLength(12)
    expect(summarizeRunActivity([])).toEqual({ actions: [], decisions: [], pending: [] })
  })

  it('a task completed before its timer started is still pending', () => {
    const summary = summarizeRunActivity([
      { name: 'complete_task', resumo: 'Concluir tarefa "A"', id: 'a' },
      { name: 'start_task_timer', resumo: 'Iniciar cronômetro de "A"', id: 'a' }
    ])
    expect(summary.pending).toEqual(['Iniciar cronômetro de "A"'])
  })
})
