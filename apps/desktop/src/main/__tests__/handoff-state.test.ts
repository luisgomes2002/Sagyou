// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  archiveHandoffOverflow,
  INTERRUPTED_STATUS_LINE,
  INTERRUPTED_TITLE_PREFIX,
  RUNNING_STATUS_LINE,
  RUNNING_TITLE_PREFIX,
  interruptRunningHandoffs,
  markHandoffInterrupted,
  restoreAsInterrupted,
  syncableMemories
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

  it('não confunde um item de lista com a linha de estado', () => {
    const body = BODY.replace(
      '- Handoff (não concluída nesta sessão)',
      `- ${RUNNING_STATUS_LINE} (não concluída nesta sessão)`
    )
    const done = markHandoffInterrupted(running({ body }), NOW)
    expect(done.body).toContain(`- ${RUNNING_STATUS_LINE} (não concluída nesta sessão)`)
    expect(done.body.match(/^Status: interrompida$/gm)).toHaveLength(1)
    expect(done.body.match(/^Status: em andamento$/gm)).toBeNull()
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

describe('interrupção e sync de um handoff em andamento arquivado', () => {
  it('marca interrompida também o arquivado e mantém o arquivamento', () => {
    const archived = running({ archivedAt: '2026-11-23T10:30:00.000Z' })
    const out = interruptRunningHandoffs([archived], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].archivedAt).toBe('2026-11-23T10:30:00.000Z')
    expect(out[0].tags).toContain('interrompida')
  })

  it('syncableMemories tira todo handoff em andamento, arquivado ou não', () => {
    const live = running()
    const archived = running({ id: 'handoff:p1:r2', archivedAt: NOW })
    const done = running({ id: 'handoff:p1:r3', tags: ['handoff', 'terminal', 'completed'] })
    const other = running({ id: 'fato-1', type: 'fato' })
    expect(syncableMemories([live, archived, done, other]).map((m) => m.id)).toEqual([
      'handoff:p1:r3',
      'fato-1'
    ])
  })

  it('um backup restaurado não deixa nada em andamento a ser tirado do sync (sem tombstone)', () => {
    const restored = [running(), running({ id: 'handoff:p1:r2', archivedAt: NOW })].map((m) =>
      restoreAsInterrupted(m, NOW)
    )
    expect(restored.every((m) => m.tags.includes('interrompida'))).toBe(true)
    // Everything restored is still versioned: none is filtered out of a complete capture.
    expect(syncableMemories(restored)).toHaveLength(2)
    expect(restoreAsInterrupted(running({ id: 'fato-1', type: 'fato' }), NOW).tags).toEqual([
      'handoff',
      'terminal',
      'em-andamento'
    ])
  })
})

describe('archiveHandoffOverflow', () => {
  const handoffs = (): AiMemory[] =>
    [1, 2, 3, 4, 5, 6, 7].map((n) =>
      running({
        id: `handoff:p1:r${n}`,
        tags: ['handoff', 'terminal', 'completed'],
        updatedAt: `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`
      })
    )

  it('archives the two oldest of seven and returns their ids', () => {
    const archived: { ids: string[]; now: string }[] = []
    const ids = archiveHandoffOverflow({
      list: handoffs,
      archive: (ids, now) => archived.push({ ids, now }),
      live: () => new Set(),
      now: () => NOW
    })
    expect(ids.sort()).toEqual(['handoff:p1:r1', 'handoff:p1:r2'])
    expect(archived).toHaveLength(1)
    expect(archived[0].now).toBe(NOW)
  })

  it('leaves a live running handoff and a pinned one alone', () => {
    const list = handoffs()
    list[0] = { ...list[0], tags: ['handoff', 'terminal', 'em-andamento'] }
    list[1] = { ...list[1], pinned: true }
    let called = false
    const ids = archiveHandoffOverflow({
      list: () => list,
      archive: () => {
        called = true
      },
      live: () => new Set(['r1']),
      now: () => NOW
    })
    expect(ids).toEqual([])
    expect(called).toBe(false)
  })
})
