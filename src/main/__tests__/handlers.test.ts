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

/**
 * `cat` by absolute path, resolved once.
 *
 * The agent stubs below run with PATH narrowed to a directory holding only the
 * stub itself (see the spawn note there), so a bare `cat` is not found and the
 * script dies with exit 127 having echoed nothing.
 */
const CAT = ['/bin/cat', '/usr/bin/cat'].find((p) => existsSync(p)) ?? 'cat'

/** channel -> handler, filled in when the module registers them. */
const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()

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
    webContents = { setWindowOpenHandler: vi.fn(), send: vi.fn(), isDestroyed: () => false }
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
 * The code agent's output outliving whoever was watching.
 *
 * The agent is a child process that runs for minutes (a code review is the
 * point), and the user is meant to keep working meanwhile. But its output is a
 * live stream, and the only thing accumulating it was a panel inside AIView —
 * unmounted the moment another view is active. Everything printed while the
 * user was elsewhere went nowhere, and an agent that finished while they were
 * away left nothing at all. Main buffers it now, because main owns the process.
 */
describe('ai:code-agent output survives the panel', () => {
  let dir: string
  /** Holds the stand-in agent. PATH is narrowed to this — see beforeAll. */
  let binDir: string
  const oldPath = process.env.PATH

  // codex is the only agent now, so the stub stands in for it. It must drain
  // stdin: the handler pipes the prompt in (codex reads it via `-`) and a stub
  // that never reads would leave the write to EPIPE.
  const fakeAgent = (body: string): Promise<void> =>
    writeFile(join(binDir, 'codex'), `#!/bin/sh\n${body}\n${CAT} >/dev/null\n`, { mode: 0o755 })

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-cwd-'))
    binDir = await mkdtemp(join(tmpdir(), 'agent-bin-'))
    // PATH is *replaced*, not prepended. Both aider and codex are really
    // installed on a dev machine, and the handler spawns whatever it finds:
    // prepending let a test fire the real codex, which sits waiting on stdin
    // and never exits, poisoning every test after it. The only agent reachable
    // from here is the script below; `codex` resolves to nothing, on purpose.
    process.env.PATH = binDir
    await fakeAgent('echo "LINHA_UM"\necho "LINHA_DOIS"\nexit 0')
  })

  afterAll(async () => {
    process.env.PATH = oldPath
    await rm(dir, { recursive: true, force: true })
    await rm(binDir, { recursive: true, force: true })
  })

  const status = (): Promise<{ running: boolean; log: string }> =>
    invoke('ai:code-agent:status')

  /** Wait for the agent to exit, so the buffer is complete. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      if (!(await status()).running) return
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('the agent never exited')
  }

  beforeEach(async () => {
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'm' })
  })

  // Never leave a child running into the next test.
  afterEach(async () => {
    await invoke('ai:code-agent:stop')
  })

  it('keeps what the agent printed, for a panel that was not there to hear it', async () => {
    const res = await invoke<{ success: boolean }>('ai:code-agent:run', {
      path: dir,
      task: 'revisar o código'
    })
    expect(res.success).toBe(true)
    await settle()

    // Nobody was listening to ai:code-agent:output — which is exactly the case
    // when the user is on the Board — and the output is still here.
    const { log } = await status()
    expect(log).toContain('LINHA_UM')
    expect(log).toContain('LINHA_DOIS')
  })

  it('records that the run is over, not merely that it went quiet', async () => {
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    // A returning user has to be able to tell "finished" from "still working".
    const { running, log } = await status()
    expect(running).toBe(false)
    expect(log).toContain('agente encerrado')
  })

  it('starts a new log per run, instead of stacking reviews together', async () => {
    await invoke('ai:code-agent:run', { path: dir, task: 'primeira' })
    await settle()
    await invoke('ai:code-agent:run', { path: dir, task: 'segunda' })
    await settle()

    const { log } = await status()
    // Two runs, one panel: the old output prepended to the new would read as
    // one very confusing review.
    expect(log.match(/LINHA_UM/g)).toHaveLength(1)
  })

  it('does not wipe the last run when a bad request is refused', async () => {
    await invoke('ai:code-agent:run', { path: dir, task: 'boa' })
    await settle()

    // Refused before anything spawns — the user may still be reading the panel.
    expect(
      await invoke('ai:code-agent:run', { path: dir, task: '  ' })
    ).toMatchObject({ success: false })
    expect(
      await invoke('ai:code-agent:run', { path: join(dir, 'nao-existe'), task: 't' })
    ).toMatchObject({ success: false })

    expect((await status()).log).toContain('LINHA_UM')
  })

  it('keeps the "not installed" line, the one nobody is ever watching for', async () => {
    // Fires instantly, usually before the user has looked at the panel — and it
    // is the most useful line the panel can show. codex is the only agent now,
    // so the stub has to be taken off PATH to reach the not-found path at all.
    const withStub = process.env.PATH
    const empty = await mkdtemp(join(tmpdir(), 'agent-none-'))
    process.env.PATH = empty
    const res = await invoke<{ success: boolean }>('ai:code-agent:run', {
      path: dir,
      task: 't'
    })
    process.env.PATH = withStub
    await rm(empty, { recursive: true, force: true })
    expect(res.success).toBe(false)

    const { log } = await status()
    expect(log).toMatch(/não encontrado|erro ao iniciar/)
  })

  // The banner: which path a run took. Pinned files (aider gets --file +
  // --map-tokens 0) and discovery (aider maps the whole tree) differ by minutes
  // on a one-line change, and from the panel they used to look identical — a
  // path the model got wrong is dropped in silence and quietly degrades to the
  // slow path. These pin that the panel can tell them apart.
  it('says when files were pinned, and names them', async () => {
    await writeFile(join(dir, 'alvo.ts'), 'export const x = 1\n')

    await invoke('ai:code-agent:run', {
      path: dir,
      task: 't',
      files: ['alvo.ts']
    })
    await settle()

    const { log } = await status()
    expect(log).toContain('1 arquivo(s) fixado(s)')
    expect(log).toContain('alvo.ts')
    expect(log).not.toContain('nenhum arquivo fixado')
  })

  it('says when nothing was pinned, since that is the slow path', async () => {
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    const { log } = await status()
    expect(log).toContain('nenhum arquivo fixado')
    expect(log).toContain('próprias ferramentas')
  })

  it('names a dropped path instead of degrading to discovery in silence', async () => {
    await invoke('ai:code-agent:run', {
      path: dir,
      task: 't',
      // Escapes the root, and does not exist: both are dropped by the handler.
      files: ['../fora.ts', 'nao-existe.ts']
    })
    await settle()

    const { log } = await status()
    expect(log).toContain('2 caminho(s) descartado(s)')
    expect(log).toContain('nao-existe.ts')
    // The consequence, not just the fact — this is why the run was slow.
    expect(log).toContain('caiu na descoberta')
  })

  it('says the app config does not pick the model, because codex picks its own', async () => {
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'modelo-xyz' })
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    // codex authenticates and chooses its model by itself, so naming the app's
    // configured model here would state a falsehood about what just ran.
    const { log } = await status()
    expect(log).toContain('não usa a config do app')
    expect(log).not.toContain('modelo-xyz')
  })

  it('reports how long the run took, since the panel has no other clock', async () => {
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    // Comparing two agents (or two models) is the reason this exists, and it
    // was impossible from the panel: the exit line carries only a status code.
    expect((await status()).log).toMatch(/\[sagyou\] duração: \d+\.\d+s/)
  })

  // The failure that motivated the hint: codex's Linux sandbox (bubblewrap) can't
  // create user namespaces on Ubuntu 23.10+, so it reads nothing, writes nothing,
  // and exits 0. Nothing about that run looks wrong from the outside.
  it('recognises the broken-sandbox run that exits 0 having done nothing', async () => {
    await fakeAgent(
      'echo "warning: Codex\'s Linux sandbox uses bubblewrap and needs access to create user namespaces."\n' +
        'echo "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted"\n' +
        'exit 0'
    )
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    const s = await invoke<{ log: string; hint: { title: string; command?: string } | null }>(
      'ai:code-agent:status'
    )
    // Structured, for the panel — the log is behind a toggle, so a log-only
    // message never reaches the user who doesn't know to go looking.
    expect(s.hint).not.toBeNull()
    expect(s.hint?.command).toContain('apparmor_restrict_unprivileged_userns=0')
    // And in the log too, so a pasted transcript carries the diagnosis.
    expect(s.log).toContain('sandbox do codex')
  })

  it('leaves hint null for an ordinary run, and clears it on the next one', async () => {
    await fakeAgent('echo "warning: bwrap: Failed RTM_NEWADDR"\nexit 0')
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()
    expect((await invoke<{ hint: unknown }>('ai:code-agent:status')).hint).not.toBeNull()

    // A diagnosis carried over from the previous run is worse than none: it
    // would blame a healthy run for a problem it didn't have.
    await fakeAgent('echo "tudo certo"\nexit 0')
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()
    expect((await invoke<{ hint: unknown }>('ai:code-agent:status')).hint).toBeNull()

    await fakeAgent('echo "LINHA_UM"\necho "LINHA_DOIS"\nexit 0') // restore for later tests
  })

  it('detects a marker split across two chunks', async () => {
    // Real output arrives in arbitrarily sized pieces; a per-chunk test would
    // miss a marker that straddles the boundary.
    await fakeAgent('printf "bwrap: loopback: Failed RTM_"\nsleep 0.1\nprintf "NEWADDR denied\\n"\nexit 0')
    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    expect((await invoke<{ hint: unknown }>('ai:code-agent:status')).hint).not.toBeNull()
    await fakeAgent('echo "LINHA_UM"\necho "LINHA_DOIS"\nexit 0')
  })

  it('keeps only the tail of a chatty agent', async () => {
    // ~1000 lines x ~15 chars comfortably overruns the 8000-char cap; 400 did
    // not, and the test passed for the wrong reason.
    await fakeAgent('i=0\nwhile [ $i -lt 1000 ]; do echo "enchimento-$i"; i=$((i+1)); done')

    await invoke('ai:code-agent:run', { path: dir, task: 't' })
    await settle()

    // An unbounded buffer of a long agent run is a leak that grows for as long
    // as the app is open.
    const { log } = await status()
    expect(log.length).toBeLessThanOrEqual(8000)
    expect(log).toContain('enchimento-999') // the newest survives
    expect(log).not.toContain('enchimento-0\n') // the oldest is gone
  })
})

// -----------------------------------------------------------------------------

/**
 * Handing the repo's guide to the agent before it touches code.
 *
 * The stub agents echo their own argv AND their stdin, so what's asserted is
 * what the real handler really spawned — not what a mock was told. Codex reads
 * its prompt from stdin (`-`), not argv, so the stdin echo is what carries it.
 */
describe('the guide is given to the agent', () => {
  let withGuide: string
  let without: string
  let binDir: string
  const oldPath = process.env.PATH

  beforeAll(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'guide-bin-'))
    // PATH replaced, not prepended: the real codex is installed on a dev machine
    // and the handler runs whatever it finds.
    process.env.PATH = binDir
    // `cat` echoes stdin, which is where codex's prompt arrives (via `-`), not
    // in argv — so the assertions below can see the prompt the handler built.
    await writeFile(join(binDir, 'codex'), `#!/bin/sh\necho "ARGV: $@"\n${CAT}\n`, { mode: 0o755 })

    withGuide = await mkdtemp(join(tmpdir(), 'guide-yes-'))
    await writeFile(join(withGuide, 'GUIDE.md'), '# guia do projeto\n')
    without = await mkdtemp(join(tmpdir(), 'guide-no-'))
  })

  afterAll(async () => {
    process.env.PATH = oldPath
    await rm(binDir, { recursive: true, force: true })
    await rm(withGuide, { recursive: true, force: true })
    await rm(without, { recursive: true, force: true })
  })

  const argv = async (path: string): Promise<string> => {
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'm' })
    await invoke('ai:code-agent:run', { path, task: 'faça algo' })
    for (let i = 0; i < 100; i++) {
      const s = await invoke<{ running: boolean; log: string }>('ai:code-agent:status')
      if (!s.running) return s.log
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('the agent never exited')
  }

  afterEach(async () => {
    await invoke('ai:code-agent:stop')
  })

  it('asks codex to read it, since codex exec has no --read', async () => {
    const log = await argv(withGuide)

    expect(log).toMatch(/leia o GUIDE\.md/i)
    expect(log).toContain('faça algo') // the task itself still gets through
  })

  it('names pinned files to codex relatively, as the sentence promises', async () => {
    await writeFile(join(withGuide, 'alvo.ts'), 'export const x = 1\n')
    await invoke('ai:config:set', { baseUrl, apiKey: 'k', model: 'm' })
    await invoke('ai:code-agent:run', {
      path: withGuide,
      task: 'faça algo',
      files: ['alvo.ts']
    })
    for (let i = 0; i < 100; i++) {
      const s = await invoke<{ running: boolean; log: string }>('ai:code-agent:status')
      if (!s.running) {
        // `files` reaches buildAgentCommand absolute (confineToRoot resolves
        // it), so joining it raw said "caminhos relativos à raiz" and then gave
        // an absolute path — contradicting itself and leaking the machine's home
        // directory into the model's context.
        expect(s.log).toContain('caminhos relativos à raiz): alvo.ts')
        expect(s.log).not.toContain(`${withGuide}/alvo.ts`)
        return
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('the agent never exited')
  })

  it('does NOT hand our guide to a repo that has none', async () => {
    // The bug this exists for: the agent runs wherever the project's code path
    // points, which may be any repo on the machine. Briefing it on Sagyou's
    // rules while it edits someone else's code is worse than briefing it on
    // nothing.
    expect(await argv(without)).not.toContain('leia o')
  })

  it('leaves the codex prompt alone when the repo has no guide', async () => {
    const log = await argv(without)

    expect(log).not.toMatch(/leia o GUIDE\.md/i)
    expect(log).toContain('faça algo')
  })

  it('names the guide by a path relative to the repo, not this machine', async () => {
    // The agent's cwd is the repo, so 'GUIDE.md' resolves there. An absolute
    // path would work here and be wrong everywhere else — and would put the
    // user's directory layout into the agent's prompt.
    const log = await argv(withGuide)

    expect(log).toContain('leia o GUIDE.md')
    expect(log).not.toContain(withGuide) // no absolute path in the prompt
  })
})
