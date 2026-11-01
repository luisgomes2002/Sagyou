import { describe, it, expect } from 'vitest'
import { buildTaskPrompt, MAX_PROMPT_DESCRIPTION } from '../../utils/taskPrompt'
import type { Task } from '../../types'

const task = (over: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'proj-1',
  columnId: 'col-1',
  title: 'Corrigir bug no login',
  priority: 'high',
  tags: [],
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

describe('buildTaskPrompt', () => {
  it('carries the ids the tools need alongside prose the user can read', () => {
    const out = buildTaskPrompt(task(), 'Sagyou', 'A fazer')

    // The ids are the whole reason this exists rather than the clipboard text:
    // without them the model can describe the task but not act on it.
    expect(out).toContain('id: task-1')
    expect(out).toContain('projectId: proj-1')
    expect(out).toContain('Corrigir bug no login')
    expect(out).toContain('projeto: Sagyou')
    expect(out).toContain('coluna: A fazer')
  })

  /**
   * `ler_tasks` reads one project — the one named, or the active one. A task
   * handed over from a board the user isn't currently on would be invisible to
   * every tool without this, and the model would answer "essa task não existe"
   * about a task the user is looking at.
   */
  it('always names the project id, even with nothing else resolved', () => {
    const out = buildTaskPrompt(task({ projectId: 'outro-projeto' }), '', '')
    expect(out).toContain('projectId: outro-projeto')
  })

  it('ends with room to type, since the instruction is the user\'s', () => {
    // Context only, no verb: "implemente", "quebre em subtasks" and "por que
    // travou?" are different asks, and a wrong guess is a line to delete.
    const out = buildTaskPrompt(task(), 'P', 'C')
    expect(out.endsWith('\n\n')).toBe(true)
    expect(out).not.toMatch(/implemente|analise|resolva/i)
  })

  it('includes description and tags when there are any', () => {
    const out = buildTaskPrompt(
      task({ description: 'O token expira cedo demais.', tags: ['Dev', 'Urgente'] }),
      'P',
      'C'
    )
    expect(out).toContain('O token expira cedo demais.')
    expect(out).toContain('Tags: Dev, Urgente')
  })

  it('leaves out sections it has nothing for, rather than printing empty labels', () => {
    const out = buildTaskPrompt(task(), 'P', 'C')
    expect(out).not.toContain('Tags:')
    expect(out).not.toContain('vencimento')
  })

  it('truncates a description that is an essay, not a briefing', () => {
    // The prompt is resent to the model on every later step of the run, so an
    // unbounded task body would be paid for again and again.
    const out = buildTaskPrompt(task({ description: 'x'.repeat(5000) }), 'P', 'C')
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(MAX_PROMPT_DESCRIPTION + 500)
  })

  it('survives a priority the config does not know', () => {
    // Priority is persisted data and hand-editable; a missing label must not
    // crash the handoff on "cannot read properties of undefined".
    const out = buildTaskPrompt(task({ priority: 'inventada' as Task['priority'] }), 'P', 'C')
    expect(out).toContain('prioridade: inventada')
  })
})
