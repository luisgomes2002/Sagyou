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
import { mkdtemp, readdir, readFile, writeFile, rm } from 'fs/promises'
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

/** Desktop-shell mocks: tray, single-instance lock, login item and power events. */
const desktop = vi.hoisted(() => ({
  requestSingleInstanceLock: { calls: 0 },
  trays: [] as { tooltip?: string; menu?: unknown }[],
  loginItems: [] as unknown[],
  power: new Map<string, () => void>(),
  syncStarts: 0
}))

// The real engine, with its start() counted: sync must start at launch, locked or not.
vi.mock('../modules/sync/sync-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/sync/sync-engine')>()
  return {
    ...actual,
    createSyncEngine: (deps: Parameters<typeof actual.createSyncEngine>[0]) => {
      const engine = actual.createSyncEngine(deps)
      const start = engine.start.bind(engine)
      engine.start = () => {
        desktop.syncStarts++
        start()
      }
      return engine
    }
  }
})

let userData: string

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    whenReady: () => Promise.resolve(),
    getPath: (name: string) => (name === 'userData' ? userData : tmpdir()),
    getVersion: () => '0.0.0-test',
    // The installed app (the updater still stays off: no app-update.yml here).
    isPackaged: true,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: () => {
      desktop.requestSingleInstanceLock.calls++
      return true
    },
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: (settings: unknown) => desktop.loginItems.push(settings)
  },
  Tray: class {
    private state: { tooltip?: string; menu?: unknown } = {}
    constructor() {
      desktop.trays.push(this.state)
    }
    setToolTip(text: string): void {
      this.state.tooltip = text
    }
    setContextMenu(menu: unknown): void {
      this.state.menu = menu
    }
    on = vi.fn()
  },
  Menu: { buildFromTemplate: (items: unknown) => items },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show = vi.fn()
  },
  powerMonitor: {
    on: (name: string, fn: () => void) => desktop.power.set(name, fn),
    getSystemIdleTime: () => 0
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: never[]) => unknown) =>
      handlers.set(channel, fn),
    on: vi.fn()
  },
  BrowserWindow: class {
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
    isDestroyed = (): boolean => false
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
  rebuildSearchIndex: vi.fn(async () => undefined),
  listProjectCodeRoots: vi.fn(() => [])
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

describe('motor na bandeja', () => {
  it('takes the single-instance lock outside dev and puts an icon in the tray', () => {
    expect(desktop.requestSingleInstanceLock.calls).toBe(1)
    expect(desktop.trays).toHaveLength(1)
    expect(desktop.trays[0].tooltip).toBe('Sagyou')
  })

  it('starts sync at launch, before any store:load or unlock', () => {
    expect(desktop.syncStarts).toBe(1)
  })

  it('stores only the prefs the renderer may change', async () => {
    const view = await invoke<Record<string, unknown>>('desktop:prefs:set', {
      trayNoticeShown: true,
      foo: 1,
      idleLockMinutes: 30
    })
    expect(view.idleLockMinutes).toBe(30)
    expect(view.trayNoticeShown).toBe(false)
    const stored = JSON.parse(await readFile(join(userData, 'desktop-prefs.json'), 'utf-8'))
    expect(stored).toEqual({
      closeToTray: process.platform === 'win32',
      idleLockMinutes: 30,
      lockOnSystemLock: true,
      trayNoticeShown: false
    })
    expect(view).toHaveProperty('platform', process.platform)
  })

  it('registers the Windows login item with the hidden flag', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await invoke('desktop:open-at-login:set', true)
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
    expect(desktop.loginItems).toContainEqual({ openAtLogin: true, args: ['--hidden'] })
  })

  it('does not lock on the Windows lock screen without a password', async () => {
    winSent.length = 0
    desktop.power.get('lock-screen')?.()
    await new Promise((resolve) => setImmediate(resolve))
    expect(winSent.some((m) => m.channel === 'security:lock-request')).toBe(false)
  })

  it('locks on the Windows lock screen: renderer saves, then data IPC closes', async () => {
    expect(desktop.power.has('lock-screen')).toBe(true)
    expect(desktop.power.has('suspend')).toBe(true)
    await expect(invoke('security:enable', 'senha-de-teste-1')).resolves.toEqual({
      success: true
    })
    try {
      winSent.length = 0
      desktop.power.get('lock-screen')?.()
      // Prepare (cards denied, run timers stopped) runs before the renderer is asked.
      await new Promise((resolve) => setImmediate(resolve))
      expect(winSent.some((m) => m.channel === 'security:lock-request')).toBe(true)
      // Still saving: data IPC stays open for the renderer's flush.
      await expect(invoke('desktop:prefs:get')).resolves.toBeDefined()
      await invoke('security:lock-ready')
      await expect(invoke('desktop:prefs:get')).rejects.toThrow(
        'Desbloqueie o Sagyou para acessar os dados.'
      )
      await expect(invoke('security:unlock', 'senha-de-teste-1')).resolves.toEqual({
        success: true
      })
      await expect(invoke('desktop:prefs:get')).resolves.toBeDefined()
    } finally {
      await invoke('security:disable', 'senha-de-teste-1')
    }
  })

  it('keeps the desktop prefs behind the renderer check', () => {
    const foreign = { sender: { getURL: () => 'https://evil.example/' } }
    for (const channel of ['desktop:prefs:get', 'desktop:prefs:set', 'desktop:open-at-login:set']) {
      expect(() => handlers.get(channel)?.(foreign)).toThrow('Solicitação IPC recusada.')
    }
  })
})

describe('atualização automática', () => {
  it('fora do app instalado fica desligada e não segura o sync', async () => {
    const status = await invoke<{ state: string }>('update:status')
    expect(status.state).toBe('disabled')
    expect(handlers.has('update:install')).toBe(true)
    expect(handlers.has('update:open-release')).toBe(true)
    expect(handlers.has('app:flush-before-install:complete')).toBe(true)
  })
})

describe('controle remoto', () => {
  it('registra os canais remote:* atrás do desbloqueio', () => {
    for (const ch of [
      'remote:status',
      'remote:enable',
      'remote:disable',
      'remote:authorizations',
      'remote:authorize',
      'remote:refuse',
      'remote:revoke',
      'remote:esp32:create'
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
    // The server list comes from rc-server:list now.
    expect(handlers.has('remote:servers:set')).toBe(false)
    const foreign = { sender: { getURL: () => 'https://evil.example/' } }
    expect(() => handlers.get('remote:status')?.(foreign)).toThrow('Solicitação IPC recusada.')
  })

  it('registra os canais rc-server:* atrás do desbloqueio', async () => {
    const channels = [
      'rc-server:list',
      'rc-server:configure',
      'rc-server:start',
      'rc-server:stop',
      'rc-server:terminal-input',
      'rc-server:terminal-resize',
      'rc-server:terminal-reconnect'
    ]
    const foreign = { sender: { getURL: () => 'https://evil.example/' } }
    for (const ch of channels) {
      expect(handlers.has(ch), ch).toBe(true)
      expect(() => handlers.get(ch)?.(foreign), ch).toThrow('Solicitação IPC recusada.')
    }
    const list = await invoke<{ supported: boolean; servers: unknown[] }>('rc-server:list')
    expect(list.supported).toBe(process.platform === 'win32')
    expect(Array.isArray(list.servers)).toBe(true)
  })

  it('o estado começa desligado e sem chaves', async () => {
    const status = await invoke<{ enabled: boolean; controllers: unknown[]; hasEsp32Key: boolean }>(
      'remote:status'
    )
    expect(status).toMatchObject({ enabled: false, controllers: [], hasEsp32Key: false })
  })
})

describe('main handlers are registered', () => {
  it('exposes the config and harness channels that remain', () => {
    for (const ch of [
      'ai:config:get',
      'ai:config:set',
      'ai:harnesses:status'
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('no longer registers the channels nothing in the renderer called', () => {
    for (const ch of [
      'ai:code:list',
      'ai:code:read',
      'ai:code:search',
      'ai:project-file:read',
      'ai:lineage:list',
      'ai:web:fetch',
      'ai:skills:list',
      'ai:skills:save',
      'ai:skills:delete',
      'ai:skills:import'
    ]) {
      expect(handlers.has(ch)).toBe(false)
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
        providerProfiles: [
          { id: 'a', name: 'A', kind: 'api', baseUrl: 'u', apiKey: 'k2', model: 'm' }
        ],
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
    // An unreadable ai-config.json is left alone on purpose; the first executor
    // switch in the Fleet must not be what destroys it.
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
