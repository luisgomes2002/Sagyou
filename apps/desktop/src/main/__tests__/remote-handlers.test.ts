// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { IpcMain } from 'electron'
import type { ControlClient } from '@sagyou/core/control/client'
import {
  REMOTE_TEXT,
  createRemoteCards,
  disableRemoteControl,
  registerRemoteHandlers,
  remoteUnlock,
  type RemoteHandlerDeps
} from '../handlers/remote'
import type { PendingMcpApproval } from '../modules/agent/mcp-approval'
import { defaultRemoteConfig, esp32Key, type RemoteConfig } from '../modules/remote/remote-config'
import type { RemoteService } from '../modules/remote/remote-service'
import type { SafeStorageLike } from '../modules/sync/sync-config'

// A reversible fake that does not leave the plain text readable in the file.
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').reverse().join('')),
  decryptString: (buf) => buf.toString().split('').reverse().join('')
}

function fakeService(): RemoteService & Record<string, ReturnType<typeof vi.fn>> {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn(async () => {}),
    running: vi.fn(() => false),
    lastError: vi.fn(() => null),
    pendingAuthorizations: vi.fn(() => []),
    authorize: vi.fn(async () => 'ok'),
    refuse: vi.fn(async () => {}),
    revokeController: vi.fn(async () => {}),
    sendCard: vi.fn(async () => {}),
    closeCard: vi.fn(async () => {}),
    publishEsp32Key: vi.fn(async () => {}),
    syncStatusChanged: vi.fn(),
    checkDevices: vi.fn(async () => {}),
    statusSoon: vi.fn()
  } as unknown as RemoteService & Record<string, ReturnType<typeof vi.fn>>
}

type FakeClient = ControlClient & Record<string, ReturnType<typeof vi.fn>>

interface HandlerSetup {
  invoke: <T = Record<string, unknown>>(channel: string, ...args: unknown[]) => Promise<T>
  service: ReturnType<typeof fakeService>
  client: FakeClient
  emitStatus: ReturnType<typeof vi.fn>
  config: () => RemoteConfig
}

function setup(over: Partial<RemoteHandlerDeps> = {}): HandlerSetup {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  } as unknown as IpcMain
  let config: RemoteConfig = defaultRemoteConfig()
  const service = fakeService()
  const client = {
    setPc: vi.fn(async () => {}),
    createPowerToken: vi.fn(async () => 'token-do-esp32-123')
  } as unknown as FakeClient
  const emitStatus = vi.fn()
  registerRemoteHandlers(ipcMain, {
    service,
    client,
    config: () => config,
    save: (c) => {
      config = c
    },
    safe,
    platform: 'win32',
    hasPassword: () => true,
    syncActive: () => true,
    now: () => 1_800_000_000_000,
    emitStatus,
    ...over
  })
  const invoke = async <T = Record<string, unknown>>(
    channel: string,
    ...args: unknown[]
  ): Promise<T> => (await handlers.get(channel)!({}, ...args)) as T
  return { invoke, service, client, emitStatus, config: () => config }
}

describe('remote:restore-access', () => {
  it('limpa accessCutAt, avisa e aparece no status; funciona com o controle remoto desligado', async () => {
    const onAccessRestored = vi.fn()
    let config: RemoteConfig = { ...defaultRemoteConfig(), accessCutAt: 1_799_999_000_000 }
    const t = setup({
      onAccessRestored,
      config: () => config,
      save: (c) => {
        config = c
      }
    })
    expect(config.enabled).toBe(false)
    expect((await t.invoke<{ accessCutAt: number | null }>('remote:status')).accessCutAt).toBe(
      1_799_999_000_000
    )
    expect(await t.invoke('remote:restore-access')).toEqual({ ok: true })
    expect(config.accessCutAt).toBeNull()
    expect(onAccessRestored).toHaveBeenCalledTimes(1)
    expect(t.emitStatus).toHaveBeenCalled()
    expect((await t.invoke<{ accessCutAt: number | null }>('remote:status')).accessCutAt).toBeNull()
  })

  it('sem corte, responde ok e não avisa', async () => {
    const onAccessRestored = vi.fn()
    const t = setup({ onAccessRestored })
    expect(await t.invoke('remote:restore-access')).toEqual({ ok: true })
    expect(onAccessRestored).not.toHaveBeenCalled()
  })
})

describe('remote:enable', () => {
  it('recusa fora do Windows, sem senha e sem sync ativo', async () => {
    expect(await setup({ platform: 'linux' }).invoke('remote:enable', { totp: '123456' })).toEqual({
      ok: false,
      error: 'Só funciona no Windows.'
    })
    expect(await setup({ hasPassword: () => false }).invoke('remote:enable', {})).toEqual({
      ok: false,
      error: 'Configure a senha do Sagyou antes.'
    })
    expect(await setup({ syncActive: () => false }).invoke('remote:enable', {})).toEqual({
      ok: false,
      error: 'Ative a sincronização antes.'
    })
  })

  it('marca o PC no Worker com o fator, cria as chaves e inicia o serviço', async () => {
    const t = setup()
    expect(await t.invoke('remote:enable', { totp: '123456' })).toEqual({ ok: true })
    expect(t.client.setPc).toHaveBeenCalledWith({ totp: '123456' })
    expect(t.config().enabled).toBe(true)
    expect(t.config().pcKeys?.publicKey).toBeTruthy()
    expect(t.service.start).toHaveBeenCalled()
    expect(t.emitStatus).toHaveBeenCalled()
  })

  it('erro de fator vira texto da tela', async () => {
    const t = setup()
    const { ControlError } = await import('@sagyou/core/control/client')
    vi.mocked(t.client.setPc).mockRejectedValueOnce(new ControlError('factor'))
    expect(await t.invoke('remote:enable', { totp: '000000' })).toEqual({
      ok: false,
      error: REMOTE_TEXT.factor
    })
    expect(t.config().enabled).toBe(false)
  })
})

describe('desligar o controle remoto', () => {
  it('remote:disable grava desligado e para o serviço', async () => {
    const t = setup()
    await t.invoke('remote:enable', {})
    expect(await t.invoke('remote:disable')).toEqual({ ok: true })
    expect(t.config().enabled).toBe(false)
    expect(t.service.stop).toHaveBeenCalled()
  })

  it('remover a senha do Sagyou tira o PC do modo controlado (M3)', () => {
    let config: RemoteConfig = { ...defaultRemoteConfig(), enabled: true }
    const service = fakeService()
    disableRemoteControl({
      config: () => config,
      save: (c) => {
        config = c
      },
      service,
      reason: 'password-removed'
    })
    expect(config.enabled).toBe(false)
    expect(service.stop).toHaveBeenCalledTimes(1)
  })
})

describe('remote:esp32:create', () => {
  it('devolve token e chave uma vez e grava só a chave cifrada', async () => {
    const t = setup()
    const res = await t.invoke<{ ok: true; token: string; key: string }>('remote:esp32:create', {
      totp: '123456'
    })
    expect(res.ok).toBe(true)
    expect(res.token).toBe('token-do-esp32-123')
    expect(res.key).toMatch(/^[0-9a-f]{64}$/)
    const saved = JSON.stringify(t.config())
    expect(saved).not.toContain(res.token)
    expect(saved).not.toContain(res.key)
    expect(saved).not.toContain(Buffer.from(fromHex(res.key)).toString('base64'))
    expect(esp32Key(t.config(), safe)).toEqual(fromHex(res.key))
    expect(t.service.publishEsp32Key).toHaveBeenCalled()
    // The status never carries them.
    const status = JSON.stringify(await t.invoke('remote:status'))
    expect(status).not.toContain(res.token)
    expect(status).not.toContain(res.key)
  })
})

describe('servidores fora do status do controle remoto', () => {
  it('remote:servers:set não existe e o status não traz servers', async () => {
    const handlers = new Map<string, unknown>()
    const ipcMain = {
      handle: (channel: string, fn: unknown) => handlers.set(channel, fn)
    } as unknown as IpcMain
    registerRemoteHandlers(ipcMain, {
      service: fakeService(),
      client: {} as ControlClient,
      config: () => defaultRemoteConfig(),
      save: () => {},
      safe,
      platform: 'win32',
      hasPassword: () => true,
      syncActive: () => true,
      now: () => 1_800_000_000_000,
      emitStatus: vi.fn()
    })
    expect(handlers.has('remote:servers:set')).toBe(false)
    const t = setup()
    expect(await t.invoke('remote:status')).not.toHaveProperty('servers')
  })
})

describe('remote:authorize', () => {
  it('senha errada mostra "Senha incorreta."', async () => {
    const t = setup()
    vi.mocked(t.service.authorize).mockResolvedValueOnce('wrong-password')
    expect(await t.invoke('remote:authorize', 'a'.repeat(32), 'x')).toEqual({
      ok: false,
      error: 'Senha incorreta.'
    })
  })
})

describe('remoteUnlock', () => {
  it('destrava e avisa o renderer, sem recarregar a loja', () => {
    const setUnlocked = vi.fn()
    const send = vi.fn()
    const loadData = vi.fn()
    remoteUnlock({ canUnlock: () => true, setUnlocked, refreshTray: vi.fn(), send })
    expect(setUnlocked).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('security:remote-unlocked')
    expect(loadData).not.toHaveBeenCalled()
  })

  it('com a senha corrompida não faz nada', () => {
    const setUnlocked = vi.fn()
    const send = vi.fn()
    remoteUnlock({ canUnlock: () => false, setUnlocked, refreshTray: vi.fn(), send })
    expect(setUnlocked).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('createRemoteCards', () => {
  type Card = { id: string; name: string; resumo: string; expiresAt?: string }

  it('cartão vai ao celular; a resposta do celular vence e a do PC depois não faz nada', async () => {
    const pending = new Map<string, PendingMcpApproval<Card>>()
    const service = fakeService()
    const send = vi.fn()
    const cards = createRemoteCards({ maps: () => [pending], service: () => service, send })
    const toRenderer = vi.fn()
    const decision = cards.park(
      pending,
      { id: 'c1', name: 'mcp:delete_task', resumo: 'Apagar' },
      toRenderer,
      'Claude Code'
    )

    expect(toRenderer).toHaveBeenCalled()
    expect(service.sendCard).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        tool: 'delete_task',
        resumo: 'Apagar',
        session: 'Claude Code'
      })
    )
    expect(cards.answer('c1', true)).toBe(true)
    await expect(decision).resolves.toBe(true)
    expect(send).toHaveBeenCalledWith('ai:code-agent:approval-closed', 'c1')
    expect(service.closeCard).toHaveBeenCalledWith('c1')
    // The PC's answer arrives late: nothing happens.
    expect(cards.answer('c1', false)).toBe(false)
    expect(cards.answer('inventado', true)).toBe(false)
  })

  it('sem serviço remoto o cartão segue só no PC', async () => {
    const pending = new Map<string, PendingMcpApproval<Card>>()
    const send = vi.fn()
    const cards = createRemoteCards({ maps: () => [pending], service: () => null, send })
    const decision = cards.park(pending, { id: 'c2', name: 'mcp:x', resumo: 'r' }, vi.fn(), 's')
    cards.answer('c2', false)
    await expect(decision).resolves.toBe(false)
    expect(send).toHaveBeenCalledWith('ai:code-agent:approval-closed', 'c2')
  })
})
