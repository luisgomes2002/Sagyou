// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import {
  RC_SERVER_TEXT,
  registerRcServerHandlers,
  type RcServerHandlerDeps
} from '../handlers/rc-servers'
import type { RcServerView } from '../modules/remote/rc-manager'

const view: RcServerView = {
  projectId: 'p1',
  name: 'Sagyou',
  enabled: true,
  autostart: true,
  state: 'running',
  confirmed: true,
  error: null
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper; the inferred shape is the API
function fakeManager() {
  return {
    list: vi.fn(() => [view]),
    configure: vi.fn(),
    start: vi.fn(async () => 'ok' as const),
    stop: vi.fn(async () => 'ok' as const),
    input: vi.fn(() => true),
    resize: vi.fn(() => true),
    snapshot: vi.fn(() => ({ log: 'olá', cols: 120, rows: 40 }))
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper; the inferred shape is the API
function setup(platform: NodeJS.Platform = 'win32') {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  } as unknown as IpcMain
  const manager = fakeManager()
  registerRcServerHandlers(ipcMain, {
    manager: manager as unknown as RcServerHandlerDeps['manager'],
    platform
  })
  const invoke = async <T = Record<string, unknown>>(
    channel: string,
    ...args: unknown[]
  ): Promise<T> => (await handlers.get(channel)!({}, ...args)) as T
  return { handlers, manager, invoke }
}

describe('rc-server:* (IPC dos servidores de Remote Control)', () => {
  it('registra todos os canais', () => {
    const t = setup()
    for (const ch of [
      'rc-server:list',
      'rc-server:configure',
      'rc-server:start',
      'rc-server:stop',
      'rc-server:terminal-input',
      'rc-server:terminal-resize',
      'rc-server:terminal-reconnect'
    ]) {
      expect(t.handlers.has(ch), ch).toBe(true)
    }
  })

  it('rc-server:list devolve { supported, servers }', async () => {
    expect(await setup().invoke('rc-server:list')).toEqual({ supported: true, servers: [view] })
    expect(await setup('linux').invoke('rc-server:list')).toMatchObject({ supported: false })
  })

  it('rc-server:start liga com origem pc e devolve o resultado', async () => {
    const t = setup()
    expect(await t.invoke('rc-server:start', 'p1')).toEqual({ success: true, result: 'ok' })
    expect(t.manager.start).toHaveBeenCalledWith('p1', 'pc')

    t.manager.start.mockResolvedValueOnce('start-failed' as never)
    expect(await t.invoke('rc-server:start', 'p1')).toEqual({
      success: false,
      result: 'start-failed'
    })
  })

  it('rc-server:stop desliga', async () => {
    const t = setup()
    expect(await t.invoke('rc-server:stop', 'p1')).toEqual({ success: true, result: 'ok' })
    expect(t.manager.stop).toHaveBeenCalledWith('p1')
  })

  it('rc-server:configure passa só os campos booleanos', async () => {
    const t = setup()
    expect(
      await t.invoke('rc-server:configure', 'p1', { enabled: false, autostart: 'sim', x: 1 })
    ).toEqual({ success: true })
    expect(t.manager.configure).toHaveBeenCalledWith('p1', { enabled: false })
  })

  it.each([undefined, '', 'x'.repeat(65), 42, { id: 'p1' }])(
    'projectId inválido (%s) dá erro sem chamar o gerenciador',
    async (bad) => {
      const t = setup()
      const error = { success: false, error: RC_SERVER_TEXT.invalidProject }
      expect(await t.invoke('rc-server:start', bad)).toEqual(error)
      expect(await t.invoke('rc-server:stop', bad)).toEqual(error)
      expect(await t.invoke('rc-server:configure', bad, { enabled: true })).toEqual(error)
      expect(t.manager.start).not.toHaveBeenCalled()
      expect(t.manager.stop).not.toHaveBeenCalled()
      expect(t.manager.configure).not.toHaveBeenCalled()
    }
  )

  it('terminal-input aceita bytes válidos e recusa os inválidos', async () => {
    const t = setup()
    expect(await t.invoke('rc-server:terminal-input', 'server:p1', 'y\r')).toEqual({
      success: true
    })
    expect(t.manager.input).toHaveBeenCalledWith('server:p1', 'y\r')

    t.manager.input.mockClear()
    for (const data of ['', 'x'.repeat(8_001), 7]) {
      expect(await t.invoke('rc-server:terminal-input', 'server:p1', data)).toMatchObject({
        success: false
      })
    }
    // Only a server terminal: never a Fleet run id.
    expect(await t.invoke('rc-server:terminal-input', 'run-1', 'y')).toMatchObject({
      success: false
    })
    expect(t.manager.input).not.toHaveBeenCalled()

    t.manager.input.mockReturnValueOnce(false)
    expect(await t.invoke('rc-server:terminal-input', 'server:p9', 'y')).toEqual({
      success: false,
      error: RC_SERVER_TEXT.invalidTerminal
    })
  })

  it('terminal-resize recusa tamanhos fora do limite', async () => {
    const t = setup()
    expect(await t.invoke('rc-server:terminal-resize', 'server:p1', 120, 40)).toEqual({
      success: true
    })
    expect(t.manager.resize).toHaveBeenCalledWith('server:p1', 120, 40)

    t.manager.resize.mockClear()
    for (const [cols, rows] of [
      [10, 40],
      [120, 2],
      [501, 40],
      [120.5, 40],
      ['120', 40]
    ]) {
      expect(await t.invoke('rc-server:terminal-resize', 'server:p1', cols, rows)).toEqual({
        success: false,
        error: RC_SERVER_TEXT.invalidSize
      })
    }
    expect(t.manager.resize).not.toHaveBeenCalled()
  })

  it('terminal-reconnect devolve { success, log, cols, rows }', async () => {
    const t = setup()
    expect(await t.invoke('rc-server:terminal-reconnect', 'server:p1')).toEqual({
      success: true,
      log: 'olá',
      cols: 120,
      rows: 40
    })
    t.manager.snapshot.mockReturnValueOnce(null as never)
    expect(await t.invoke('rc-server:terminal-reconnect', 'server:p2')).toEqual({
      success: false,
      error: RC_SERVER_TEXT.invalidTerminal
    })
    expect(await t.invoke('rc-server:terminal-reconnect', 'p1')).toMatchObject({
      success: false
    })
  })
})
