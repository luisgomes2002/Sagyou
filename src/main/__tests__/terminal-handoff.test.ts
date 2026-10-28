// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildTerminalHandoff } from '../modules/agent/terminal-handoff'

describe('buildTerminalHandoff', () => {
  it('records a successful run with deterministic project id and references', () => {
    const handoff = buildTerminalHandoff(
      {
        projectId: 'project-1',
        runId: 'run-1',
        request: 'Corrigir o deploy',
        status: 'completed',
        result: 'Diff aplicado com sucesso.',
        changedFiles: ['src/main/deploy.ts']
      },
      '2026-10-22T00:00:00.000Z'
    )
    expect(handoff).toMatchObject({
      id: 'handoff:project-1',
      type: 'handoff',
      projectId: 'project-1',
      sourceConversationId: null
    })
    expect(handoff.body).toContain('run=run-1')
    expect(handoff.body).not.toContain('conversa=')
    expect(handoff.body).toContain('src/main/deploy.ts')
  })

  it('marks cancellation and uses the global deterministic handoff', () => {
    const handoff = buildTerminalHandoff(
      {
        projectId: null,
        runId: 'run-cancelled',
        request: 'Investigar o erro',
        status: 'cancelled',
        result: 'A execução foi interrompida.',
        changedFiles: []
      },
      '2026-10-22T00:00:00.000Z'
    )
    expect(handoff.id).toBe('handoff:global')
    expect(handoff.body).toContain('Status: cancelled')
  })

  it('bounds long responses and file lists at write time', () => {
    const handoff = buildTerminalHandoff(
      {
        projectId: 'project-1',
        runId: 'run-long',
        request: 'x'.repeat(2_000),
        status: 'failed',
        result: 'y'.repeat(2_000),
        changedFiles: Array.from({ length: 30 }, (_, index) => `src/${index}.ts`)
      },
      '2026-10-22T00:00:00.000Z'
    )
    expect(handoff.body.length).toBeLessThanOrEqual(2_400)
    expect(handoff.body).toContain('src/19.ts')
    expect(handoff.body).not.toContain('src/20.ts')
    expect(handoff.body).not.toContain('y'.repeat(701))
  })
})

describe('buildTerminalHandoff sources', () => {
  const base = {
    projectId: 'project-1',
    runId: 'run-7',
    request: 'Sessão interativa',
    status: 'completed' as const,
    result: 'Terminal concluído.',
    changedFiles: ['src/a.ts']
  }
  const NOW = '2026-10-28T00:00:00.000Z'

  it('titles the handoff by its subject and lists decisions, actions and pending tasks', () => {
    const handoff = buildTerminalHandoff(
      {
        ...base,
        subject: 'Iniciar cronômetro de "MCP transações 1/5"',
        decisions: ['usar a opção B'],
        actions: [
          'Iniciar cronômetro de "MCP transações 1/5"',
          'Concluir tarefa "MCP transações 1/5"'
        ],
        pending: ['Iniciar cronômetro de "MCP transações 2/5"']
      },
      NOW
    )
    expect(handoff.title).toBe('Sessão de terminal: Iniciar cronômetro de "MCP transações 1/5"')
    expect(handoff.body).toContain('Assunto: Iniciar cronômetro de "MCP transações 1/5"')
    expect(handoff.body).toContain('Decisões:\n- usar a opção B')
    expect(handoff.body).toContain(
      'Ações pelo MCP (2):\n- Iniciar cronômetro de "MCP transações 1/5"\n- Concluir tarefa "MCP transações 1/5"'
    )
    expect(handoff.body).toContain(
      'Pendências:\n- Iniciar cronômetro de "MCP transações 2/5" (não concluída nesta sessão)'
    )
    expect(handoff.body).not.toContain('consulte o histórico local')
    expect(handoff.body.endsWith('Referências: run=run-7')).toBe(true)
  })

  it('without any source keeps the old title and points to the local run history', () => {
    const handoff = buildTerminalHandoff(base, NOW)
    expect(handoff.title).toBe('Última sessão de terminal')
    expect(handoff.body).toContain('Pedido: Sessão interativa')
    expect(handoff.body).toContain(
      'Sem assunto, decisões ou ações registrados; consulte o histórico local da run run-7.'
    )
    expect(handoff.body).not.toContain('Decisões:')
    expect(handoff.body).not.toContain('Ações pelo MCP')
    expect(handoff.body).not.toContain('Pendências:')
  })

  it('caps the title at 120 characters', () => {
    const handoff = buildTerminalHandoff({ ...base, subject: 'x'.repeat(300) }, NOW)
    expect(handoff.title.length).toBeLessThanOrEqual(120)
  })

  it('labels the files of a run that was not applied', () => {
    const handoff = buildTerminalHandoff({ ...base, status: 'not_applied' }, NOW)
    expect(handoff.body).toContain('Arquivos alterados na worktree, não aplicados ao projeto (1):')
    expect(buildTerminalHandoff(base, NOW).body).toContain('Arquivos alterados (1):')
  })

  it('records a cancelled run with its decisions', () => {
    const handoff = buildTerminalHandoff(
      { ...base, status: 'cancelled', decisions: ['manter o fallback'] },
      NOW
    )
    expect(handoff.body).toContain('Status: cancelled')
    expect(handoff.body).toContain('Decisões:\n- manter o fallback')
  })

  it('always keeps the run reference within the body limit', () => {
    const long = Array.from({ length: 12 }, (_, i) => `${i} ${'a'.repeat(300)}`)
    const handoff = buildTerminalHandoff(
      {
        ...base,
        request: 'r'.repeat(2_000),
        subject: 's'.repeat(500),
        decisions: long,
        actions: long,
        pending: long,
        changedFiles: Array.from({ length: 30 }, (_, i) => `src/${i}.ts`)
      },
      NOW
    )
    expect(handoff.body.length).toBeLessThanOrEqual(2_400)
    expect(handoff.body.endsWith('Referências: run=run-7')).toBe(true)
  })
})
