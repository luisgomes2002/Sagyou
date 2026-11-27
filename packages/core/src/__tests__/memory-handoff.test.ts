import { describe, expect, it } from 'vitest'
import {
  HANDOFF_INTERRUPTED_TAG,
  HANDOFF_KEEP,
  HANDOFF_RUNNING_TAG,
  handoffId,
  handoffRunId,
  isRunningHandoff,
  selectHandoffOverflow,
  type AiMemory
} from '../memory'

const NOW = '2026-11-23T12:00:00.000Z'

const handoff = (over: Partial<AiMemory> & { id: string }): AiMemory => ({
  projectId: 'p1',
  type: 'handoff',
  title: 'Sessão de terminal',
  body: 'corpo',
  tags: ['handoff', 'terminal'],
  pinned: false,
  source: 'modelo',
  createdAt: NOW,
  updatedAt: NOW,
  lastAccessedAt: NOW,
  accessCount: 0,
  archivedAt: null,
  ...over
})

describe('handoffId', () => {
  it('sem runId mantém o id legado por projeto', () => {
    expect(handoffId('p1')).toBe('handoff:p1')
    expect(handoffId(null)).toBe('handoff:global')
  })

  it('com runId gera um id por sessão', () => {
    expect(handoffId('p1', 'r1')).toBe('handoff:p1:r1')
    expect(handoffId(null, 'r1')).toBe('handoff:global:r1')
  })
})

describe('handoffRunId', () => {
  it('devolve a run de um id novo e null para o legado ou para outro id', () => {
    expect(handoffRunId('handoff:p1:r1')).toBe('r1')
    expect(handoffRunId('handoff:global:r1')).toBe('r1')
    expect(handoffRunId('handoff:p1')).toBeNull()
    expect(handoffRunId('outro:x')).toBeNull()
    expect(handoffRunId('0f8e1c2a-5b0d-4c7e-9a31-1d2c3b4a5f60')).toBeNull()
  })
})

describe('isRunningHandoff', () => {
  it('é verdadeiro só para handoff ativo com a tag em-andamento', () => {
    const running = handoff({ id: 'handoff:p1:r1', tags: ['handoff', HANDOFF_RUNNING_TAG] })
    expect(isRunningHandoff(running)).toBe(true)
    expect(isRunningHandoff({ ...running, archivedAt: NOW })).toBe(false)
    expect(isRunningHandoff({ ...running, type: 'fato' })).toBe(false)
    expect(isRunningHandoff(handoff({ id: 'handoff:p1:r2', tags: ['handoff', 'completed'] }))).toBe(
      false
    )
    expect(
      isRunningHandoff(handoff({ id: 'handoff:p1:r3', tags: ['handoff', HANDOFF_INTERRUPTED_TAG] }))
    ).toBe(false)
  })
})

describe('selectHandoffOverflow', () => {
  const day = (n: number): string => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`
  const seven = (): AiMemory[] =>
    [1, 2, 3, 4, 5, 6, 7].map((n) =>
      handoff({ id: `handoff:p1:r${n}`, updatedAt: day(n), createdAt: day(n) })
    )

  it('mantém os 5 mais recentes de um projeto e devolve os mais antigos', () => {
    expect(HANDOFF_KEEP).toBe(5)
    expect(selectHandoffOverflow(seven(), new Set()).sort()).toEqual([
      'handoff:p1:r1',
      'handoff:p1:r2'
    ])
  })

  it('ordena pelo instante real, não pelo texto (offset e sem milissegundos)', () => {
    const at = (id: string, updatedAt: string): AiMemory => handoff({ id, updatedAt })
    const memories = [
      at('handoff:p1:k1', '2026-11-23T09:00:00.000Z'),
      at('handoff:p1:k2', '2026-11-23T10:00:00.000Z'),
      at('handoff:p1:k3', '2026-11-23T11:00:00.000Z'),
      at('handoff:p1:k4', '2026-11-23T12:00:00.000Z'),
      at('handoff:p1:k5', '2026-11-23T13:00:00.000Z'),
      // O texto "14:00" parece o mais novo, mas com +14:00 o instante é 00:00Z, o mais antigo de todos.
      at('handoff:p1:f', '2026-11-23T14:00:00+14:00'),
      // Sem milissegundos, no dia anterior: o segundo mais antigo.
      at('handoff:p1:g', '2026-11-22T10:00:00Z')
    ]
    // Pelo texto, o excedente seria k1 e g; pelo instante, é g e f.
    expect(selectHandoffOverflow(memories, new Set()).sort()).toEqual([
      'handoff:p1:f',
      'handoff:p1:g'
    ])
  })

  it('nunca devolve um fixado nem um em andamento com run viva, mesmo passando de 5', () => {
    const memories = seven()
    memories[0] = { ...memories[0], pinned: true }
    memories[1] = { ...memories[1], tags: ['handoff', HANDOFF_RUNNING_TAG] }
    expect(selectHandoffOverflow(memories, new Set(['r2']))).toEqual([])
  })

  it('um em andamento sem run viva pode ser arquivado', () => {
    const memories = seven()
    memories[0] = { ...memories[0], tags: ['handoff', HANDOFF_RUNNING_TAG] }
    expect(selectHandoffOverflow(memories, new Set()).sort()).toEqual([
      'handoff:p1:r1',
      'handoff:p1:r2'
    ])
  })

  it('conta cada projeto e o global separado, ignorando arquivados e outros tipos', () => {
    const memories = [
      ...seven(),
      ...[1, 2, 3, 4, 5].map((n) =>
        handoff({ id: `handoff:p2:r${n}`, projectId: 'p2', updatedAt: day(n) })
      ),
      ...[1, 2, 3].map((n) =>
        handoff({ id: `handoff:global:r${n}`, projectId: null, updatedAt: day(n) })
      ),
      handoff({ id: 'handoff:p2:old', projectId: 'p2', updatedAt: day(1), archivedAt: NOW }),
      handoff({ id: 'fato-1', type: 'fato', updatedAt: day(1) })
    ]
    expect(selectHandoffOverflow(memories, new Set()).sort()).toEqual([
      'handoff:p1:r1',
      'handoff:p1:r2'
    ])
  })

  it('conta o handoff legado por projeto no limite', () => {
    const memories = [
      handoff({ id: 'handoff:p1', updatedAt: day(1) }),
      ...[2, 3, 4, 5, 6].map((n) => handoff({ id: `handoff:p1:r${n}`, updatedAt: day(n) }))
    ]
    expect(selectHandoffOverflow(memories, new Set())).toEqual(['handoff:p1'])
  })
})
