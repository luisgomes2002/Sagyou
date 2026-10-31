// @vitest-environment node
//
// "Reiniciar e instalar" must never install over unsaved work: the renderer has
// to confirm its save first, and any failure leaves the current version running.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { registerUpdateHandlers, type UpdateHandlerDeps } from '../handlers/update'
import type { UpdateStatus } from '../modules/update/app-updater'

const ready: UpdateStatus = {
  state: 'ready',
  version: '1.2.0',
  percent: 100,
  releaseUrl: null,
  installError: false
}

let current: UpdateStatus
let calls: string[]
let lateFailure: (() => void) | undefined
let deps: UpdateHandlerDeps
let handlers: Map<string, (...args: unknown[]) => unknown>

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  Promise.resolve(handlers.get(channel)?.({}, ...args) as T)

beforeEach(() => {
  current = { ...ready }
  calls = []
  deps = {
    updater: {
      status: () => current,
      check: vi.fn(async () => current),
      markInstallFailed: vi.fn(() => {
        calls.push('markInstallFailed')
        current = { ...current, installError: true }
      }),
      quitAndInstall: vi.fn((onFailed: () => void) => {
        calls.push('quitAndInstall')
        lateFailure = onFailed
        return true
      })
    },
    stopAgentTimers: vi.fn(async () => void calls.push('stopAgentTimers')),
    flushForInstall: vi.fn(async () => {
      calls.push('flush')
      return true
    }),
    allowCloseForInstall: vi.fn((on: boolean) => void calls.push(`allowClose:${on}`)),
    abortInstall: vi.fn(() => void calls.push('abortInstall')),
    openExternal: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  handlers = new Map()
  registerUpdateHandlers(
    {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
    } as unknown as IpcMain,
    deps
  )
})

describe('update:install', () => {
  it('para os cronômetros, salva, libera o fechamento e só então instala', async () => {
    await invoke('update:install')
    expect(calls).toEqual(['stopAgentTimers', 'flush', 'allowClose:true', 'quitAndInstall'])
  })

  it('com o salvamento falho, não instala e avisa', async () => {
    vi.mocked(deps.flushForInstall).mockResolvedValueOnce(false)
    const status = await invoke<UpdateStatus>('update:install')
    expect(deps.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(calls).toContain('abortInstall')
    expect(status.installError).toBe(true)
    expect(deps.log.warn).toHaveBeenCalledWith('update', 'install_aborted', expect.anything())
  })

  it('cronômetros que falham também abortam', async () => {
    vi.mocked(deps.stopAgentTimers).mockRejectedValueOnce(new Error('ipc'))
    await invoke('update:install')
    expect(deps.flushForInstall).not.toHaveBeenCalled()
    expect(deps.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(calls).toContain('markInstallFailed')
  })

  it('instalação que falha na hora devolve a proteção do fechamento e a tela', async () => {
    vi.mocked(deps.updater.quitAndInstall).mockImplementationOnce(() => {
      calls.push('quitAndInstall')
      return false
    })
    await invoke('update:install')
    expect(calls.slice(-2)).toEqual(['quitAndInstall', 'abortInstall'])
    expect(deps.log.warn).toHaveBeenCalledWith('update', 'install_aborted', { msg: 'install' })
  })

  it('instalação que falha depois também devolve a tela', async () => {
    await invoke('update:install')
    expect(calls).not.toContain('abortInstall')
    lateFailure?.()
    expect(calls).toContain('abortInstall')
  })

  it('fora de "pronto" não faz nada', async () => {
    current = { ...ready, state: 'downloading', percent: 40 }
    await invoke('update:install')
    expect(calls).toEqual([])
  })

  it('dois cliques seguidos instalam uma vez', async () => {
    await Promise.all([invoke('update:install'), invoke('update:install')])
    expect(deps.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('update:open-release', () => {
  it('abre só a URL do estado, ignorando a do renderer', async () => {
    current = {
      ...ready,
      state: 'manual',
      releaseUrl: 'https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0'
    }
    await invoke('update:open-release', 'https://evil.example/')
    expect(deps.openExternal).toHaveBeenCalledWith(
      'https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0'
    )
  })

  it('sem Release no estado, não abre nada', async () => {
    await invoke('update:open-release')
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})

describe('update:status e update:check', () => {
  it('devolvem o estado do atualizador', async () => {
    expect(await invoke('update:status')).toEqual(ready)
    await invoke('update:check')
    expect(deps.updater.check).toHaveBeenCalled()
  })
})
