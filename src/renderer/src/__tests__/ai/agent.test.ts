import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the tool registry so the loop test controls tool execution in isolation
// (the real tools are covered in tools.test.ts).
vi.mock('../../ai/tools', () => ({
  TOOL_DEFS: [{ type: 'function', function: { name: 'ler_x', description: '', parameters: {} } }],
  runTool: vi.fn((name: string) => JSON.stringify({ ran: name })),
  isWriteTool: vi.fn((name: string) => name.startsWith('escrever')),
  describeToolActivity: vi.fn((name: string) => `Fazendo ${name}`)
}))

import { runAgent } from '../../ai/agent'
import { runTool } from '../../ai/tools'

interface ChatResponse {
  success: boolean
  message?: { role: string; content: string; tool_calls?: unknown[] }
  error?: string
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

/** A chat mock that returns the given responses in order. */
function makeChat(...responses: ChatResponse[]): ChatMock {
  const mock = vi.fn() as ChatMock
  for (const r of responses) mock.mockResolvedValueOnce(r)
  installChat(mock)
  return mock
}

function toolCall(id: string, name: string, args = '{}'): unknown {
  return { id, type: 'function', function: { name, arguments: args } }
}

const approveNone = vi.fn(async () => new Set<string>())

describe('runAgent (tool-calling loop)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a read tool, feeds the result back, and stops on a text answer', async () => {
    const chat = makeChat(
      { success: true, message: { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'ler_x')] } },
      { success: true, message: { role: 'assistant', content: 'FINAL' } }
    )

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('FINAL')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(runTool).toHaveBeenCalledWith('ler_x', {})
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

    // Only the approved write executed.
    expect(runTool).toHaveBeenCalledWith('escrever_a', {})
    expect(runTool).not.toHaveBeenCalledWith('escrever_b', {})

    const msgs = reqAt(chat, 1).messages
    const r1 = msgs.find((m: { tool_call_id?: string }) => m.tool_call_id === 'c1')
    const r2 = msgs.find((m: { tool_call_id?: string }) => m.tool_call_id === 'c2')
    expect(JSON.parse(r1.content)).toEqual({ ran: 'escrever_a' })
    expect(JSON.parse(r2.content)).toEqual({ error: 'Ação recusada pelo usuário' })
  })

  it('stops after MAX_STEPS and forces a final answer with tools disabled', async () => {
    let n = 0
    const chat = vi.fn((req: { tools?: unknown }) =>
      req.tools
        ? Promise.resolve({
            success: true,
            message: { role: 'assistant', content: '', tool_calls: [toolCall('c' + n++, 'ler_x')] }
          })
        : Promise.resolve({ success: true, message: { role: 'assistant', content: 'CAP' } })
    ) as ChatMock
    installChat(chat)

    const result = await runAgent(cfg, user, approveNone)

    expect(result).toBe('CAP')
    // 6 tool iterations + 1 final tools-disabled call.
    expect(chat).toHaveBeenCalledTimes(7)
    expect(reqAt(chat, 6).tools).toBeUndefined()
    expect(runTool).toHaveBeenCalledTimes(6)
  })

  it('propagates a model error', async () => {
    makeChat({ success: false, error: 'boom' })
    await expect(runAgent(cfg, user, approveNone)).rejects.toThrow('boom')
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
