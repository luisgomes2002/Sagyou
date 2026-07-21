/**
 * The real IPC handlers from main/index.ts, exercised end to end.
 *
 * Electron is mocked just enough to let `app.whenReady()` run, which is what
 * registers the handlers; `ipcMain.handle` is captured so each channel can be
 * invoked the way the renderer invokes it. The model calls go to a real local
 * HTTP server rather than a stubbed SDK, so what's under test is the whole
 * path: request shaping, SSE parsing, tool_call assembly, usage and errors.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import http from 'http'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** channel -> handler, filled in when the module registers them. */
const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()

/**
 * main -> renderer sends (mainWindow.webContents.send), captured so the native
 * code-agent tests can read its streamed output and answer its approval cards.
 * Hoisted so the electron mock factory below can push into it.
 */
const winSent = vi.hoisted(() => [] as { channel: string; payload: unknown }[])

let userData: string

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(),
    getPath: (name: string) => (name === 'userData' ? userData : tmpdir()),
    on: vi.fn(),
    quit: vi.fn()
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: never[]) => unknown) =>
      handlers.set(channel, fn),
    on: vi.fn()
  },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      send: (channel: string, payload: unknown) => winSent.push({ channel, payload }),
      isDestroyed: () => false
    }
    on = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    show = vi.fn()
    isMaximized = (): boolean => false
  },
  shell: { openExternal: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))

// better-sqlite3 is a native module and irrelevant here.
vi.mock('../store', () => ({ loadData: vi.fn(() => ({})), saveData: vi.fn() }))
vi.mock('../../../resources/icon.png?asset', () => ({ default: '/icon.png' }))

/** Invoke a channel the way the renderer does. */
const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return (await fn(fakeEvent, ...(args as never[]))) as T
}

/** The event arg: only webContents.send (stream deltas) is ever used. */
const sent: { channel: string; payload: unknown }[] = []
const fakeEvent = {
  sender: { isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push({ channel, payload }) }
}

// --- a stand-in provider -----------------------------------------------------

type Reply = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
let reply: Reply
let server: http.Server
let baseUrl: string

const sse = (res: http.ServerResponse, frames: unknown[]): void => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const f of frames) {
    res.write(`data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', model: 'm', ...(f as object) })}\n\n`)
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'sagyou-main-'))
  server = http.createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    reply(req, res, body)
  })
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`

  // Importing the module runs whenReady() and registers everything.
  await import('../index')
  await new Promise((r) => setImmediate(r))
})

afterAll(async () => {
  server.close()
  await rm(userData, { recursive: true, force: true })
})

beforeEach(() => {
  sent.length = 0
})

describe('main handlers are registered', () => {
  it('exposes the AI channels the renderer calls', () => {
    for (const ch of ['ai:chat', 'ai:chat:stream', 'ai:code:list', 'ai:code:read', 'ai:code:search']) {
      expect(handlers.has(ch)).toBe(true)
    }
  })
})

describe('ai:chat', () => {
  it('returns the assistant message and the usage', async () => {
    reply = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: '1',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'olá' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3 }
        })
      )
    }

    const res = await invoke<{ success: boolean; message?: { content: string }; usage?: unknown }>(
      'ai:chat',
      { messages: [{ role: 'user', content: 'oi' }], baseUrl, apiKey: 'k', model: 'm' }
    )

    expect(res.success).toBe(true)
    expect(res.message?.content).toBe('olá')
    expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 3 })
  })

  it('sends the tools it was given, and omits the key when there are none', async () => {
    let seen: Record<string, unknown> = {}
    reply = (_req, res, body) => {
      seen = JSON.parse(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x' } }] }))
    }

    const tools = [{ type: 'function', function: { name: 'ler_tasks', description: '', parameters: {} } }]
    await invoke('ai:chat', { messages: [], tools, baseUrl, apiKey: 'k', model: 'm' })
    expect(seen.tools).toHaveLength(1)

    await invoke('ai:chat', { messages: [], tools: [], baseUrl, apiKey: 'k', model: 'm' })
    // An empty tools array is not the same as "tools: []" on the wire — some
    // providers reject it.
    expect(seen).not.toHaveProperty('tools')
  })

  it('reports a provider error with its status, for the retry policy', async () => {
    reply = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'upstream busy' } }))
    }

    const res = await invoke<{ success: boolean; error?: string; status?: number }>('ai:chat', {
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })

    expect(res.success).toBe(false)
    // Without the status the renderer cannot tell transient from permanent.
    expect(res.status).toBe(503)
    expect(res.error).toBeTruthy()
  })

  it('refuses to call out at all when the config is incomplete', async () => {
    let called = false
    reply = (_req, res) => {
      called = true
      res.end('{}')
    }

    const res = await invoke<{ success: boolean; status?: number }>('ai:chat', {
      messages: [],
      baseUrl: '',
      model: ''
    })

    expect(res.success).toBe(false)
    // 400 marks it non-retryable: retrying a missing config just delays the message.
    expect(res.status).toBe(400)
    expect(called).toBe(false)
  })

  it('reports an empty choices list rather than crashing', async () => {
    reply = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [] }))
    }
    const res = await invoke<{ success: boolean; error?: string }>('ai:chat', {
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })
    expect(res).toMatchObject({ success: false })
    expect(res.error).toContain('vazia')
  })
})

describe('ai:chat:stream', () => {
  it('streams deltas to the renderer and returns the whole message', async () => {
    reply = (_req, res) =>
      sse(res, [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'Olá' } }] },
        { choices: [{ index: 0, delta: { content: ', tudo bem?' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
      ])

    const res = await invoke<{ success: boolean; message?: { content: string } }>('ai:chat:stream', {
      streamId: 's1',
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })

    expect(res.message?.content).toBe('Olá, tudo bem?')
    expect(sent.map((s) => s.payload)).toEqual([
      { streamId: 's1', delta: 'Olá' },
      { streamId: 's1', delta: ', tudo bem?' }
    ])
  })

  it('tags deltas with the caller’s streamId so concurrent calls do not cross', async () => {
    reply = (_req, res) => sse(res, [{ choices: [{ index: 0, delta: { content: 'x' } }] }])
    await invoke('ai:chat:stream', { streamId: 'abc', messages: [], baseUrl, apiKey: 'k', model: 'm' })
    expect(sent[0]).toMatchObject({ channel: 'ai:chat:delta', payload: { streamId: 'abc' } })
  })

  it('announces a tool call by name as soon as the name arrives', async () => {
    // The name lands in the first delta; the arguments are what take the time.
    // Sitting on it until the message completes leaves a step that streams no
    // text at all — a bare tool call — with nothing on screen but a spinner.
    reply = (_req, res) =>
      sse(res, [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'criar_tasks', arguments: '' } }
                ]
              }
            }
          ]
        },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"tasks":[]}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    await invoke('ai:chat:stream', { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' })

    const tools = sent.filter(
      (e) => e.channel === 'ai:chat:delta' && (e.payload as { tool?: unknown }).tool
    )
    expect(tools[0]).toMatchObject({
      payload: { streamId: 's', tool: { index: 0, name: 'criar_tasks' } }
    })
  })

  it('sends no text delta alongside a tool announcement', async () => {
    // One channel carries both, so a tool payload has no `delta` field. A
    // consumer that read it unconditionally would append "undefined" to the
    // answer — the reason the preload handler checks each field before use.
    reply = (_req, res) =>
      sse(res, [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'ler_tasks' } }]
              }
            }
          ]
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    await invoke('ai:chat:stream', { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' })

    for (const e of sent.filter((x) => x.channel === 'ai:chat:delta')) {
      const p = e.payload as { delta?: string; tool?: unknown }
      if (p.tool) expect(p.delta).toBeUndefined()
    }
  })

  it('re-announces a name that the provider split across deltas', async () => {
    // Nothing forbids it. Main concatenates and re-sends, so the last payload
    // for an index is the whole name — the renderer keys on index and corrects.
    reply = (_req, res) =>
      sse(res, [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'criar_' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'tasks' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    await invoke('ai:chat:stream', { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' })

    const names = sent
      .filter((e) => e.channel === 'ai:chat:delta' && (e.payload as { tool?: unknown }).tool)
      .map((e) => (e.payload as { tool: { name: string } }).tool.name)
    expect(names).toEqual(['criar_', 'criar_tasks'])
  })

  it('announces each of two parallel tool calls under its own index', async () => {
    reply = (_req, res) =>
      sse(res, [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', type: 'function', function: { name: 'ler_tasks' } },
                  { index: 1, id: 'c2', type: 'function', function: { name: 'ler_metas' } }
                ]
              }
            }
          ]
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    await invoke('ai:chat:stream', { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' })

    const tools = sent
      .filter((e) => e.channel === 'ai:chat:delta' && (e.payload as { tool?: unknown }).tool)
      .map((e) => (e.payload as { tool: { index: number; name: string } }).tool)
    expect(tools).toEqual([
      { index: 0, name: 'ler_tasks' },
      { index: 1, name: 'ler_metas' }
    ])
  })

  it('joins tool_call arguments split across chunks', async () => {
    reply = (_req, res) =>
      sse(res, [
        { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'ler_tasks', arguments: '{"pro' } }
                ]
              }
            }
          ]
        },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'jectId":"p1"}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    const res = await invoke<{ message?: { tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }>(
      'ai:chat:stream',
      { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' }
    )

    expect(res.message?.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'ler_tasks', arguments: '{"projectId":"p1"}' } }
    ])
  })

  it('keeps two parallel tool calls apart by index', async () => {
    reply = (_req, res) =>
      sse(res, [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'a', type: 'function', function: { name: 'ler_tasks', arguments: '{}' } },
                  { index: 1, id: 'b', type: 'function', function: { name: 'ler_metas', arguments: '{' } }
                ]
              }
            }
          ]
        },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    const res = await invoke<{ message?: { tool_calls?: { id: string }[] } }>('ai:chat:stream', {
      streamId: 's',
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })

    expect(res.message?.tool_calls).toHaveLength(2)
    expect(res.message?.tool_calls?.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('survives a provider that never sends a role — the reason this is hand-rolled', async () => {
    // The SDK's own stream helper throws "missing role for choice 0" here. Any
    // OpenAI-compatible server may omit it, and this app points at those.
    reply = (_req, res) =>
      sse(res, [
        { choices: [{ index: 0, delta: { content: 'oi' } }] },
        {
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'ler_tasks', arguments: '{}' } }] } }
          ]
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ])

    const res = await invoke<{ success: boolean; message?: { content: string; tool_calls?: unknown[] } }>(
      'ai:chat:stream',
      { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' }
    )

    expect(res.success).toBe(true)
    expect(res.message?.content).toBe('oi')
    expect(res.message?.tool_calls).toHaveLength(1)
  })

  it('asks for usage, and reads it off the final chunk', async () => {
    let asked: unknown
    reply = (_req, res, body) => {
      asked = JSON.parse(body).stream_options
      sse(res, [
        { choices: [{ index: 0, delta: { content: 'x' } }] },
        { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } }
      ])
    }

    const res = await invoke<{ usage?: unknown }>('ai:chat:stream', {
      streamId: 's',
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })

    expect(asked).toEqual({ include_usage: true })
    // The usage chunk carries no choices, so it is read before the delta guard.
    expect(res.usage).toEqual({ promptTokens: 50, completionTokens: 7 })
  })

  it('falls back to a plain stream when the provider rejects stream_options', async () => {
    // A strict server answers 400 to an unknown field. Losing the token count
    // beats losing the answer.
    let attempts = 0
    reply = (_req, res, body) => {
      attempts++
      if (JSON.parse(body).stream_options) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'unknown field stream_options' } }))
        return
      }
      sse(res, [{ choices: [{ index: 0, delta: { content: 'funcionou' } }] }])
    }

    const res = await invoke<{ success: boolean; message?: { content: string }; usage?: unknown }>(
      'ai:chat:stream',
      { streamId: 's', messages: [], baseUrl, apiKey: 'k', model: 'm' }
    )

    expect(attempts).toBe(2)
    expect(res.success).toBe(true)
    expect(res.message?.content).toBe('funcionou')
    expect(res.usage).toBeUndefined()
  })

  it('does not retry the fallback for a non-400 failure', async () => {
    let attempts = 0
    reply = (_req, res) => {
      attempts++
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
    }

    const res = await invoke<{ success: boolean; status?: number }>('ai:chat:stream', {
      streamId: 's',
      messages: [],
      baseUrl,
      apiKey: 'k',
      model: 'm'
    })

    // A 401 is not a stream_options problem; retrying without it changes nothing.
    expect(attempts).toBe(1)
    expect(res).toMatchObject({ success: false, status: 401 })
  })
})

describe('ai:code:* handlers', () => {
  let container: string
  let root: string

  beforeAll(async () => {
    // The root sits INSIDE a container holding a secret as its sibling, so
    // "../secret.txt" points at a file that genuinely exists. Without that, a
    // confinement test passes merely because the target is missing — proving
    // nothing about the confinement.
    container = await mkdtemp(join(tmpdir(), 'sagyou-code-'))
    await writeFile(join(container, 'secret.txt'), 'SENHA-SUPER-SECRETA')
    root = join(container, 'proj')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'const alvo = 1\nconst outro = 2\n')
    await writeFile(join(root, 'src', 'b.ts'), 'nada aqui\n')
    await writeFile(join(root, 'bin.dat'), 'antes depois alvo\n')
  })
  afterAll(async () => rm(container, { recursive: true, force: true }))

  describe('ai:code:list', () => {
    it('lists the files under the root', async () => {
      const res = await invoke<{ files: string[]; total: number; truncated: boolean }>(
        'ai:code:list',
        root,
        '.'
      )
      expect(res.files).toEqual(['bin.dat', 'src/a.ts', 'src/b.ts'])
      // The whole listing fits under the default page: total is exact, no more.
      expect(res).toMatchObject({ total: 3, offset: 0, truncated: false })
    })

    it('pages the listing: a small limit returns one window and points at the rest', async () => {
      type Page = {
        files: string[]
        total: number
        offset: number
        truncated: boolean
        nextOffset?: number
      }
      const first = await invoke<Page>('ai:code:list', root, '.', 0, 2)
      expect(first.files).toEqual(['bin.dat', 'src/a.ts'])
      expect(first).toMatchObject({ total: 3, offset: 0, truncated: true, nextOffset: 2 })

      // Resume from nextOffset for the tail; nothing left, so no nextOffset.
      const second = await invoke<Page>('ai:code:list', root, '.', first.nextOffset, 2)
      expect(second.files).toEqual(['src/b.ts'])
      expect(second).toMatchObject({ total: 3, offset: 2, truncated: false })
      expect(second.nextOffset).toBeUndefined()
    })

    it('rejects a directory that does not exist', async () => {
      expect(await invoke('ai:code:list', join(root, 'nope'), '.')).toMatchObject({
        error: expect.any(String)
      })
    })
  })

  describe('ai:code:read', () => {
    it('reads a file inside the root', async () => {
      const res = await invoke<{ content: string; truncated: boolean }>('ai:code:read', root, 'src/a.ts')
      expect(res.content).toContain('const alvo = 1')
      expect(res.truncated).toBe(false)
    })

    it('refuses to read a file that really exists outside the root', async () => {
      // secret.txt is right next to the root and perfectly readable — only the
      // confinement stops it. This is the barrier to the rest of the disk.
      const res = await invoke<{ error?: string; content?: string }>(
        'ai:code:read',
        root,
        '../secret.txt'
      )

      expect(res.error).toContain('fora do projeto')
      expect(res.content).toBeUndefined()
    })

    it('refuses an absolute path elsewhere on the disk', async () => {
      const res = await invoke<{ error?: string; content?: string }>(
        'ai:code:read',
        root,
        join(container, 'secret.txt')
      )
      expect(res.error).toBeTruthy()
      expect(res.content).toBeUndefined()
    })

    it('refuses a directory', async () => {
      expect(await invoke('ai:code:read', root, 'src')).toMatchObject({ error: expect.any(String) })
    })

    it('pages a huge file instead of shipping it whole', async () => {
      // A file result is resent on every later step, so a bare read returns one
      // 20000-char window and points at the rest via nextOffset — not the whole
      // 70000-char file, which was a per-step token tax.
      const big = join(root, 'big.txt')
      await writeFile(big, 'a'.repeat(70000))
      const res = await invoke<{
        content: string
        truncated: boolean
        offset: number
        total: number
        nextOffset?: number
      }>('ai:code:read', root, 'big.txt')
      expect(res.truncated).toBe(true)
      expect(res.content).toHaveLength(20000)
      expect(res).toMatchObject({ offset: 0, total: 70000, nextOffset: 20000 })
      await rm(big)
    })

    it('resumes from nextOffset and drops it once the file is exhausted', async () => {
      const big = join(root, 'big.txt')
      await writeFile(big, 'a'.repeat(70000))
      // Resume at 20000 asking for the rest in one large window (raised via
      // maxChars up to the 60000 ceiling): reads to the end, no more nextOffset.
      const res = await invoke<{
        content: string
        truncated: boolean
        offset: number
        total: number
        nextOffset?: number
      }>('ai:code:read', root, 'big.txt', 20000, 60000)
      expect(res.content).toHaveLength(50000)
      expect(res.truncated).toBe(false)
      expect(res.offset).toBe(20000)
      expect(res.nextOffset).toBeUndefined()
      await rm(big)
    })

    it('caps a single read at 60000 chars even when maxChars asks for more', async () => {
      const big = join(root, 'big.txt')
      await writeFile(big, 'a'.repeat(80000))
      const res = await invoke<{ content: string; truncated: boolean }>(
        'ai:code:read',
        root,
        'big.txt',
        0,
        1_000_000
      )
      expect(res.content).toHaveLength(60000)
      expect(res.truncated).toBe(true)
      await rm(big)
    })
  })

  describe('ai:code:search', () => {
    it('returns the file and line of each match', async () => {
      const res = await invoke<{ matches: { file: string; line: number; text: string }[] }>(
        'ai:code:search',
        root,
        'alvo'
      )
      expect(res.matches).toContainEqual({ file: 'src/a.ts', line: 1, text: 'const alvo = 1' })
    })

    it('skips binaries rather than dumping bytes at the model', async () => {
      const res = await invoke<{ matches: { file: string }[] }>('ai:code:search', root, 'alvo')
      expect(res.matches.some((m) => m.file === 'bin.dat')).toBe(false)
    })

    it('matches case-insensitively', async () => {
      const res = await invoke<{ matches: unknown[] }>('ai:code:search', root, 'ALVO')
      expect(res.matches.length).toBeGreaterThan(0)
    })

    it('rejects an empty term and a bad directory', async () => {
      expect(await invoke('ai:code:search', root, '')).toMatchObject({ error: expect.any(String) })
      expect(await invoke('ai:code:search', join(root, 'nope'), 'x')).toMatchObject({
        error: expect.any(String)
      })
    })
  })
})

// -----------------------------------------------------------------------------

/**
 * Naming a chat by hand.
 *
 * The autosave derives a title from the first message and re-sends it on every
 * save, knowing nothing about renames — so the rule that a user's name wins
 * lives here, on the side that owns the file.
 */
describe('ai:conversations:rename', () => {
  const save = (id: string, title: string, text = 'oi'): Promise<unknown> =>
    invoke('ai:conversations:save', {
      id,
      title,
      messages: [{ role: 'user', content: text }]
    })

  const titleOf = async (id: string): Promise<string | undefined> =>
    (await invoke<{ id: string; title: string }[]>('ai:conversations:list')).find((c) => c.id === id)
      ?.title

  beforeEach(async () => {
    await invoke('ai:conversations:replace', [])
  })

  it('names a chat', async () => {
    await save('r1', 'oi')
    expect(await invoke('ai:conversations:rename', 'r1', 'Planejamento do sprint')).toEqual({
      title: 'Planejamento do sprint'
    })
    expect(await titleOf('r1')).toBe('Planejamento do sprint')
  })

  it('keeps the name when the autosave writes its derived one over it', async () => {
    // The regression this guards: the reply lands, the autosave fires with a
    // title taken from the first message, and the rename is gone a second after
    // it was made.
    await save('r2', 'oi')
    await invoke('ai:conversations:rename', 'r2', 'Nome escolhido')
    await save('r2', 'oi', 'mais uma pergunta')

    expect(await titleOf('r2')).toBe('Nome escolhido')
  })

  it('trims and clips, so the stored name is the one the list can show', async () => {
    await save('r3', 'oi')
    const res = await invoke<{ title: string }>('ai:conversations:rename', 'r3', `  ${'x'.repeat(300)}  `)
    expect(res.title).toHaveLength(120)
    expect(await titleOf('r3')).toHaveLength(120)
  })

  it('refuses a blank name instead of leaving a nameless row', async () => {
    await save('r4', 'oi')
    expect(await invoke('ai:conversations:rename', 'r4', '   ')).toMatchObject({
      error: expect.any(String)
    })
    expect(await titleOf('r4')).toBe('oi')
  })

  it('reports an id that is not there rather than inventing a chat', async () => {
    expect(await invoke('ai:conversations:rename', 'nao-existe', 'x')).toMatchObject({
      error: expect.any(String)
    })
    expect(await invoke<unknown[]>('ai:conversations:list')).toHaveLength(0)
  })

  it('does not jump the chat to the top of the history', async () => {
    // updatedAt orders the list by when a chat was last talked to. Renaming is
    // not talking to it.
    await save('r5', 'oi')
    const before = (await invoke<{ id: string; updatedAt: string }[]>('ai:conversations:list'))[0]
      .updatedAt
    await invoke('ai:conversations:rename', 'r5', 'Outro nome')
    const after = (await invoke<{ id: string; updatedAt: string }[]>('ai:conversations:list'))[0]
      .updatedAt

    expect(after).toBe(before)
  })

  it('survives a backup restore, name and all', async () => {
    await save('r6', 'oi')
    await invoke('ai:conversations:rename', 'r6', 'Nome que importa')
    const exported = await invoke<unknown[]>('ai:conversations:all')

    await invoke('ai:conversations:replace', exported)
    // Restored, then saved again: without the flag the derived title would win
    // and the restore would have quietly un-named it.
    await save('r6', 'oi', 'depois do restore')

    expect(await titleOf('r6')).toBe('Nome que importa')
  })

  it('rejects junk arguments', async () => {
    expect(await invoke('ai:conversations:rename', 42, 'x')).toMatchObject({
      error: expect.any(String)
    })
    expect(await invoke('ai:conversations:rename', 'r1', null)).toMatchObject({
      error: expect.any(String)
    })
  })
})

// -----------------------------------------------------------------------------

/**
 * The native code agent (the loop in ../code-agent), driven end to end through
 * the real `ai:code-agent:run` handler against the stand-in provider.
 *
 * The old external-codex tests were removed with the codex spawn path; the loop
 * itself is unit-tested in code-agent.test.ts. What these cover is the IPC glue
 * the unit tests can't: the run handler streaming to the panel, the real model
 * in the banner, and the per-action approval round-trip.
 */
describe('native code agent', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sagyou-agent-run-'))
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
    winSent.length = 0
    // Point both chat and code-agent at the stand-in server. Sandbox off: ai-jail
    // isn't installed in CI, and the run would otherwise be blocked by the gate.
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'meu-modelo', sandboxEnabled: false })
  })
  afterEach(async () => {
    await invoke('ai:code-agent:stop')
    await rm(dir, { recursive: true, force: true })
  })

  /** Wait until the running agent reports it has stopped (or time out). */
  const waitDone = async (): Promise<{ log: string }> => {
    for (let i = 0; i < 100; i++) {
      const s = await invoke<{ running: boolean; log: string }>('ai:code-agent:status')
      if (!s.running) return s
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('agent did not finish')
  }

  /** The payload of the first main→renderer send on `channel`, if any. */
  const firstSent = (channel: string): unknown =>
    winSent.find((s) => s.channel === channel)?.payload

  it('runs the loop, banners the real model, and finishes', async () => {
    // The model answers with plain text — no tools — so the loop ends at once.
    reply = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pronto: nada a fazer' } }] }))
    }

    const res = await invoke<{ success: boolean; agent?: string }>('ai:code-agent:run', {
      path: dir,
      task: 'não faça nada'
    })
    expect(res.success).toBe(true)
    // The banner names the REAL model (task 11), not "próprio do codex".
    expect(res.agent).toBe('meu-modelo')

    const { log } = await waitDone()
    expect(log).toContain('modelo: meu-modelo')
    expect(log).toContain('pronto: nada a fazer')
  })

  it('parks on a write, and writes only after the user approves', async () => {
    let call = 0
    reply = (_req, res) => {
      call++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (call === 1) {
        // First turn: ask to write a file.
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'w1',
                      type: 'function',
                      function: {
                        name: 'escrever_arquivo',
                        arguments: JSON.stringify({ caminho: 'novo.ts', conteudo: 'export const b = 2\n' })
                      }
                    }
                  ]
                }
              }
            ]
          })
        )
      } else {
        // After the tool result comes back, finish.
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'feito' } }] }))
      }
    }

    await invoke('ai:code-agent:run', { path: dir, task: 'crie novo.ts' })

    // The loop parks on the approval; answer it once the card is sent.
    let approvalId: string | undefined
    for (let i = 0; i < 100 && !approvalId; i++) {
      const req = firstSent('ai:code-agent:approve-request') as { id: string } | undefined
      if (req) approvalId = req.id
      else await new Promise((r) => setTimeout(r, 20))
    }
    expect(approvalId).toBeTruthy()
    await invoke('ai:code-agent:approve-response', approvalId, true)

    await waitDone()
    // The write ran only because it was approved.
    expect(existsSync(join(dir, 'novo.ts'))).toBe(true)
  })

  it('does not write when the user denies', async () => {
    reply = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'w1',
                    type: 'function',
                    function: {
                      name: 'escrever_arquivo',
                      arguments: JSON.stringify({ caminho: 'nao.ts', conteudo: 'x' })
                    }
                  }
                ]
              }
            }
          ]
        })
      )
    }

    await invoke('ai:code-agent:run', { path: dir, task: 'tente escrever' })

    let approvalId: string | undefined
    for (let i = 0; i < 100 && !approvalId; i++) {
      const req = firstSent('ai:code-agent:approve-request') as { id: string } | undefined
      if (req) approvalId = req.id
      else await new Promise((r) => setTimeout(r, 20))
    }
    // Deny it, then keep answering "feito" so the loop can conclude.
    reply = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok, não escrevi' } }] }))
    }
    await invoke('ai:code-agent:approve-response', approvalId, false)

    await waitDone()
    expect(existsSync(join(dir, 'nao.ts'))).toBe(false)
  })

  it('blocks the run when the sandbox is required but ai-jail is unavailable', async () => {
    // Sandbox left ON (no sandboxEnabled:false), and ai-jail isn't installed in
    // CI — so the gate must refuse the run rather than run it unconfined.
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'meu-modelo' })
    const res = await invoke<{ success: boolean; error?: string }>('ai:code-agent:run', {
      path: dir,
      task: 'x'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/sandbox/i)
  })

  it('ai:jail:status reports availability merged with config', async () => {
    const s = await invoke<{ available: boolean; enabled: boolean; wslCommand: string }>('ai:jail:status')
    expect(typeof s.available).toBe('boolean')
    expect(typeof s.enabled).toBe('boolean')
    expect(s.wslCommand).toBe('wsl --install')
  })
})
/**
 * Finding the agent when PATH doesn't have it.
 *
 * The bug: a GUI-launched Electron app inherits the systemd user manager's
 * PATH, not the shell's. `npm config set prefix ~/.npm-global` puts codex in a
 * dir that only ~/.bashrc adds — so `codex --version` works in a terminal while
 * the app insists it isn't installed.
 */
describe('resolveExecutable', () => {
  const oldPath = process.env.PATH
  let onPath: string
  let elsewhere: string

  beforeAll(async () => {
    onPath = await mkdtemp(join(tmpdir(), 'res-path-'))
    elsewhere = await mkdtemp(join(tmpdir(), 'res-extra-'))
  })

  afterAll(async () => {
    process.env.PATH = oldPath
    await rm(onPath, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  })

  const load = async (): Promise<typeof import('../index')> => import('../index')

  it('finds an agent that is only in a fallback dir, not on PATH', async () => {
    const { resolveExecutable } = await load()
    await writeFile(join(elsewhere, 'codex'), '#!/bin/sh\n', { mode: 0o755 })
    process.env.PATH = onPath // deliberately empty of codex

    // The whole point: PATH says no, the npm-prefix dir says yes.
    expect(resolveExecutable('codex', [elsewhere])).toBe(join(elsewhere, 'codex'))
  })

  it('prefers PATH over the fallback dirs', async () => {
    const { resolveExecutable } = await load()
    await writeFile(join(onPath, 'codex'), '#!/bin/sh\n', { mode: 0o755 })
    await writeFile(join(elsewhere, 'codex'), '#!/bin/sh\n', { mode: 0o755 })
    process.env.PATH = onPath

    // ⚠️ Load-bearing for the suite, not a preference. handlers.test.ts narrows
    // PATH to a dir holding only a stub so the real codex can never spawn (it
    // waits on stdin forever). A fallback dir that won over PATH would walk
    // straight around that guard.
    expect(resolveExecutable('codex', [elsewhere])).toBe(join(onPath, 'codex'))
  })

  it('skips a match that exists but cannot be executed', async () => {
    const { resolveExecutable } = await load()
    // A same-named file without the executable bit: taking it would defer the
    // failure to spawn, which reports EACCES — a different problem than the one
    // it is, sending the user to reinstall something already installed.
    await writeFile(join(onPath, 'naoexec'), 'x', { mode: 0o644 })
    await writeFile(join(elsewhere, 'naoexec'), '#!/bin/sh\n', { mode: 0o755 })
    process.env.PATH = onPath

    expect(resolveExecutable('naoexec', [elsewhere])).toBe(join(elsewhere, 'naoexec'))
  })

  it('returns null when nothing anywhere matches', async () => {
    const { resolveExecutable } = await load()
    process.env.PATH = onPath

    // null is what makes the handler fall back to the bare name and let spawn
    // raise ENOENT, so "não encontrado" is reported — now truthfully.
    expect(resolveExecutable('nao-existe-mesmo', [elsewhere])).toBeNull()
  })

  it('drops every fallback dir when the test opt-out is set', async () => {
    const { fallbackBinDirs } = await load()

    process.env.SAGYOU_DISABLE_BIN_FALLBACK = '1'
    expect(fallbackBinDirs()).toEqual([])
    delete process.env.SAGYOU_DISABLE_BIN_FALLBACK
    // Without it, the search is real — otherwise the opt-out would be silently
    // disabling the feature in the app as well.
    expect(fallbackBinDirs().length).toBeGreaterThan(0)
  })
})
