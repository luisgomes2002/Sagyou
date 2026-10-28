// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createRunActivity,
  runActivityEntry,
  summarizeRunActivity
} from '../modules/agent/run-activity'
import { MCP_RENDERER_WRITE_TOOLS } from '../modules/agent/mcp-write-types'

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

describe('runActivityEntry', () => {
  const card = (): string => 'MCP Sagyou: criar task'

  it('keeps the card resumo and the touched id of an applied write', () => {
    expect(
      runActivityEntry(
        { name: 'complete_task', args: { id: 'a' }, resumo: 'Concluir tarefa "A"' },
        { ok: true, id: 'a' },
        card
      )
    ).toEqual({ name: 'complete_task', resumo: 'Concluir tarefa "A"', id: 'a' })
  })

  it('ignores a write that did not succeed', () => {
    const request = { name: 'update_task', args: {}, resumo: 'Editar' }
    expect(runActivityEntry(request, { ok: false, error: 'x' }, card)).toBeNull()
    expect(runActivityEntry(request, null, card)).toBeNull()
  })

  it('never copies amounts or tables of a financial write into the handoff', () => {
    for (const name of [
      'create_transaction',
      'update_transaction',
      'delete_transaction',
      'create_financial_table',
      'add_financial_category',
      'remove_financial_category',
      'create_financial_profile',
      'rename_financial_profile'
    ]) {
      const entry = runActivityEntry(
        {
          name,
          args: { amount: '797.48' },
          resumo: 'Lançar despesa de R$ 797,48 em Brasil Pessoal'
        },
        { ok: true, id: 'tx-1' },
        card
      )
      expect(entry).toEqual({ name, resumo: `Escrita financeira (${name}); confira no Sagyou` })
    }
  })

  it('labels a saved memory and takes a decisao title as an explicit decision', () => {
    expect(
      runActivityEntry(
        { name: 'save_memory', args: { tipo: 'decisao', titulo: ' Comprovantes ficam manuais ' } },
        { ok: true, id: 'm1' },
        card
      )
    ).toEqual({
      name: 'save_memory',
      resumo: 'Salvar memória decisao "Comprovantes ficam manuais"',
      id: 'm1',
      decision: 'Comprovantes ficam manuais'
    })
    expect(
      runActivityEntry(
        { name: 'save_memory', args: { tipo: 'fato', titulo: 'X' } },
        { ok: true, id: 'm2' },
        card
      )
    ).not.toHaveProperty('decision')
  })

  it('falls back to the card text when the tool prepared no resumo', () => {
    expect(runActivityEntry({ name: 'criar_task', args: {} }, { ok: true, id: 't' }, card)).toEqual(
      {
        name: 'criar_task',
        resumo: 'MCP Sagyou: criar task',
        id: 't'
      }
    )
  })
})

describe('runActivityEntry finance coverage', () => {
  it('treats every financial MCP write tool as financial, so a new one cannot leak', () => {
    const financial = MCP_RENDERER_WRITE_TOOLS.filter((name) => /transaction|financial/.test(name))
    expect(financial.length).toBeGreaterThan(0)
    for (const name of financial)
      expect(
        runActivityEntry({ name, args: {}, resumo: 'R$ 1,00' }, { ok: true }, () => '')?.resumo
      ).toBe(`Escrita financeira (${name}); confira no Sagyou`)
  })
})
