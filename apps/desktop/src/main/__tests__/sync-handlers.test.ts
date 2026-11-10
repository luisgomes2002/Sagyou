// @vitest-environment node
//
// Spec 2026-11-08-recuperacao-codigo: the PC recovers by code always replacing
// its data with the cloud's (the engine makes a forced backup first).
import { describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import type { IpcMain } from 'electron'
import { registerSyncHandlers } from '../handlers/sync'
import { SyncUserError, type SyncEngine } from '../modules/sync/sync-engine'

type Handler = (event: unknown, ...args: unknown[]) => unknown

function setup(recover: ReturnType<typeof vi.fn>): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  } as unknown as IpcMain
  registerSyncHandlers(ipcMain, {
    engine: { recover } as unknown as SyncEngine,
    listFiles: () => [],
    hasFileBytes: () => false,
    verifyAppPassword: () => true,
    defaultDeviceName: () => 'PC'
  })
  return handlers
}

describe('sync:recover', () => {
  it('chama o motor substituindo os dados do PC', async () => {
    const status = { state: 'ok' }
    const recover = vi.fn().mockResolvedValue(status)
    const handlers = setup(recover)
    const result = await handlers.get('sync:recover')!({}, 'CODE', 'setup', undefined, {
      totp: '123456'
    })
    expect(recover).toHaveBeenCalledWith('CODE', 'setup', 'PC', { totp: '123456' }, 'replace')
    expect(result).toEqual({ ok: true, status })
  })

  it('devolve o texto do erro do motor', async () => {
    const recover = vi.fn().mockRejectedValue(new SyncUserError('Código de recuperação inválido.'))
    const handlers = setup(recover)
    const result = await handlers.get('sync:recover')!({}, 'X', 'setup', undefined, undefined)
    expect(result).toEqual({ ok: false, error: 'Código de recuperação inválido.' })
  })
})

describe('sync:resolve', () => {
  function withResolve(): { handlers: Map<string, Handler>; resolve: ReturnType<typeof vi.fn> } {
    const resolve = vi.fn()
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
    } as unknown as IpcMain
    registerSyncHandlers(ipcMain, {
      engine: { resolve } as unknown as SyncEngine,
      listFiles: () => [],
      hasFileBytes: () => false,
      verifyAppPassword: () => true,
      defaultDeviceName: () => 'PC'
    })
    return { handlers, resolve }
  }

  it('repassa a escolha por campo ao motor', async () => {
    const { handlers, resolve } = withResolve()
    const choice = { fields: { title: 'local', timeSpent: 'remote' }, expectedHlc: 'h1' }
    expect(await handlers.get('sync:resolve')!({}, 'c1', choice)).toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith('c1', choice)
    await handlers.get('sync:resolve')!({}, 'c1', { fields: {}, expectedHlc: null })
    expect(resolve).toHaveBeenLastCalledWith('c1', { fields: {}, expectedHlc: null })
    await handlers.get('sync:resolve')!({}, 'c1', 'remote')
    expect(resolve).toHaveBeenLastCalledWith('c1', 'remote')
  })

  it.each([
    ['lado fora de local/remote', { fields: { title: 'outro' }, expectedHlc: null }],
    [
      'mais de 64 campos',
      {
        fields: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`f${i}`, 'local'])),
        expectedHlc: null
      }
    ],
    ['nome de campo longo', { fields: { ['x'.repeat(65)]: 'local' }, expectedHlc: null }],
    ['expectedHlc que não é texto', { fields: {}, expectedHlc: 5 }],
    ['sem fields', { expectedHlc: null }],
    ['fields em lista', { fields: ['local'], expectedHlc: null }]
  ])('recusa %s sem chamar o motor', async (_name, choice) => {
    const { handlers, resolve } = withResolve()
    expect(await handlers.get('sync:resolve')!({}, 'c1', choice)).toEqual({
      ok: false,
      error: 'Dados inválidos.'
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
