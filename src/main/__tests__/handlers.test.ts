/**
 * The real IPC handlers from main/index.ts, exercised end to end.
 *
 * Electron is mocked just enough to let `app.whenReady()` run, which is what
 * registers the handlers; `ipcMain.handle` is captured so each channel can be
 * invoked the way the renderer invokes it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { listMemories } from '../store'

/** channel -> handler, filled in when the module registers them. */
const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()

/**
 * main -> renderer sends (mainWindow.webContents.send), captured so the native
 * code-agent tests can read its streamed output and answer its approval cards.
 * Hoisted so the electron mock factory below can push into it.
 */
const winSent = vi.hoisted(() => [] as { channel: string; payload: unknown }[])

/** Startup milestones in order, to prove the chat data is removed before a window exists. */
const startupOrder = vi.hoisted(() => [] as string[])

let userData: string

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
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
    constructor() {
      startupOrder.push('createWindow')
    }
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getURL: () => 'file:///sagyou/index.html',
      send: (channel: string, payload: unknown) => winSent.push({ channel, payload }),
      isDestroyed: () => false
    }
    on = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    show = vi.fn()
    isMaximized = (): boolean => false
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))

// better-sqlite3 is a native module and irrelevant here.
vi.mock('../store', () => ({
  loadData: vi.fn(() => ({})),
  saveData: vi.fn(),
  listMemories: vi.fn(() => []),
  copyDatabaseTo: vi.fn(async () => void startupOrder.push('migration')),
  scrubMemoryConversationLinks: vi.fn(() => 0),
  rebuildSearchIndex: vi.fn(async () => undefined)
}))
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
  sender: {
    getURL: () => 'file:///sagyou/index.html',
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push({ channel, payload })
  }
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'sagyou-main-'))
  // An old install: a chat history the first launch has to snapshot and remove.
  await writeFile(join(userData, 'ai-conversations.json'), '[{"id":"c1"}]')
  // Importing the module runs whenReady() and registers everything.
  await import('../index')
  await new Promise((r) => setImmediate(r))
})

afterAll(async () => {
  await rm(userData, { recursive: true, force: true })
})

beforeEach(() => {
  sent.length = 0
  vi.mocked(listMemories).mockReturnValue([])
})

describe('legacy chat removal on startup', () => {
  it('snapshots and removes the chat data before the first window is created', async () => {
    expect(startupOrder.slice(0, 2)).toEqual(['migration', 'createWindow'])
    const state = JSON.parse(await readFile(join(userData, 'legacy-chat-state.json'), 'utf-8'))
    // The conversations are in the snapshot and gone from userData.
    expect(
      await readFile(join(state.legacyChatSnapshotDir, 'ai-conversations.json'), 'utf-8')
    ).toBe('[{"id":"c1"}]')
    await expect(readFile(join(userData, 'ai-conversations.json'), 'utf-8')).rejects.toThrow()
  })

  it('keeps its state in a file of its own, out of reach of the store', async () => {
    // persistAll() empties the SQLite `settings` table on a session's first
    // save; a marker kept there made the migration run on every launch.
    const state = JSON.parse(await readFile(join(userData, 'legacy-chat-state.json'), 'utf-8'))
    expect(typeof state.legacyChatRemovedAt).toBe('string')
    expect(state.legacyChatSnapshotDir).toContain('pre-remocao-chat-')
  })

  it('offers the snapshot notice once', async () => {
    const notice = await invoke<{ snapshotDir: string } | null>('legacy-chat:notice')
    expect(notice?.snapshotDir).toContain('pre-remocao-chat-')

    await invoke('legacy-chat:dismiss')
    expect(await invoke('legacy-chat:notice')).toBeNull()
  })
})

describe('main handlers are registered', () => {
  it('exposes the code and config channels that remain', () => {
    for (const ch of [
      'ai:config:get',
      'ai:config:set',
      'ai:code:list',
      'ai:code:read',
      'ai:code:search',
      'ai:harnesses:status'
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('no longer registers any channel of the generic chat', () => {
    for (const ch of [
      'ai:conversations:list',
      'ai:conversations:get',
      'ai:conversations:save',
      'ai:conversations:rename',
      'ai:conversations:delete',
      'ai:conversations:search',
      'ai:conversations:all',
      'ai:conversations:replace',
      'ai:images:save',
      'ai:images:get',
      'ai:images:delete',
      'ai:usage:summary',
      'ai:run-metrics:append',
      'ai:run-metrics:summary',
      'ai:chat',
      'ai:chat:stream',
      'ai:models',
      'ai:chatgpt:session',
      'ai:chatgpt:profiles',
      'ai:chatgpt:sign-in',
      'ai:chatgpt:select',
      'ai:chatgpt:disconnect',
      'ai:chatgpt:models',
      'ai:chatgpt:manage-usage',
      'ai:chatgpt:stream'
    ]) {
      expect(handlers.has(ch), ch).toBe(false)
    }
  })

  it('rejects a data request from a renderer outside the app document', () => {
    const handler = handlers.get('store:load')
    expect(handler).toBeDefined()
    expect(() =>
      handler?.(
        { sender: { getURL: () => 'https://untrusted.example', isDestroyed: () => false } },
        ...([] as never[])
      )
    ).toThrow('Solicitação IPC recusada.')
  })
})

describe('ai:config:*', () => {
  const configPath = (): string => join(userData, 'ai-config.json')

  it('never returns API keys, even when an old file still holds them', async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        apiKey: 'segredo',
        baseUrl: 'http://x',
        model: 'm',
        providerProfiles: [{ id: 'a', name: 'A', kind: 'api', baseUrl: 'u', apiKey: 'k2', model: 'm' }],
        codeHarness: 'claude-code',
        userName: 'Ana'
      })
    )
    const cfg = await invoke<Record<string, unknown>>('ai:config:get')
    const text = JSON.stringify(cfg)
    expect(text).not.toContain('segredo')
    expect(text).not.toContain('k2')
    for (const key of ['apiKey', 'hasApiKey', 'providerProfiles', 'baseUrl', 'model']) {
      expect(cfg).not.toHaveProperty(key)
    }
    expect(cfg).toMatchObject({ codeHarness: 'claude-code', userName: 'Ana' })
  })

  it('does not accept API keys on write, and keeps agent and unknown keys', async () => {
    await writeFile(
      configPath(),
      JSON.stringify({ codeHarness: 'codex', sandboxEnabled: false, chaveFutura: { x: 1 } })
    )
    await invoke('ai:config:set', {
      codeHarness: 'opencode',
      userName: '  Ana  ',
      apiKey: 'novo-segredo',
      model: 'gpt',
      providerProfiles: [{ id: 'a', apiKey: 'k3' }],
      codeAgent: { apiKey: 'k4' },
      lastConversationId: 'c1'
    })
    const raw = await readFile(configPath(), 'utf-8')
    const saved = JSON.parse(raw)
    expect(saved).toMatchObject({
      codeHarness: 'opencode',
      userName: 'Ana',
      sandboxEnabled: false,
      chaveFutura: { x: 1 }
    })
    for (const key of ['apiKey', 'model', 'providerProfiles', 'codeAgent', 'lastConversationId']) {
      expect(saved).not.toHaveProperty(key)
    }
    expect(raw).not.toContain('segredo')
    expect(raw).not.toContain('k3')
    expect(raw).not.toContain('k4')
  })

  it('turns a legacy sagyou harness into codex on read', async () => {
    await writeFile(configPath(), JSON.stringify({ codeHarness: 'sagyou' }))
    expect(await invoke('ai:config:get')).toMatchObject({ codeHarness: 'codex' })
  })

  it('keeps a copy of an unreadable config instead of silently overwriting it', async () => {
    // The migration leaves an unreadable ai-config.json alone on purpose; the
    // first executor switch in the Fleet must not be what destroys it.
    await writeFile(configPath(), '{ not json, mas pode ser recuperável')

    await invoke('ai:config:set', { codeHarness: 'claude-code' })

    expect(JSON.parse(await readFile(configPath(), 'utf-8'))).toMatchObject({
      codeHarness: 'claude-code'
    })
    const copies = (await readdir(userData)).filter((name) =>
      name.startsWith('ai-config.json.corrupt-')
    )
    expect(copies).toHaveLength(1)
    expect(await readFile(join(userData, copies[0]), 'utf-8')).toBe(
      '{ not json, mas pode ser recuperável'
    )
  })

  it('writes the config atomically, leaving no temporary file', async () => {
    await writeFile(configPath(), JSON.stringify({ codeHarness: 'codex' }))
    await invoke('ai:config:set', { codeHarness: 'claude-code' })
    expect((await readdir(userData)).filter((name) => name.endsWith('.tmp'))).toEqual([])
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
      const res = await invoke<{ content: string; truncated: boolean }>(
        'ai:code:read',
        root,
        'src/a.ts'
      )
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
 * The native code agent (the loop in ../code-agent), driven end to end through
 * the real `ai:code-agent:run` handler against the stand-in provider.
 *
 * The old external-codex tests were removed with the codex spawn path; the loop
 * itself is unit-tested in code-agent.test.ts. What these cover is the IPC glue
 * the unit tests can't: the run handler streaming to the panel, the real model
 * in the banner, and the per-action approval round-trip.
 */
