import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeHandoff, useAiRunStore } from '../../store/aiRun'
import { useKanbanStore } from '../../store/kanban'
import { runAgent } from '../../ai/agent'

// The concurrency tests below drive two runs at once, so the agent loop is
// stubbed — its own behaviour is tested elsewhere. Everything else (constants,
// resolveMaxSteps that send() calls) stays real.
vi.mock('../../ai/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai/agent')>()),
  runAgent: vi.fn()
}))

// writeHandoff derives a per-project breadcrumb from the last exchange and sends
// it through window.electronAPI.ai.memory.handoff (the main process upserts it).
// Here the bridge is stubbed — what's under test is the derivation: scope, title,
// body shape, truncation, and the skips.

const st = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()

function installHandoff(): ReturnType<typeof vi.fn> {
  const handoff = vi.fn(async () => ({ ok: true as const }))
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: { memory: { handoff } } }
  return handoff
}

describe('writeHandoff', () => {
  beforeEach(() => {
    useKanbanStore.setState({ projects: [], activeProjectId: null, isLoaded: false })
  })

  it('sends a breadcrumb scoped to the active project, titled with its name', async () => {
    const pid = st().createProject('Sagyou')
    const handoff = installHandoff()

    await writeHandoff('como funciona o backup?', 'O backup exporta tudo para um JSON.')

    expect(handoff).toHaveBeenCalledWith({
      projectId: pid,
      title: 'Última sessão — Sagyou',
      body: 'Perguntou: "como funciona o backup?". Conclusão: O backup exporta tudo para um JSON.'
    })
  })

  it('truncates a long answer', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'x'.repeat(1000))

    const body = handoff.mock.calls[0][0].body as string
    expect(body).toContain('…')
    expect(body.length).toBeLessThan(700)
  })

  it('points a truncated handoff back to its conversation by id', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'x'.repeat(1000), 'conv-abc')

    const body = handoff.mock.calls[0][0].body as string
    expect(body).toContain('…')
    expect(body).toContain('id=conv-abc')
    expect(body).toContain('ler_conversa')
  })

  it('adds no pointer when the answer fit (nothing was cut) or there is no id', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'resposta curta', 'conv-abc') // not truncated
    await writeHandoff('q', 'y'.repeat(1000)) // truncated but no convId

    expect(handoff.mock.calls[0][0].body).not.toContain('id=')
    expect(handoff.mock.calls[1][0].body).not.toContain('id=')
  })

  it('skips an aborted or empty reply', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'Execução interrompida.')
    await writeHandoff('q', '   ')

    expect(handoff).not.toHaveBeenCalled()
  })

  it('is a no-op when the memory bridge is absent (never throws)', async () => {
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: {} }
    await expect(writeHandoff('q', 'uma resposta real')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// N agents at once: the Phase 1 milestone. Two runs, two conversations, no
// leaking — the desingletonised run store, exercised directly.
// ---------------------------------------------------------------------------

const run = (): ReturnType<typeof useAiRunStore.getState> => useAiRunStore.getState()
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const cfg = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }

/** Capture each run's resolver and options, keyed by the conversation it runs for. */
function captureRuns(): Map<string, { resolve: (s: string) => void; opts: Record<string, unknown> }> {
  const runs = new Map<string, { resolve: (s: string) => void; opts: Record<string, unknown> }>()
  vi.mocked(runAgent).mockImplementation(
    (_c, _m, _a, opts = {}) =>
      new Promise<string>((resolve) => {
        runs.set(String(opts.convId), { resolve, opts: opts as Record<string, unknown> })
      })
  )
  return runs
}

describe('two agents running at once', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A blank run store, and no memory bridge (handoff is a harmless no-op).
    useAiRunStore.setState({
      messages: [],
      running: new Set(),
      streaming: {},
      streamingTools: {},
      error: null,
      usage: { promptTokens: 0, completionTokens: 0 },
      conversationId: null,
      parked: {},
      runProjects: {},
      pendingApprovals: [],
      autoApprove: new Set(),
      abortRequested: new Set()
    })
    useKanbanStore.setState({ projects: [], activeProjectId: null })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: {} }
  })

  it('delivers each answer to the chat that asked, not the one on screen', async () => {
    const runs = captureRuns()

    // Start a run in chat A, then switch to a new chat B and start one there.
    useAiRunStore.setState({ conversationId: 'A', messages: [] })
    void run().send(cfg, { text: 'pergunta A', imageIds: [], imageData: {} })
    run().openConversation({ id: 'B', messages: [] })
    void run().send(cfg, { text: 'pergunta B', imageIds: [], imageData: {} })

    // Both are live at the same time — the whole point.
    expect(run().running.has('A')).toBe(true)
    expect(run().running.has('B')).toBe(true)

    // Finish them out of order; each answer lands in its own transcript.
    runs.get('A')!.resolve('resposta A')
    runs.get('B')!.resolve('resposta B')
    await flush()

    // B is on screen; A is parked. Neither answer bled into the other.
    expect(run().messages.at(-1)).toEqual({ role: 'assistant', content: 'resposta B' })
    expect(run().parked['A'].messages.at(-1)).toEqual({ role: 'assistant', content: 'resposta A' })
    expect(run().running.size).toBe(0)
  })

  it('bills each run to its own conversation while the other is on screen', async () => {
    const runs = captureRuns()

    useAiRunStore.setState({ conversationId: 'A', messages: [] })
    void run().send(cfg, { text: 'a', imageIds: [], imageData: {} })
    run().openConversation({ id: 'B', messages: [] })
    void run().send(cfg, { text: 'b', imageIds: [], imageData: {} })

    // A's call reports usage while B is the chat on screen.
    ;(runs.get('A')!.opts.onUsage as (u: unknown) => void)({ promptTokens: 100, completionTokens: 20 })
    await flush()

    // It bills A (parked), never the chat merely being looked at.
    expect(run().parked['A'].usage).toEqual({ promptTokens: 100, completionTokens: 20 })
    expect(run().usage).toEqual({ promptTokens: 0, completionTokens: 0 })

    runs.get('A')!.resolve('ok')
    runs.get('B')!.resolve('ok')
    await flush()
  })

  it('tracks each live run\'s own token spend, and clears it when the run ends', async () => {
    const runs = captureRuns()

    useAiRunStore.setState({ conversationId: 'A', messages: [] })
    void run().send(cfg, { text: 'a', imageIds: [], imageData: {} })

    // The run reports two calls; runUsage accumulates only this run's spend.
    ;(runs.get('A')!.opts.onUsage as (u: unknown) => void)({ promptTokens: 100, completionTokens: 20 })
    ;(runs.get('A')!.opts.onUsage as (u: unknown) => void)({ promptTokens: 50, completionTokens: 10 })
    await flush()
    expect(run().runUsage['A']).toEqual({ promptTokens: 150, completionTokens: 30 })

    runs.get('A')!.resolve('ok')
    await flush()
    // Cleared once the run ends — the panel only shows live agents.
    expect(run().runUsage['A']).toBeUndefined()
  })

  it('records which project each run works on, and clears it when the run ends', async () => {
    const runs = captureRuns()
    useKanbanStore.setState({ activeProjectId: 'proj-1' })

    useAiRunStore.setState({ conversationId: 'A', messages: [] })
    void run().send(cfg, { text: 'a', imageIds: [], imageData: {} })

    expect(run().runProjects['A']).toBe('proj-1')

    runs.get('A')!.resolve('ok')
    await flush()

    expect(run().runProjects['A']).toBeUndefined()
  })

  it('blocks a second run of the same conversation, but not of another', async () => {
    captureRuns()

    useAiRunStore.setState({ conversationId: 'A', messages: [] })
    void run().send(cfg, { text: 'a', imageIds: [], imageData: {} })
    // Same chat again while it runs: ignored (one run per conversation).
    void run().send(cfg, { text: 'again', imageIds: [], imageData: {} })

    expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1)
  })
})
