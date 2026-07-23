import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the tool registry so the loop test controls tool execution in isolation
// (the real tools are covered in tools.test.ts).
vi.mock('../../ai/tools', () => ({
  TOOL_DEFS: [{ type: 'function', function: { name: 'ler_x', description: '', parameters: {} } }],
  runTool: vi.fn((name: string) => JSON.stringify({ ran: name })),
  isWriteTool: vi.fn((name: string) => name.startsWith('escrever')),
  describeToolActivity: vi.fn((name: string) => `Fazendo ${name}`)
}))

import {
  runAgent,
  SYSTEM_PROMPT,
  resolveMaxSteps,
  isRetryable,
  backoffDelay,
  MAX_STEPS,
  AUTO_MAX_STEPS,
  MAX_STEPS_LIMIT,
  READ_REPEAT_LIMIT,
  BLIND_FILE_READ_LIMIT,
  MAX_RETRIES,
  RETRY_BASE_MS,
  pruneSupersededResults,
  measurePrunedCall,
  ELIDED,
  summarizeRunCost,
  routeModel,
  type ApiMessage
} from '../../ai/agent'
import { runTool } from '../../ai/tools'

interface ChatResponse {
  success: boolean
  message?: { role: string; content: string; tool_calls?: unknown[] }
  error?: string
  /** Provider HTTP status, as the main process forwards it — drives retry policy. */
  status?: number
  /** Absent when the provider reported none — many local servers don't. */
  usage?: { promptTokens: number; completionTokens: number }
}

type ChatMock = ReturnType<typeof vi.fn>

/** Read the request object passed to the i-th chat call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reqAt(chat: ChatMock, i: number): { messages: any[]; tools?: unknown } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chat.mock.calls as any[])[i][0]
}

const cfg = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
const user = [{ role: 'user' as const, content: 'oi' }]

function installChat(mock: ChatMock): void {
  ;(window as unknown as { electronAPI: { ai: { chat: unknown } } }).electronAPI = {
    ai: { chat: mock }
  }
}

/**
 * A chat mock returning the given responses in order, then repeating the last
 * one — a provider that keeps failing keeps failing, and retries would other-
 * wise run off the end of the queue and get undefined.
 */
function makeChat(...responses: ChatResponse[]): ChatMock {
  const mock = vi.fn() as ChatMock
  for (const r of responses) mock.mockResolvedValueOnce(r)
  if (responses.length > 0) mock.mockResolvedValue(responses[responses.length - 1])
  installChat(mock)
  return mock
}

function toolCall(id: string, name: string, args = '{}'): unknown {
  return { id, type: 'function', function: { name, arguments: args } }
}

const approveNone = vi.fn(async () => new Set<string>())

describe('SYSTEM_PROMPT (loaded from system-prompt.md)', () => {
  it('reaches the model as the system message', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })

    await runAgent(cfg, user, approveNone)

    const [system] = reqAt(chat, 0).messages
    expect(system.role).toBe('system')
    expect(system.content).toBe(SYSTEM_PROMPT)
  })

  it('is real text, not an empty raw import', () => {
    // A ?raw import that silently resolved to '' would leave every test green
    // while the assistant lost its instructions.
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200)
    expect(SYSTEM_PROMPT.startsWith('Você é o assistente do Sagyou')).toBe(true)
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT.trim())
  })

  // Deliberately not asserted here: the prompt's exact wording. Pinning it would
  // mean re-pasting the whole text into this file on every edit — re-creating in
  // the test the string literal the .md exists to get rid of. The checks above
  // catch the pipeline breaking; the wording is meant to change.

  it('prepends the memory briefing when the bridge returns one', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    const briefing = vi.fn(async () => ({ text: '## Memória\n- [fato] X' }))
    ;(window as unknown as { electronAPI: { ai: Record<string, unknown> } }).electronAPI.ai.memory =
      { briefing }

    await runAgent(cfg, user, approveNone, { projectId: 'p1' })

    expect(briefing).toHaveBeenCalledWith('p1')
    const [system] = reqAt(chat, 0).messages
    expect(system.content.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(system.content).toContain('## Memória\n- [fato] X')
  })

  it('leaves the prompt untouched when the briefing fails', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    ;(window as unknown as { electronAPI: { ai: Record<string, unknown> } }).electronAPI.ai.memory =
      { briefing: vi.fn(async () => { throw new Error('boom') }) }

    await runAgent(cfg, user, approveNone, { projectId: 'p1' })

    expect(reqAt(chat, 0).messages[0].content).toBe(SYSTEM_PROMPT)
  })

  it('notes the decay pass only when it archived something', async () => {
    makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    ;(window as unknown as { electronAPI: { ai: Record<string, unknown> } }).electronAPI.ai.memory =
      { briefing: vi.fn(async () => ({ text: '', archived: 3 })) }
    const onStatus = vi.fn()

    await runAgent(cfg, user, approveNone, { projectId: 'p1', onStatus })

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('3 memória'), 'remark')
  })

  it('stays silent when the decay pass archived nothing', async () => {
    makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    ;(window as unknown as { electronAPI: { ai: Record<string, unknown> } }).electronAPI.ai.memory =
      { briefing: vi.fn(async () => ({ text: '', archived: 0 })) }
    const onStatus = vi.fn()

    await runAgent(cfg, user, approveNone, { projectId: 'p1', onStatus })

    expect(onStatus).not.toHaveBeenCalledWith(expect.stringContaining('arquivada'), 'remark')
  })
})

describe('routeModel', () => {
  const base = { baseUrl: 'http://x', apiKey: 'k', model: 'flash' }

  it('always uses the single model when no modelComplex is set', () => {
    expect(routeModel('investigar um bug no código', base)).toBe('flash')
  })

  it('routes a code/analysis task to modelComplex', () => {
    const c = { ...base, modelComplex: 'pro' }
    expect(routeModel('preciso refatorar a arquitetura', c)).toBe('pro')
    expect(routeModel('tem um BUG aqui?', c)).toBe('pro')
    // Accent-insensitive: "código"/"exceção" match the ASCII stems.
    expect(routeModel('o código lança uma exceção', c)).toBe('pro')
  })

  it('keeps a plain task on the cheaper model', () => {
    const c = { ...base, modelComplex: 'pro' }
    expect(routeModel('quantas tasks eu concluí essa semana?', c)).toBe('flash')
    expect(routeModel('marca o hábito de correr como feito', c)).toBe('flash')
  })

  it('is applied by runAgent to the model that actually gets called', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    await runAgent(
      { ...cfg, modelComplex: 'pro' },
      [{ role: 'user', content: 'como funciona esse código?' }],
      approveNone
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reqAt(chat, 0) as any).model).toBe('pro')
  })
})

describe('runAgent — token usage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports every call, since a turn is billed per call not per answer', async () => {
    makeChat(
      {
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] },
        usage: { promptTokens: 100, completionTokens: 10 }
      },
      {
        success: true,
        message: { role: 'assistant', content: 'FINAL' },
        usage: { promptTokens: 250, completionTokens: 40 }
      }
    )
    const seen: { promptTokens: number; completionTokens: number }[] = []

    await runAgent(cfg, user, approveNone, { onUsage: (u) => seen.push(u) })

    expect(seen).toEqual([
      { promptTokens: 100, completionTokens: 10 },
      { promptTokens: 250, completionTokens: 40 }
    ])
  })

  it('says nothing when the provider reports no usage', async () => {
    // Plenty of local servers don't report usage. That's unknown, not zero.
    makeChat({ success: true, message: { role: 'assistant', content: 'FINAL' } })
    const onUsage = vi.fn()

    await runAgent(cfg, user, approveNone, { onUsage })

    expect(onUsage).not.toHaveBeenCalled()
  })

  it('does not bill a failed attempt, only the retry that landed', async () => {
    vi.useFakeTimers()
    makeChat(
      { success: false, error: '503', status: 503 },
      {
        success: true,
        message: { role: 'assistant', content: 'FINAL' },
        usage: { promptTokens: 30, completionTokens: 5 }
      }
    )
    const seen: unknown[] = []

    const p = runAgent(cfg, user, approveNone, { onUsage: (u) => seen.push(u) })
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()

    expect(seen).toEqual([{ promptTokens: 30, completionTokens: 5 }])
  })
})

describe('isRetryable', () => {
  it('retries transient provider failures', () => {
    for (const s of [429, 408, 500, 502, 503, 504]) expect(isRetryable(s)).toBe(true)
  })

  it('retries a call that never reached a response', () => {
    // No status = DNS failure, refused connection, dropped socket.
    expect(isRetryable(undefined)).toBe(true)
  })

  it('does not retry a failure that will never succeed', () => {
    // A wrong key must say "401" now, not after three backoffs.
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryable(s)).toBe(false)
  })
})

describe('backoffDelay', () => {
  it('doubles each attempt and stays jittered within the step', () => {
    for (const attempt of [0, 1, 2, 3]) {
      const base = RETRY_BASE_MS * 2 ** attempt
      const d = backoffDelay(attempt)
      expect(d).toBeGreaterThanOrEqual(base)
      expect(d).toBeLessThan(base + RETRY_BASE_MS)
    }
    expect(backoffDelay(2)).toBeGreaterThanOrEqual(backoffDelay(0))
  })
})

describe('resolveMaxSteps', () => {
  it('keeps the per-mode defaults when nothing is configured', () => {
    expect(resolveMaxSteps(undefined, false)).toBe(MAX_STEPS)
    expect(resolveMaxSteps(undefined, true)).toBe(AUTO_MAX_STEPS)
  })

  it('lets a configured value win in BOTH modes', () => {
    // 23 on purpose: it matches neither default, so this cannot pass by
    // accidentally agreeing with the fallback it is meant to override.
    expect(MAX_STEPS).not.toBe(23)
    expect(AUTO_MAX_STEPS).not.toBe(23)
    // The point of the setting: more steps without giving up approval.
    expect(resolveMaxSteps(23, false)).toBe(23)
    // And a deliberate value is not silently overridden by automatic's default.
    expect(resolveMaxSteps(23, true)).toBe(23)
  })

  it('caps at the limit, however it was set', () => {
    expect(resolveMaxSteps(999, false)).toBe(MAX_STEPS_LIMIT)
    expect(resolveMaxSteps(MAX_STEPS_LIMIT + 1, true)).toBe(MAX_STEPS_LIMIT)
  })

  it('falls back rather than trusting nonsense from a hand-edited config', () => {
    for (const bad of [0, -3, NaN, Infinity, '12', null, {}]) {
      expect(resolveMaxSteps(bad, false)).toBe(MAX_STEPS)
      expect(resolveMaxSteps(bad, true)).toBe(AUTO_MAX_STEPS)
    }
  })

  it('floors a fractional value', () => {
    expect(resolveMaxSteps(7.9, false)).toBe(7)
  })
})

describe('runAgent — retry with backoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers() // the backoff must not make the suite actually sleep
  })
  afterEach(() => vi.useRealTimers())

  /**
   * Runs the agent to completion, letting every pending backoff elapse. The
   * result is captured before the timers are drained: otherwise a rejection
   * sits unhandled while we await, which Node reports as an unhandled rejection.
   */
  const runAll = async (opts = {}): Promise<string> => {
    const settled = runAgent(cfg, user, approveNone, opts).then(
      (value) => () => value,
      (err: unknown) => () => {
        throw err
      }
    )
    await vi.runAllTimersAsync()
    return (await settled)()
  }

  it('rides out a transient failure and keeps the progress so far', async () => {
    const chat = makeChat(
      // Step 1 does real work…
      {
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] }
      },
      // …then the provider blips.
      { success: false, error: '503 upstream', status: 503 },
      // The retry lands, and the run finishes with step 1's work intact.
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )

    const result = await runAll()

    expect(result).toBe('FINAL')
    expect(chat).toHaveBeenCalledTimes(3)
    // The tool ran once; the retry must not replay it.
    expect(runTool).toHaveBeenCalledTimes(1)
    // The retry resends the conversation built so far, tool result and all.
    expect(reqAt(chat, 2).messages.some((m: { role: string }) => m.role === 'tool')).toBe(true)
  })

  it('gives up after MAX_RETRIES and surfaces the last error', async () => {
    const chat = makeChat(
      ...Array.from({ length: MAX_RETRIES + 1 }, () => ({
        success: false as const,
        error: '503 upstream',
        status: 503
      }))
    )

    await expect(runAll()).rejects.toThrow('503 upstream')
    expect(chat).toHaveBeenCalledTimes(MAX_RETRIES + 1) // first try + the retries
  })

  it('does not retry a permanent failure', async () => {
    const chat = makeChat({ success: false, error: '401 invalid key', status: 401 })

    await expect(runAll()).rejects.toThrow('401 invalid key')
    // Retrying a bad key just delays the message the user needs.
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('stops retrying once the user has aborted', async () => {
    // Abort lands while the first attempt is in flight, so the retry is the
    // thing under test — not the loop's own top-of-iteration abort check.
    let aborted = false
    const chat = vi.fn() as ChatMock
    chat.mockImplementationOnce(async () => {
      aborted = true
      return { success: false, error: '503', status: 503 }
    })
    chat.mockResolvedValue({ success: true, message: { role: 'assistant', content: 'FINAL' } })
    installChat(chat)

    // Handler attached before draining timers, or the rejection floats.
    const settled = runAgent(cfg, user, approveNone, { shouldAbort: () => aborted }).catch(
      (e: Error) => e
    )
    await vi.runAllTimersAsync()
    expect(await settled).toMatchObject({ message: '503' })

    // Stop means stop: no backoff, no further attempt.
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('tells the user it is retrying', async () => {
    makeChat(
      { success: false, error: '503 upstream', status: 503 },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )
    const status: string[] = []

    await runAll({ onStatus: (t: string) => status.push(t) })

    // A silent multi-second stall looks like a hang.
    expect(status).toHaveLength(1)
    expect(status[0]).toContain('Tentando de novo')
    expect(status[0]).toContain('503 upstream')
  })

  it('retypes the answer from scratch after a half-streamed attempt', async () => {
    // First attempt streams "Oi, eu" then dies; the retry streams the full text.
    const chat = vi.fn() as ChatMock
    chat.mockImplementationOnce(async (_req: unknown, onDelta?: (c: string) => void) => {
      onDelta?.('Oi, eu')
      return { success: false, error: '503', status: 503 }
    })
    chat.mockImplementationOnce(async (_req: unknown, onDelta?: (c: string) => void) => {
      onDelta?.('Olá!')
      return { success: true, message: { role: 'assistant', content: 'Olá!' } }
    })
    ;(window as unknown as { electronAPI: { ai: { chat: unknown; chatStream: unknown } } }).electronAPI =
      { ai: { chat: chat, chatStream: chat } }
    const streamed: string[] = []

    const p = runAgent(cfg, user, approveNone, { onStream: (t) => streamed.push(t) })
    await vi.runAllTimersAsync()
    await p

    // The dead attempt's text must not be left in front of the retry's.
    expect(streamed.at(-1)).toBe('Olá!')
    expect(streamed.some((s) => s.includes('Oi, euOlá!'))).toBe(false)
  })
})

describe('runAgent (tool-calling loop)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('runs a read tool, feeds the result back, and stops on a text answer', async () => {
    const chat = makeChat(
      { success: true, message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] } },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('FINAL')
    expect(chat).toHaveBeenCalledTimes(2)
    // The 3rd arg is the owning convId, threaded to the tool layer; absent here.
    expect(runTool).toHaveBeenCalledWith('ler_x', {}, undefined)
    expect(approveNone).not.toHaveBeenCalled() // reads are not gated

    // First request is prefixed with the system prompt.
    expect(reqAt(chat, 0).messages[0].role).toBe('system')

    // The tool result was fed back on the second request.
    const secondMsgs = reqAt(chat, 1).messages
    const toolMsg = secondMsgs.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg.tool_call_id).toBe('c1')
    expect(JSON.parse(toolMsg.content)).toEqual({ ran: 'ler_x' })
  })

  it('gates write tools: approved ones run, denied ones report back to the model', async () => {
    const chat = makeChat(
      {
        success: true,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [toolCall('c1', 'escrever_a'), toolCall('c2', 'escrever_b')]
        }
      },
      { success: true, message: { role: 'assistant', content: 'DONE' } }
    )
    const onApprove = vi.fn(async () => new Set(['c1']))

    const result = await runAgent(cfg, user, onApprove)

    expect(result).toBe('DONE')
    expect(onApprove).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writes = (onApprove.mock.calls as any[])[0][0] as Array<{ id: string }>
    expect(writes.map((w) => w.id).sort()).toEqual(['c1', 'c2'])

    // Only the approved write executed. (3rd arg is the owning convId, absent here.)
    expect(runTool).toHaveBeenCalledWith('escrever_a', {}, undefined)
    expect(runTool).not.toHaveBeenCalledWith('escrever_b', {}, undefined)

    const msgs = reqAt(chat, 1).messages
    const r1 = msgs.find((m: { tool_call_id?: string }) => m.tool_call_id === 'c1')
    const r2 = msgs.find((m: { tool_call_id?: string }) => m.tool_call_id === 'c2')
    expect(JSON.parse(r1.content)).toEqual({ ran: 'escrever_a' })
    expect(JSON.parse(r2.content)).toEqual({ error: 'Ação recusada pelo usuário' })
  })

  it('stops after MAX_STEPS and forces a final answer with tools disabled', async () => {
    let n = 0
    // Unique args per call so the repeated-read brake doesn't fire — this test
    // is about the step cap, not the loop-detection brake.
    const chat = vi.fn((req: { tools?: unknown }) => {
      const i = n++
      return req.tools
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + i, 'ler_x', JSON.stringify({ i }))] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'CAP' } })
    }) as ChatMock
    installChat(chat)

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('CAP')
    // MAX_STEPS tool iterations + 1 final tools-disabled call. Off the constant,
    // not a literal: this pins the cap's *shape*, and retuning the default is a
    // product decision that must not read as a broken test.
    expect(chat).toHaveBeenCalledTimes(MAX_STEPS + 1)
    expect(reqAt(chat, MAX_STEPS).tools).toBeUndefined()
    expect(runTool).toHaveBeenCalledTimes(MAX_STEPS)
  })

  it('numbers each status line with the step and the run\'s own cap', async () => {
    let n = 0
    const chat = vi.fn((req: { tools?: unknown }) => {
      const i = n++
      return req.tools && i < 2
        ? Promise.resolve({
            success: true,
            message: {
              role: 'assistant',
              content: 'olhando',
              tool_calls: [toolCall('c' + i, 'ler_x', JSON.stringify({ i }))]
            }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'pronto' } })
    }) as ChatMock
    installChat(chat)
    const onStatus = vi.fn()

    await runAgent(cfg, user, approveNone, { maxSteps: 7, onStatus })

    // The denominator is the *resolved* cap for this run, not the constant —
    // maxSteps is a user setting, so a badge against the default would lie.
    const progress = onStatus.mock.calls.map((c) => c[2])
    expect(progress.every((p) => p?.maxSteps === 7)).toBe(true)
    // 1-based, and the remark plus the tool line of one step share its number:
    // they are the same round, and numbering them apart would overstate spend.
    expect(progress.map((p) => p?.step)).toEqual([1, 1, 2, 2])
  })

  it('leaves a retry notice unnumbered — it is the same step, not a new one', async () => {
    vi.useFakeTimers() // the backoff must not make the suite actually sleep
    makeChat(
      { success: false, error: '503', status: 503 },
      { success: true, message: { role: 'assistant', content: 'ok' } }
    )
    const onStatus = vi.fn()

    const p = runAgent(cfg, user, approveNone, { maxSteps: 7, onStatus })
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()

    const retry = onStatus.mock.calls.find((c) => /Tentando de novo/i.test(c[0] as string))
    expect(retry).toBeDefined()
    expect(retry?.[2]).toBeUndefined()
  })

  it('announces that it stopped for lack of steps, not because it finished', async () => {
    let n = 0
    const chat = vi.fn((req: { tools?: unknown }) => {
      const i = n++
      return req.tools
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + i, 'ler_x', JSON.stringify({ i }))] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'resumo parcial' } })
    }) as ChatMock
    installChat(chat)
    const onStatus = vi.fn()

    await runAgent(cfg, user, approveNone, { maxSteps: 3, onStatus })

    // The forced answer reads like any other, so the transcript must carry the
    // reason the run ended — otherwise a truncated task looks like a done one.
    const said = onStatus.mock.calls.map((c) => c[0]).join('\n')
    expect(said).toMatch(/limite de 3 passos/i)
    expect(said).toMatch(/incompleta/i)
  })

  it('stays quiet about the cap on a run that concluded on its own', async () => {
    // The counterpart of the test above: a healthy run returns from inside the
    // loop, so the warning must not fire — a false one would teach the user to
    // ignore it exactly when it matters.
    makeChat({ success: true, message: { role: 'assistant', content: 'pronto' } })
    const onStatus = vi.fn()

    await runAgent(cfg, user, approveNone, { maxSteps: 3, onStatus })

    const said = onStatus.mock.calls.map((c) => c[0]).join('\n')
    expect(said).not.toMatch(/limite de/i)
  })

  /** A model that always calls a tool, so the run only ends at the cap. */
  const alwaysToolCalling = (): ChatMock => {
    let n = 0
    // Unique args per call, or the repeated-read brake would stop the tool long
    // before the step cap these tests are exercising.
    const chat = vi.fn((req: { tools?: unknown }) => {
      const i = n++
      return req.tools
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + i, 'ler_x', JSON.stringify({ i }))] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'CAP' } })
    }) as ChatMock
    installChat(chat)
    return chat
  }

  it('honours a raised maxSteps', async () => {
    const chat = alwaysToolCalling()

    await runAgent(cfg, user, approveNone, { maxSteps: 12 })

    expect(runTool).toHaveBeenCalledTimes(12)
    expect(chat).toHaveBeenCalledTimes(13) // 12 iterations + the final call
  })

  it('clamps a runaway maxSteps to the limit', async () => {
    const chat = alwaysToolCalling()

    // Each step is a paid model call, so a hand-edited 999 must not be honoured.
    await runAgent(cfg, user, approveNone, { maxSteps: 999 })

    expect(runTool).toHaveBeenCalledTimes(MAX_STEPS_LIMIT)
    expect(chat).toHaveBeenCalledTimes(MAX_STEPS_LIMIT + 1)
  })

  it('falls back to MAX_STEPS when handed a nonsense cap', async () => {
    const chat = alwaysToolCalling()

    await runAgent(cfg, user, approveNone, { maxSteps: 0 })

    // 0 would otherwise mean "never call a tool at all".
    expect(runTool).toHaveBeenCalledTimes(MAX_STEPS)
    expect(chat).toHaveBeenCalledTimes(MAX_STEPS + 1)
  })

  it('propagates a model error', async () => {
    // No status → retryable, so let it exhaust the attempts and still surface.
    makeChat({ success: false, error: 'boom' })
    const settled = runAgent(cfg, user, approveNone).catch((e: Error) => e)
    await vi.runAllTimersAsync()
    expect(await settled).toMatchObject({ message: 'boom' })
  })

  it('reports the interim remark and each tool it runs to onStatus', async () => {
    makeChat(
      {
        success: true,
        message: {
          role: 'assistant',
          content: '  Deixa eu ver as tasks  ',
          tool_calls: [toolCall('c1', 'ler_x')]
        }
      },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )
    const status: string[] = []

    const result = await runAgent(cfg, user, approveNone, { onStatus: (t) => status.push(t) })

    // The remark (trimmed) precedes the tool it led to; the final answer is not
    // a status — it's returned as the assistant's message.
    expect(status).toEqual(['Deixa eu ver as tasks', 'Fazendo ler_x'])
    expect(result).toBe('FINAL')
  })

  it('tags the remark and the tool line so the caller can tell them apart', async () => {
    makeChat(
      {
        success: true,
        message: {
          role: 'assistant',
          content: 'Deixa eu ver',
          tool_calls: [toolCall('c1', 'ler_x')]
        }
      },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )
    const kinds: (string | undefined)[] = []

    await runAgent(cfg, user, approveNone, { onStatus: (_t, kind) => kinds.push(kind) })

    expect(kinds).toEqual(['remark', 'tool'])
  })

  it('closes the tool status only once the tool has actually returned', async () => {
    makeChat(
      {
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] }
      },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )
    // A tool that resolves later, so an onToolEnd fired eagerly would show up
    // before the tool's own trace entry.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    vi.mocked(runTool).mockImplementationOnce(async () => {
      await gate
      trace.push('tool returned')
      return '{}'
    })
    const trace: string[] = []

    const run = runAgent(cfg, user, approveNone, {
      onStatus: (t, kind) => trace.push(`status:${kind}:${t}`),
      onToolEnd: () => trace.push('toolEnd')
    })
    await vi.advanceTimersByTimeAsync(0) // let the loop reach the tool call
    expect(trace).toEqual(['status:tool:Fazendo ler_x'])

    release()
    await run

    expect(trace).toEqual(['status:tool:Fazendo ler_x', 'tool returned', 'toolEnd'])
  })

  it('closes the tool status even when the tool throws', async () => {
    makeChat({
      success: true,
      message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] }
    })
    vi.mocked(runTool).mockRejectedValueOnce(new Error('tool boom'))
    const onToolEnd = vi.fn()

    // Otherwise the line would spin forever on a failed call.
    await expect(runAgent(cfg, user, approveNone, { onToolEnd })).rejects.toThrow('tool boom')
    expect(onToolEnd).toHaveBeenCalledTimes(1)
  })

  it('does not report a status for a tool the user denied', async () => {
    makeChat(
      {
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('w1', 'escrever_x')] }
      },
      { success: true, message: { role: 'assistant', content: 'ok' } }
    )
    const status: string[] = []

    await runAgent(cfg, user, approveNone, { onStatus: (t) => status.push(t) })

    expect(status).toEqual([])
    expect(runTool).not.toHaveBeenCalled()
  })

  it('handles invalid tool arguments without calling runTool', async () => {
    const chat = makeChat(
      {
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x', 'not json')] }
      },
      { success: true, message: { role: 'assistant', content: 'OK' } }
    )

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('OK')
    expect(runTool).not.toHaveBeenCalled()
    const msgs = reqAt(chat, 1).messages
    const r = msgs.find((m: { tool_call_id?: string }) => m.tool_call_id === 'c1')
    expect(JSON.parse(r.content)).toEqual({ error: 'Argumentos inválidos (JSON)' })
  })

  // ── soft brake on a repeated read (loop detection) ─────────────────────────
  //
  // A model that keeps making the identical read call is looping. The brake
  // stops running it on the READ_REPEAT_LIMIT-th try and feeds back a nudge, so
  // the run can conclude instead of burning every step re-fetching the same
  // answer — complementary to maxSteps, not a replacement.

  it('stops re-running a read the model keeps repeating and lets it conclude', async () => {
    // Model asks for the same read every step, until it sees the brake nudge —
    // then it answers, the way a real model is meant to.
    let n = 0
    const chat = vi.fn((req: { tools?: unknown; messages: { role: string; content: string }[] }) => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool' && last.content.includes('Não repita')) {
        return Promise.resolve({ success: true, message: { role: 'assistant', content: 'CONCLUÍDO' } })
      }
      return Promise.resolve({
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + n++, 'ler_x')] }
      })
    }) as ChatMock
    installChat(chat)

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('CONCLUÍDO')
    // Ran twice; the third identical call was braked, not executed.
    expect(runTool).toHaveBeenCalledTimes(READ_REPEAT_LIMIT - 1)
    // The run ended well short of MAX_STEPS: 2 reads + 1 braked step + 1 answer.
    expect(chat).toHaveBeenCalledTimes(4)
  })

  it('feeds the brake back as an ordinary tool result the model can read', async () => {
    let n = 0
    const chat = vi.fn((req: { tools?: unknown; messages: { role: string; content: string }[] }) => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool' && last.content.includes('Não repita')) {
        return Promise.resolve({ success: true, message: { role: 'assistant', content: 'FIM' } })
      }
      return Promise.resolve({
        success: true,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + n++, 'ler_x')] }
      })
    }) as ChatMock
    installChat(chat)

    await runAgent(cfg, user, approveNone)

    // The braked step's tool message carries the nudge, addressed to the call id.
    const braked = reqAt(chat, 3).messages.find(
      (m: { tool_call_id?: string }) => m.tool_call_id === 'c2'
    )
    expect(JSON.parse(braked.content).error).toContain('Não repita')
  })

  it('does not brake different reads that only share a name', async () => {
    // Same tool, different args each time — legitimate exploration, never braked.
    let n = 0
    const chat = vi.fn((req: { tools?: unknown }) => {
      const i = n++
      return req.tools && i < 4
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + i, 'ler_x', JSON.stringify({ i }))] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'DONE' } })
    }) as ChatMock
    installChat(chat)

    await runAgent(cfg, user, approveNone)

    // All four distinct reads executed — none looked like a repeat.
    expect(runTool).toHaveBeenCalledTimes(4)
  })

  it('never brakes a write, however often it repeats', async () => {
    // Repeated identical writes are distinct events, not a loop — rule 1.
    let n = 0
    const chat = vi.fn((req: { tools?: unknown }) =>
      req.tools
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('w' + n++, 'escrever_x')] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'CAP' } })
    ) as ChatMock
    installChat(chat)
    const approveAll = vi.fn(async (writes: { id: string }[]) => new Set(writes.map((w) => w.id)))

    await runAgent(cfg, user, approveAll)

    // Executed on every step up to the cap — the brake left it alone.
    expect(runTool).toHaveBeenCalledTimes(MAX_STEPS)
  })

  // ── blind whole-file re-read brake (Task 5) ────────────────────────────────
  //
  // ler_arquivo on the same path with no targeting arg is the model re-fetching
  // a file it already has. The brake fires on the BLIND_FILE_READ_LIMIT-th such
  // read (2), tighter than the exact-repeat brake, and nudges toward a scope.

  it('brakes a second blind read of the same file and nudges toward a scope', async () => {
    let n = 0
    const chat = vi.fn(
      (req: { messages: { role: string; content: string; tool_call_id?: string }[] }) => {
        const last = req.messages[req.messages.length - 1]
        if (typeof last?.content === 'string' && last.content.includes('inteiro nesta execução')) {
          return Promise.resolve({ success: true, message: { role: 'assistant', content: 'PRONTO' } })
        }
        return Promise.resolve({
          success: true,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall(`c${n++}`, 'ler_arquivo', JSON.stringify({ caminho: 'store/kanban.ts' }))]
          }
        })
      }
    ) as ChatMock
    installChat(chat)

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('PRONTO')
    // First blind read ran; the second was braked before executing.
    expect(runTool).toHaveBeenCalledTimes(BLIND_FILE_READ_LIMIT - 1)
    const braked = reqAt(chat, 2).messages.find(
      (m: { tool_call_id?: string }) => m.tool_call_id === 'c1'
    )
    expect(JSON.parse(braked.content).error).toContain('inteiro nesta execução')
  })

  it('does not brake a re-read of the same file when it is scoped', async () => {
    // Blind read, then a symbol read of the same file: legitimate narrowing,
    // never braked. The symbol read carries a targeting arg, so it doesn't count.
    let n = 0
    const args = [
      JSON.stringify({ caminho: 'store/kanban.ts' }),
      JSON.stringify({ caminho: 'store/kanban.ts', simbolo: 'exportBackup' })
    ]
    const chat = vi.fn((req: { tools?: unknown }) => {
      if (n < args.length && req.tools) {
        return Promise.resolve({
          success: true,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall(`c${n}`, 'ler_arquivo', args[n++])]
          }
        })
      }
      return Promise.resolve({ success: true, message: { role: 'assistant', content: 'FIM' } })
    }) as ChatMock
    installChat(chat)

    await runAgent(cfg, user, approveNone)

    // Both reads executed — the scoped one was never counted as a blind repeat.
    expect(runTool).toHaveBeenCalledTimes(2)
  })

  // ── fuzzy-duplicate search warning (Task 4) ────────────────────────────────

  it('warns on a fuzzy-duplicate search but still runs it', async () => {
    let n = 0
    const terms = ['backup', 'exportBackup']
    const chat = vi.fn((req: { tools?: unknown }) => {
      if (n < terms.length && req.tools) {
        return Promise.resolve({
          success: true,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall(`c${n}`, 'buscar_no_codigo', JSON.stringify({ termo: terms[n++] }))]
          }
        })
      }
      return Promise.resolve({ success: true, message: { role: 'assistant', content: 'FIM' } })
    }) as ChatMock
    installChat(chat)

    await runAgent(cfg, user, approveNone)

    // Both searches ran — a fuzzy dup only warns, never blocks.
    expect(runTool).toHaveBeenCalledTimes(2)
    // The second search's result, resent on the next call, carries the nudge.
    const second = reqAt(chat, 2).messages.find(
      (m: { tool_call_id?: string }) => m.tool_call_id === 'c1'
    )
    expect(JSON.parse(second.content).aviso).toContain('backup')
    // The first search has no earlier term to duplicate, so no warning.
    const first = reqAt(chat, 2).messages.find(
      (m: { tool_call_id?: string }) => m.tool_call_id === 'c0'
    )
    expect(JSON.parse(first.content).aviso).toBeUndefined()
  })
})

describe('summarizeRunCost', () => {
  const base = { baseUrl: '', apiKey: '', model: 'm' }

  it('returns null when the provider billed nothing', () => {
    expect(summarizeRunCost(base, [{ step: 1, prompt: 0, completion: 0, tools: [] }])).toBeNull()
  })

  it('totals billed calls and ranks the costliest first', () => {
    const s = summarizeRunCost(base, [
      { step: 1, prompt: 100, completion: 10, tools: ['ler_tasks'] },
      { step: 2, prompt: 900, completion: 50, tools: ['ler_arquivo'] },
      { step: 3, prompt: 0, completion: 0, tools: [] } // unbilled — dropped
    ])
    expect(s).toMatchObject({
      calls: 2,
      promptTokens: 1000,
      completionTokens: 60,
      totalTokens: 1060,
      costUsd: null
    })
    expect(s?.top[0].step).toBe(2)
  })

  it('estimates a dollar cost only when both prices are set', () => {
    const priced = { ...base, inputPricePer1M: 1, outputPricePer1M: 2 }
    const s = summarizeRunCost(priced, [
      { step: 1, prompt: 1_000_000, completion: 1_000_000, tools: [] }
    ])
    // 1M prompt × $1 + 1M output × $2 = $3.
    expect(s?.costUsd).toBeCloseTo(3)
    // With only one price set, no estimate is invented.
    const half = summarizeRunCost({ ...base, inputPricePer1M: 1 }, [
      { step: 1, prompt: 100, completion: 100, tools: [] }
    ])
    expect(half?.costUsd).toBeNull()
  })
})

describe('runAgent — run metrics (Task 8)', () => {
  beforeEach(() => vi.clearAllMocks())

  /** The shape the agent sends to ai.runMetrics.append. */
  interface MetricArg {
    model: string
    steps: number
    totalTokens: number
    redundantSearches: number
    repeatedReads: number
    hitStepCap: boolean
  }
  type AppendMock = ReturnType<typeof vi.fn<(m: MetricArg) => Promise<void>>>

  function installWithMetrics(chat: ChatMock, append: AppendMock): void {
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      ai: { chat, runMetrics: { append } }
    }
  }

  it('reports steps, tokens and the waste counters to the metrics bridge', async () => {
    // Two blind reads of the same file: the second is braked (repeatedReads 1),
    // then the model answers. Every call reports usage, so tokens are non-zero.
    let n = 0
    const usage = { promptTokens: 10, completionTokens: 5 }
    const chat = vi.fn(
      (req: { messages: { content: string }[] }) => {
        const last = req.messages[req.messages.length - 1]
        if (typeof last?.content === 'string' && last.content.includes('inteiro nesta execução')) {
          return Promise.resolve({ success: true, message: { role: 'assistant', content: 'FIM' }, usage })
        }
        return Promise.resolve({
          success: true,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall(`c${n++}`, 'ler_arquivo', JSON.stringify({ caminho: 'k.ts' }))]
          },
          usage
        })
      }
    ) as ChatMock
    const append: AppendMock = vi.fn(async () => {})
    installWithMetrics(chat, append)

    await runAgent(cfg, user, approveNone)

    expect(append).toHaveBeenCalledTimes(1)
    const m = append.mock.calls[0][0]
    expect(m).toMatchObject({ model: 'm', repeatedReads: 1, redundantSearches: 0, hitStepCap: false })
    expect(m.steps).toBeGreaterThan(0)
    expect(m.totalTokens).toBeGreaterThan(0)
  })

  it('does not record a run that never completed a step', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })
    const append: AppendMock = vi.fn(async () => {})
    installWithMetrics(chat, append)

    // shouldAbort fires before any model round completes.
    await runAgent(cfg, user, approveNone, { shouldAbort: () => true })

    expect(append).not.toHaveBeenCalled()
  })

  it('carries each step token cost on its status lines', async () => {
    const usage = { promptTokens: 100, completionTokens: 20 }
    makeChat(
      {
        success: true,
        message: { role: 'assistant', content: 'vendo', tool_calls: [toolCall('c1', 'ler_x')] },
        usage
      },
      { success: true, message: { role: 'assistant', content: 'FIM' }, usage }
    )
    const seen: { step?: number; tokens?: number }[] = []
    await runAgent(cfg, user, approveNone, {
      onStatus: (_t, _k, progress) => progress && seen.push({ step: progress.step, tokens: progress.tokens })
    })

    // Step 1's lines (the remark and the tool) both carry that call's 120 tokens.
    const step1 = seen.filter((s) => s.step === 1)
    expect(step1.length).toBeGreaterThan(0)
    expect(step1.every((s) => s.tokens === 120)).toBe(true)
  })

  it('leaves the token badge off when the provider reports no usage', async () => {
    makeChat(
      { success: true, message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] } },
      { success: true, message: { role: 'assistant', content: 'FIM' } }
    )
    const seen: (number | undefined)[] = []
    await runAgent(cfg, user, approveNone, {
      onStatus: (_t, _k, progress) => progress && seen.push(progress.tokens)
    })
    expect(seen.every((t) => t === undefined)).toBe(true)
  })

  it('runs fine when the metrics bridge is absent (older preload)', async () => {
    // window.electronAPI.ai.runMetrics is undefined — the guarded call is a no-op.
    // makeChat installs the bridge (chat only) as a side effect; no runMetrics.
    makeChat({ success: true, message: { role: 'assistant', content: 'ok' } })

    await expect(runAgent(cfg, user, approveNone)).resolves.toBe('ok')
  })
})

describe('runAgent (streaming)', () => {
  /**
   * A chatStream mock that emits the message's content one word at a time
   * through onDelta before resolving, standing in for the main process.
   */
  function makeChatStream(...responses: ChatResponse[]): ChatMock {
    const mock = vi.fn(async (_req: unknown, onDelta: (c: string) => void) => {
      const r = responses.shift() as ChatResponse
      for (const word of (r.message?.content ?? '').match(/\S+\s*/g) ?? []) onDelta(word)
      return r
    }) as unknown as ChatMock
    ;(window as unknown as { electronAPI: { ai: { chat: unknown; chatStream: unknown } } }).electronAPI =
      { ai: { chat: vi.fn(), chatStream: mock } }
    return mock
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams the accumulated text and returns the full answer', async () => {
    makeChatStream({ success: true, message: { role: 'assistant', content: 'oi tudo bem' } })
    const seen: string[] = []

    const result = await runAgent(cfg, user, approveNone, { onStream: (t) => seen.push(t) })

    expect(result).toBe('oi tudo bem')
    // Starts cleared, then grows to the full text.
    expect(seen[0]).toBe('')
    expect(seen).toEqual(['', 'oi ', 'oi tudo ', 'oi tudo bem'])
  })

  it('resets the streamed text between steps, so tool-step text is dropped', async () => {
    makeChatStream(
      {
        success: true,
        message: { role: 'assistant', content: 'pensando', tool_calls: [toolCall('c1', 'ler_x')] }
      },
      { success: true, message: { role: 'assistant', content: 'RESPOSTA' } }
    )
    const seen: string[] = []

    const result = await runAgent(cfg, user, approveNone, { onStream: (t) => seen.push(t) })

    expect(result).toBe('RESPOSTA')
    // 'pensando' is cleared as it's handed to onStatus, and again when the next
    // step opens — a redundant but harmless repeat of the same empty state.
    expect(seen).toEqual(['', 'pensando', '', '', 'RESPOSTA'])
  })

  it('uses the non-streaming call when no onStream is given', async () => {
    const chat = makeChat({ success: true, message: { role: 'assistant', content: 'x' } })
    const stream = vi.fn()
    ;(window as unknown as { electronAPI: { ai: { chatStream: unknown } } }).electronAPI.ai.chatStream =
      stream

    await runAgent(cfg, user, approveNone)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
  })
})

// ── pruneSupersededResults ─────────────────────────────────────────────────────

/**
 * `msgs` is resent in full on every step, so a stale duplicate is paid for
 * again each time. What matters here is mostly what it must NOT do — the API
 * and the model's answer both depend on this staying narrow.
 */
describe('pruneSupersededResults', () => {
  const askedFor = (id: string, name: string, args = '{}'): ApiMessage => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: args } }]
  })
  const answered = (id: string, content: string): ApiMessage => ({
    role: 'tool',
    tool_call_id: id,
    content
  })
  /** Big enough to be worth eliding — real results are kilobytes. */
  const big = (tag: string): string => JSON.stringify({ tag, filler: 'x'.repeat(500) })

  it('blanks an older result that an identical later call replaced', async () => {
    const msgs: ApiMessage[] = [
      { role: 'user', content: 'e agora?' },
      askedFor('a', 'ler_tasks'),
      answered('a', big('antigo')),
      askedFor('b', 'ler_tasks'),
      answered('b', big('novo'))
    ]

    const out = pruneSupersededResults(msgs)

    expect(out[2].content).not.toContain('antigo')
    expect(out[4].content).toContain('novo') // the current truth survives
  })

  it('keeps every tool message, because the API requires one per tool_call', async () => {
    // Dropping the message outright is a 400 from the provider: an assistant
    // turn's tool_calls must each have a matching tool result.
    const msgs: ApiMessage[] = [
      askedFor('a', 'ler_tasks'),
      answered('a', big('antigo')),
      askedFor('b', 'ler_tasks'),
      answered('b', big('novo'))
    ]

    const out = pruneSupersededResults(msgs)

    expect(out).toHaveLength(msgs.length)
    expect(out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['a', 'b'])
  })

  it('leaves a different question alone', async () => {
    // Same tool, different arguments — the older answer is still the only
    // answer to what it asked, and the model may well need both.
    const msgs: ApiMessage[] = [
      askedFor('a', 'ler_tasks', '{"projectId":"p1"}'),
      answered('a', big('projeto 1')),
      askedFor('b', 'ler_tasks', '{"projectId":"p2"}'),
      answered('b', big('projeto 2'))
    ]

    const out = pruneSupersededResults(msgs)

    expect(out[1].content).toContain('projeto 1')
    expect(out[3].content).toContain('projeto 2')
  })

  it('never touches a write tool, whose results are events and not answers', async () => {
    // Two identical write calls are two things that happened, not one question
    // asked twice. Eliding the first would erase a record of a write.
    // ('escrever_*' is what this file's isWriteTool mock counts as a write.)
    const msgs: ApiMessage[] = [
      askedFor('a', 'escrever_tasks', '{"tasks":[]}'),
      answered('a', big('criou uma vez')),
      askedFor('b', 'escrever_tasks', '{"tasks":[]}'),
      answered('b', big('criou de novo'))
    ]

    const out = pruneSupersededResults(msgs)

    expect(out[1].content).toContain('criou uma vez')
    expect(out[3].content).toContain('criou de novo')
  })

  it('leaves a lone result alone however big', async () => {
    // The single-large-result case: nothing supersedes it, the model may still
    // need it, so it stays. That one is fixed in ler_tasks, not here.
    const msgs: ApiMessage[] = [askedFor('a', 'ler_tasks'), answered('a', big('a única'))]

    expect(pruneSupersededResults(msgs)[1].content).toContain('a única')
  })

  it('does not bother with small results', async () => {
    const msgs: ApiMessage[] = [
      askedFor('a', 'ler_habitos'),
      answered('a', '{"ok":1}'),
      askedFor('b', 'ler_habitos'),
      answered('b', '{"ok":2}')
    ]

    // Eliding these would cost more words than it saves.
    expect(pruneSupersededResults(msgs)[1].content).toBe('{"ok":1}')
  })

  it('keeps the newest of three identical calls and blanks the rest', async () => {
    const msgs: ApiMessage[] = [
      askedFor('a', 'ler_tasks'),
      answered('a', big('PRIMEIRO')),
      askedFor('b', 'ler_tasks'),
      answered('b', big('SEGUNDO')),
      askedFor('c', 'ler_tasks'),
      answered('c', big('TERCEIRO'))
    ]

    const out = pruneSupersededResults(msgs)

    expect(out[1].content).not.toContain('PRIMEIRO')
    expect(out[3].content).not.toContain('SEGUNDO')
    expect(out[5].content).toContain('TERCEIRO')
  })

  it('leaves the conversation itself untouched', async () => {
    const msgs: ApiMessage[] = [
      { role: 'system', content: 'sistema' },
      { role: 'user', content: 'x'.repeat(600) },
      { role: 'assistant', content: 'y'.repeat(600) }
    ]

    expect(pruneSupersededResults(msgs)).toEqual(msgs)
  })
})

// ── measurePrunedCall (measure-first instrumentation) ──────────────────────────

describe('measurePrunedCall', () => {
  const askedFor = (id: string, name: string, args = '{}'): ApiMessage => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: args } }]
  })
  const answered = (id: string, content: string): ApiMessage => ({
    role: 'tool',
    tool_call_id: id,
    content
  })
  const big = (tag: string): string => JSON.stringify({ tag, filler: 'x'.repeat(500) })

  it('reports what the prune removed and the read weight still present', () => {
    const raw: ApiMessage[] = [
      { role: 'user', content: 'oi' },
      askedFor('a', 'ler_tasks'),
      answered('a', big('antigo')),
      askedFor('b', 'ler_tasks'),
      answered('b', big('novo'))
    ]
    const pruned = pruneSupersededResults(raw)
    const m = measurePrunedCall(raw, pruned)

    // The older duplicate was blanked, so savedChars is roughly its body size.
    expect(m.savedChars).toBeGreaterThan(400)
    // Read weight left = the surviving 'novo' body (the elided one no longer counts).
    expect(m.readResultChars).toBe(big('novo').length)
    expect(m.sentChars).toBeGreaterThan(0)
  })

  it('reports zero saved when the prune changed nothing', () => {
    const raw: ApiMessage[] = [
      askedFor('a', 'ler_tasks', '{"projectId":"p1"}'),
      answered('a', big('p1')),
      askedFor('b', 'ler_tasks', '{"projectId":"p2"}'),
      answered('b', big('p2'))
    ]
    const m = measurePrunedCall(raw, pruneSupersededResults(raw))
    expect(m.savedChars).toBe(0)
    // Two distinct read results, both intact — the headroom a smarter prune eyes.
    expect(m.readResultChars).toBe(big('p1').length + big('p2').length)
  })

  it('does not count a write result or an already-elided one as read weight', () => {
    const raw: ApiMessage[] = [
      askedFor('w', 'escrever_tasks', '{"tasks":[]}'),
      answered('w', big('escreveu')),
      { role: 'tool', tool_call_id: 'e', content: ELIDED },
      askedFor('e', 'ler_tasks'),
      answered('r', big('leu'))
    ]
    // 'r' has no matching tool_call here, so only classified results count.
    const m = measurePrunedCall(raw, raw)
    expect(m.readResultChars).toBe(0) // write body excluded; ELIDED excluded; 'r' unclassified
    expect(m.savedChars).toBe(0) // raw === pruned
  })
})

// ── streaming the tool calls themselves ────────────────────────────────────────

/**
 * A step that calls a tool with no preamble streams no text at all: onStream
 * never fires, and the only thing on screen was an anonymous spinner for as
 * long as the arguments took to arrive. The name is known from the first delta.
 */
describe('runAgent (streaming tool calls)', () => {
  /**
   * A chatStream mock that names its tool calls first — the way a provider
   * does — and only then dribbles out the arguments.
   */
  function makeToolStream(...responses: ChatResponse[]): ChatMock {
    const mock = vi.fn(
      async (
        _req: unknown,
        onDelta: (c: string) => void,
        onTool?: (i: number, name: string) => void
      ) => {
        const r = responses.shift() as ChatResponse
        for (const word of (r.message?.content ?? '').match(/\S+\s*/g) ?? []) onDelta(word)
        // ChatResponse types tool_calls loosely (unknown[]), as the wire does.
        const calls = (r.message?.tool_calls ?? []) as { function: { name: string } }[]
        calls.forEach((c, i) => onTool?.(i, c.function.name))
        return r
      }
    ) as unknown as ChatMock
    ;(window as unknown as { electronAPI: { ai: { chat: unknown; chatStream: unknown } } }).electronAPI =
      { ai: { chat: vi.fn(), chatStream: mock } }
    return mock
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers() // the retry test's backoff must not really sleep
  })
  afterEach(() => vi.useRealTimers())

  it('announces a tool while the model is still writing the call', async () => {
    makeToolStream(
      { success: true, message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] } },
      { success: true, message: { role: 'assistant', content: 'pronto' } }
    )
    const seen: string[][] = []

    await runAgent(cfg, user, approveNone, {
      onStream: () => {},
      onToolStream: (names) => seen.push(names)
    })

    // The name reached the caller before the message resolved.
    expect(seen).toContainEqual(['ler_x'])
  })

  it('hands over to the real status lines instead of showing the work twice', async () => {
    makeToolStream(
      { success: true, message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] } },
      { success: true, message: { role: 'assistant', content: 'pronto' } }
    )
    const seen: string[][] = []

    await runAgent(cfg, user, approveNone, {
      onStream: () => {},
      onToolStream: (names) => seen.push(names)
    })

    // Cleared once the message is complete: from there the persistent
    // onStatus(_, 'tool') line is the record, and both on screen would read as
    // two tools running.
    expect(seen.at(-1)).toEqual([])
  })

  it('names every tool of a multi-call step, in order', async () => {
    makeToolStream(
      {
        success: true,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [toolCall('c1', 'ler_x'), toolCall('c2', 'ler_y')]
        }
      },
      { success: true, message: { role: 'assistant', content: 'pronto' } }
    )
    const seen: string[][] = []

    await runAgent(cfg, user, approveNone, {
      onStream: () => {},
      onToolStream: (names) => seen.push(names)
    })

    expect(seen).toContainEqual(['ler_x', 'ler_y'])
  })

  it('corrects a name that arrives in pieces rather than showing it twice', async () => {
    // Nothing forbids a provider splitting the name across deltas; main
    // concatenates and re-sends, so the last word for an index wins.
    const mock = vi.fn(
      async (
        _req: unknown,
        _onDelta: (c: string) => void,
        onTool?: (i: number, name: string) => void
      ) => {
        onTool?.(0, 'ler_')
        onTool?.(0, 'ler_x')
        return {
          success: true,
          message: { role: 'assistant', content: 'pronto' }
        }
      }
    ) as unknown as ChatMock
    ;(window as unknown as { electronAPI: { ai: { chat: unknown; chatStream: unknown } } }).electronAPI =
      { ai: { chat: vi.fn(), chatStream: mock } }
    const seen: string[][] = []

    await runAgent(cfg, user, approveNone, {
      onStream: () => {},
      onToolStream: (names) => seen.push(names)
    })

    // One slot, corrected — never ['ler_', 'ler_x'].
    expect(seen.every((names) => names.length <= 1)).toBe(true)
    expect(seen).toContainEqual(['ler_x'])
  })

  it('drops a dead attempt’s tools instead of leaving them in front of the retry', async () => {
    let call = 0
    const mock = vi.fn(
      async (
        _req: unknown,
        _onDelta: (c: string) => void,
        onTool?: (i: number, name: string) => void
      ) => {
        call++
        if (call === 1) {
          // Announced a tool, then the attempt died.
          onTool?.(0, 'ler_abandonado')
          return { success: false, error: 'boom', status: 503 }
        }
        return { success: true, message: { role: 'assistant', content: 'RESPOSTA' } }
      }
    ) as unknown as ChatMock
    ;(window as unknown as { electronAPI: { ai: { chat: unknown; chatStream: unknown } } }).electronAPI =
      { ai: { chat: vi.fn(), chatStream: mock } }
    const seen: string[][] = []

    const p = runAgent(cfg, user, approveNone, {
      onStream: () => {},
      onToolStream: (names) => seen.push(names)
    })
    await vi.runAllTimersAsync()
    const result = await p

    expect(result).toBe('RESPOSTA')
    // The retry composes its own calls; the failed attempt's would sit there
    // claiming work that is not happening.
    expect(seen.at(-1)).toEqual([])
  })
})
