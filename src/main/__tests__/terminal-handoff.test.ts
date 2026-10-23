// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildTerminalHandoff } from '../terminal-handoff'

describe('buildTerminalHandoff', () => {
  it('records a successful run with deterministic project id and references', () => {
    const handoff = buildTerminalHandoff(
      {
        projectId: 'project-1',
        conversationId: 'conversation-1',
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
      sourceConversationId: 'conversation-1'
    })
    expect(handoff.body).toContain('run=run-1')
    expect(handoff.body).toContain('src/main/deploy.ts')
  })

  it('marks cancellation and uses the global deterministic handoff', () => {
    const handoff = buildTerminalHandoff(
      {
        projectId: null,
        conversationId: null,
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
        conversationId: 'conversation-1',
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
