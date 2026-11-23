// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  CHECKPOINT_MIN_GAP_MS,
  CHECKPOINT_TICK_MS,
  createSessionCheckpoints
} from '../modules/agent/session-checkpoint'
import type { AiMemory } from '../modules/ai/memory'

const T0 = Date.parse('2026-11-23T10:00:00.000Z')

interface Live {
  projectId: string | null
  subject?: string
  actions: string[]
  files: string[]
}

interface Harness {
  checkpoints: ReturnType<typeof createSessionCheckpoints>
  live: Record<string, Live>
  writes: AiMemory[]
  errors: unknown[]
  read: Mock
}

function setup(
  over: { read?: (runId: string) => Promise<unknown>; existing?: AiMemory | null } = {}
): Harness {
  const live: Record<string, Live> = {
    r1: { projectId: 'p1', actions: [], files: [] },
    r2: { projectId: 'p1', actions: [], files: [] }
  }
  const writes: AiMemory[] = []
  const errors: unknown[] = []
  const fromLive = async (runId: string): Promise<unknown> => {
    const run = live[runId]
    if (!run) return null
    return {
      projectId: run.projectId,
      startedAt: T0,
      input: {
        request: 'Sessão interativa',
        ...(run.subject ? { subject: run.subject } : {}),
        actions: run.actions,
        changedFiles: run.files
      }
    }
  }
  const read = vi.fn(over.read ?? fromLive)
  const checkpoints = createSessionCheckpoints({
    now: () => Date.now(),
    read: read as never,
    getMemory: () => over.existing ?? null,
    write: (memory) => writes.push(memory),
    onError: (_runId, error) => errors.push(error)
  })
  return { checkpoints, live, writes, errors, read }
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('createSessionCheckpoints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  it('start grava já um handoff em andamento com o id da sessão', async () => {
    const { checkpoints, writes } = setup()
    checkpoints.start('r1')
    await flush()
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('handoff:p1:r1')
    expect(writes[0].title).toBe('[em andamento] Sessão de terminal')
    expect(writes[0].tags).toContain('em-andamento')
  })

  it('várias escritas seguidas viram uma gravação imediata e uma agendada 15 s depois', async () => {
    const { checkpoints, live, writes } = setup()
    checkpoints.start('r1')
    await flush()
    expect(writes).toHaveLength(1)
    live.r1.actions = ['Criar task "A"']
    await flush(1_000)
    checkpoints.touch('r1')
    await flush(1_000)
    checkpoints.touch('r1')
    await flush(1_000)
    checkpoints.touch('r1')
    await flush(1_000)
    expect(writes).toHaveLength(1) // ainda dentro dos 15 s
    await flush(CHECKPOINT_MIN_GAP_MS)
    expect(writes).toHaveLength(2)
    expect(writes[1].body).toContain('Criar task "A"')
    await flush(CHECKPOINT_MIN_GAP_MS * 2)
    expect(writes).toHaveLength(2) // nada mudou: sem terceira gravação
  })

  it('passados 15 s, a escrita seguinte grava na hora', async () => {
    const { checkpoints, live, writes } = setup()
    checkpoints.start('r1')
    await flush(CHECKPOINT_MIN_GAP_MS + 1_000)
    live.r1.subject = 'Criar task "B"'
    checkpoints.touch('r1')
    await flush()
    expect(writes).toHaveLength(2)
    expect(writes[1].title).toBe('[em andamento] Sessão de terminal: Criar task "B"')
  })

  it('o tick de 2 min só regrava quando o texto mudou', async () => {
    const { checkpoints, live, writes, read } = setup()
    checkpoints.start('r1')
    await flush()
    await flush(CHECKPOINT_TICK_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(writes).toHaveLength(1)
    live.r1.files = ['src/a.ts']
    await flush(CHECKPOINT_TICK_MS)
    expect(writes).toHaveLength(2)
    expect(writes[1].body).toContain('- src/a.ts')
  })

  it('stop com uma leitura em voo descarta o resultado e nada grava depois', async () => {
    let release: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => (release = resolve))
    const { checkpoints, writes, read } = setup({ read: () => pending })
    checkpoints.start('r1')
    await flush()
    checkpoints.stop('r1')
    release({
      projectId: 'p1',
      startedAt: T0,
      input: { request: 'x', actions: [], changedFiles: [] }
    })
    await flush()
    expect(writes).toHaveLength(0)
    expect(checkpoints.snapshot('r1')).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('depois de stop, touch e o tick não leem nem gravam', async () => {
    const { checkpoints, writes, read } = setup()
    checkpoints.start('r1')
    await flush()
    checkpoints.stop('r1')
    checkpoints.stop('r1') // idempotente
    checkpoints.touch('r1')
    await flush(CHECKPOINT_TICK_MS * 3)
    expect(writes).toHaveLength(1)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('uma run que sumiu (read null) não grava e para os próprios timers', async () => {
    const { checkpoints, writes, read } = setup()
    checkpoints.start('inexistente')
    await flush(CHECKPOINT_TICK_MS * 5)
    expect(writes).toHaveLength(0)
    expect(read).toHaveBeenCalledTimes(1)
    expect(checkpoints.snapshot('inexistente')).toBeNull()
  })

  it('resetAll regrava cada run viva mesmo com o texto igual', async () => {
    const { checkpoints, writes } = setup()
    checkpoints.start('r1')
    checkpoints.start('r2')
    await flush()
    expect(writes).toHaveLength(2)
    checkpoints.resetAll()
    await flush()
    expect(writes).toHaveLength(4)
  })

  it('preserva fixado e arquivado da linha existente', async () => {
    const existing = {
      id: 'handoff:p1:r1',
      projectId: 'p1',
      type: 'handoff',
      title: 'antigo',
      body: 'antigo',
      tags: ['handoff'],
      pinned: true,
      source: 'modelo',
      sourceConversationId: null,
      createdAt: '2026-11-23T09:00:00.000Z',
      updatedAt: '2026-11-23T09:00:00.000Z',
      lastAccessedAt: '2026-11-23T09:00:00.000Z',
      accessCount: 2,
      archivedAt: '2026-11-23T09:30:00.000Z'
    } as AiMemory
    const { checkpoints, writes } = setup({ existing })
    checkpoints.start('r1')
    await flush()
    expect(writes[0].pinned).toBe(true)
    expect(writes[0].archivedAt).toBe('2026-11-23T09:30:00.000Z')
    expect(writes[0].accessCount).toBe(2)
  })

  it('um erro vai para onError e as próximas tentativas seguem funcionando', async () => {
    let fail = true
    const { checkpoints, writes, errors, live } = setup({
      read: async () => {
        if (fail) throw new Error('git falhou')
        return {
          projectId: 'p1',
          startedAt: T0,
          input: { request: 'x', actions: live.r1.actions, changedFiles: [] }
        }
      }
    })
    checkpoints.start('r1')
    await flush()
    expect(errors).toHaveLength(1)
    expect(writes).toHaveLength(0)
    fail = false
    await flush(CHECKPOINT_TICK_MS)
    expect(writes).toHaveLength(1)
  })

  it('snapshot e live trazem assunto, ações e arquivos do último checkpoint', async () => {
    const { checkpoints, live } = setup()
    live.r1.subject = 'Criar task "A"'
    live.r1.actions = ['Criar task "A"']
    live.r1.files = Array.from({ length: 25 }, (_, i) => `src/${i}.ts`)
    checkpoints.start('r1')
    checkpoints.start('r2')
    await flush()
    const snapshot = checkpoints.snapshot('r1')
    expect(snapshot).toMatchObject({
      runId: 'r1',
      projectId: 'p1',
      startedAt: T0,
      updatedAt: T0,
      subject: 'Criar task "A"',
      actions: ['Criar task "A"']
    })
    expect(snapshot?.files).toHaveLength(20)
    expect(checkpoints.live().map((entry) => entry.runId).sort()).toEqual(['r1', 'r2'])
    checkpoints.stop('r1')
    expect(checkpoints.live().map((entry) => entry.runId)).toEqual(['r2'])
  })

  it('duas runs do mesmo projeto gravam em linhas diferentes', async () => {
    const { checkpoints, writes } = setup()
    checkpoints.start('r1')
    checkpoints.start('r2')
    await flush()
    expect(writes.map((memory) => memory.id).sort()).toEqual(['handoff:p1:r1', 'handoff:p1:r2'])
  })
})
