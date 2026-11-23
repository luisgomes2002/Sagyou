// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  INTERRUPTED_STATUS_LINE,
  INTERRUPTED_TITLE_PREFIX,
  RUNNING_STATUS_LINE,
  RUNNING_TITLE_PREFIX,
  interruptRunningHandoffs,
  markHandoffInterrupted
} from '../modules/ai/handoff-state'
import type { AiMemory } from '../modules/ai/memory'

const LAST = '2026-11-23T10:20:00.000Z'
const NOW = '2026-11-23T18:00:00.000Z'

const BODY = [
  'Pedido: ajustar o handoff',
  'Assunto: Criar task "Handoff"',
  'Resultado: Sessão em andamento; este registro é do último checkpoint.',
  RUNNING_STATUS_LINE,
  'Ações pelo MCP (1):',
  '- Criar task "Handoff"',
  'Pendências:',
  '- Handoff (não concluída nesta sessão)',
  'Arquivos alterados até o último checkpoint (1):',
  '- src/main/index.ts',
  'Referências: run=r1'
].join('\n')

const running = (over: Partial<AiMemory> = {}): AiMemory => ({
  id: 'handoff:p1:r1',
  projectId: 'p1',
  type: 'handoff',
  title: `${RUNNING_TITLE_PREFIX}Sessão de terminal: Criar task "Handoff"`,
  body: BODY,
  tags: ['handoff', 'terminal', 'em-andamento'],
  pinned: false,
  source: 'modelo',
  sourceConversationId: null,
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: LAST,
  lastAccessedAt: LAST,
  accessCount: 0,
  archivedAt: null,
  ...over
})

describe('markHandoffInterrupted', () => {
  it('troca título, tag, status e resultado e mantém o resto do corpo', () => {
    const done = markHandoffInterrupted(running(), NOW)
    expect(done.title).toBe(`${INTERRUPTED_TITLE_PREFIX}Sessão de terminal: Criar task "Handoff"`)
    expect(done.tags).toEqual(['handoff', 'terminal', 'interrompida'])
    expect(done.body).toContain(INTERRUPTED_STATUS_LINE)
    expect(done.body).not.toContain(RUNNING_STATUS_LINE)
    expect(done.body).toContain(
      'Resultado: A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: 2026-11-23T10:20:00.000Z.'
    )
    expect(done.body).not.toContain('este registro é do último checkpoint')
    for (const line of [
      'Pedido: ajustar o handoff',
      'Ações pelo MCP (1):',
      '- Criar task "Handoff"',
      '- Handoff (não concluída nesta sessão)',
      '- src/main/index.ts',
      'Referências: run=r1'
    ])
      expect(done.body).toContain(line)
    expect(done.updatedAt).toBe(NOW)
    expect(done.lastAccessedAt).toBe(NOW)
    expect(done.createdAt).toBe('2026-11-23T10:00:00.000Z')
    expect(done.pinned).toBe(false)
  })

  it('sem assunto, o título vira só o prefixo de interrompida', () => {
    const done = markHandoffInterrupted(
      running({ title: `${RUNNING_TITLE_PREFIX}Sessão de terminal` }),
      NOW
    )
    expect(done.title).toBe(`${INTERRUPTED_TITLE_PREFIX}Sessão de terminal`)
  })

  it('não mexe num pedido que cita as linhas de estado', () => {
    const quoted = `Pedido: veja\n${RUNNING_STATUS_LINE}\nno log`
    const done = markHandoffInterrupted(
      running({ body: BODY.replace('Pedido: ajustar o handoff', quoted) }),
      NOW
    )
    expect(done.body).toContain(`Pedido: veja\n${RUNNING_STATUS_LINE}\nno log`)
    expect(done.body.match(/^Status: interrompida$/gm)).toHaveLength(1)
  })

  it('mantém fixado e o id', () => {
    const done = markHandoffInterrupted(running({ pinned: true }), NOW)
    expect(done.pinned).toBe(true)
    expect(done.id).toBe('handoff:p1:r1')
  })
})

describe('interruptRunningHandoffs', () => {
  it('transforma só os handoffs ativos em andamento', () => {
    const finished = running({
      id: 'handoff:p1:r2',
      title: 'Sessão de terminal: pronto',
      tags: ['handoff', 'terminal', 'completed']
    })
    const legacy = running({ id: 'handoff:p1', tags: ['handoff', 'terminal', 'completed'] })
    const archived = running({ id: 'handoff:p1:r3', archivedAt: NOW })
    const other = running({ id: 'fato-1', type: 'fato' })
    const out = interruptRunningHandoffs([running(), finished, legacy, archived, other], NOW)
    expect(out.map((m) => m.id)).toEqual(['handoff:p1:r1'])
    expect(out[0].tags).toContain('interrompida')
  })
})
