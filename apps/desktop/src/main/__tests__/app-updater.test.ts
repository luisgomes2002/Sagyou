// @vitest-environment node
//
// The update state machine with a fake electron-updater: the GitHub check must
// never hold sync for longer than its grace period, and a found version must
// hold it until the new build is running.
import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAppUpdater,
  shouldEnableUpdater,
  UPDATE_SYNC_GRACE_MS,
  type UpdateStatus,
  type UpdaterLike
} from '../modules/update/app-updater'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn(async () => null)
  setFeedURL = vi.fn<(options: unknown) => void>()
  quitAndInstall = vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>()
}

class Clock {
  t = 0
  timers: { at: number; fn: () => void; id: number }[] = []
  private next = 1
  now = (): number => this.t
  set = (fn: () => void, ms: number): unknown => {
    const id = this.next++
    this.timers.push({ at: this.t + ms, fn, id })
    return id
  }
  clear = (id: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== id)
  }
  advance(ms: number): void {
    this.t += ms
    const due = this.timers.filter((timer) => timer.at <= this.t)
    this.timers = this.timers.filter((timer) => timer.at > this.t)
    for (const timer of due) timer.fn()
  }
}

const FEED = { provider: 'custom', updateProvider: class {} }
let updater: FakeUpdater
let clock: Clock
let statuses: UpdateStatus[]
let holdChanges: boolean[]
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function make(
  opts: { enabled?: boolean; platform?: NodeJS.Platform; isDeb?: boolean } = {}
): ReturnType<typeof createAppUpdater> {
  return createAppUpdater({
    updater,
    feed: FEED,
    enabled: opts.enabled ?? true,
    platform: opts.platform ?? 'win32',
    isDeb: opts.isDeb ?? false,
    setTimer: clock.set,
    clearTimer: clock.clear,
    emitStatus: (s) => statuses.push(s),
    onSyncHoldChanged: (held) => holdChanges.push(held),
    log
  })
}

beforeEach(() => {
  updater = new FakeUpdater()
  clock = new Clock()
  statuses = []
  holdChanges = []
  vi.clearAllMocks()
})

describe('shouldEnableUpdater', () => {
  const ok = { isDev: false, isPackaged: true, snap: false, hasUpdateYml: true }
  it('só liga no app instalado com app-update.yml', () => {
    expect(shouldEnableUpdater(ok)).toBe(true)
    expect(shouldEnableUpdater({ ...ok, isDev: true })).toBe(false)
    expect(shouldEnableUpdater({ ...ok, isPackaged: false })).toBe(false)
    expect(shouldEnableUpdater({ ...ok, snap: true })).toBe(false)
    expect(shouldEnableUpdater({ ...ok, hasUpdateYml: false })).toBe(false)
  })
})

describe('createAppUpdater', () => {
  it('desligado: não consulta e não segura o sync', () => {
    const app = make({ enabled: false })
    app.start()
    expect(app.status().state).toBe('disabled')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(app.isSyncHeld()).toBe(false)
  })

  it('configura o electron-updater sem prerelease nem downgrade', () => {
    make().start()
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('aponta para o provedor próprio antes da primeira consulta', () => {
    let fedBeforeCheck = false
    updater.checkForUpdates.mockImplementation(async () => {
      fedBeforeCheck = updater.setFeedURL.mock.calls.length === 1
      return null
    })
    make().start()
    expect(updater.setFeedURL).toHaveBeenCalledTimes(1)
    expect(updater.setFeedURL).toHaveBeenCalledWith(FEED)
    expect(fedBeforeCheck).toBe(true)
  })

  it('desligado: nunca troca o provedor', () => {
    make({ enabled: false }).start()
    expect(updater.setFeedURL).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('no .deb não instala sozinho ao fechar', () => {
    make({ platform: 'linux', isDeb: true }).start()
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('sem versão nova: libera o sync uma vez', () => {
    const app = make()
    app.start()
    expect(app.status().state).toBe('checking')
    expect(app.isSyncHeld()).toBe(true)
    updater.emit('update-not-available', { version: '1.0.1' })
    expect(app.status().state).toBe('none')
    expect(app.isSyncHeld()).toBe(false)
    expect(holdChanges).toEqual([false])
  })

  it('erro de rede: estado de erro e sync livre', () => {
    const app = make()
    app.start()
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(app.status().state).toBe('error')
    expect(app.isSyncHeld()).toBe(false)
    expect(log.warn).toHaveBeenCalledWith('update', 'check_failed', expect.anything())
  })

  it('10 s sem resposta liberam o sync; uma versão achada depois volta a segurar', () => {
    const app = make()
    app.start()
    clock.advance(UPDATE_SYNC_GRACE_MS - 1)
    expect(app.isSyncHeld()).toBe(true)
    clock.advance(1)
    expect(app.isSyncHeld()).toBe(false)
    expect(holdChanges).toEqual([false])
    updater.emit('update-available', { version: '1.2.0' })
    expect(app.isSyncHeld()).toBe(true)
    expect(holdChanges).toEqual([false, true])
  })

  it('versão nova: baixa com progresso e fica pronta, segurando o sync', () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    expect(app.status()).toMatchObject({ state: 'downloading', version: '1.2.0' })
    updater.emit('download-progress', { percent: 42.7 })
    expect(app.status().percent).toBe(43)
    updater.emit('update-downloaded', { version: '1.2.0' })
    expect(app.status()).toMatchObject({ state: 'ready', version: '1.2.0' })
    clock.advance(UPDATE_SYNC_GRACE_MS)
    expect(app.isSyncHeld()).toBe(true)
    expect(holdChanges).toEqual([])
  })

  it('erro no download mantém o sync segurado', () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('error', new Error('sha512 checksum mismatch'))
    expect(app.status()).toMatchObject({ state: 'error', version: '1.2.0' })
    expect(app.isSyncHeld()).toBe(true)
    expect(log.error).toHaveBeenCalledWith('update', 'download_failed', expect.anything())
  })

  it('macOS: não baixa, mostra o Release e não segura o sync', () => {
    const app = make({ platform: 'darwin' })
    app.start()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    updater.emit('update-available', { version: '1.2.0' })
    expect(app.status()).toMatchObject({
      state: 'manual',
      version: '1.2.0',
      releaseUrl: 'https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0'
    })
    expect(app.isSyncHeld()).toBe(false)
    expect(holdChanges).toEqual([false])
  })

  it('duas consultas seguidas fazem uma só', async () => {
    const app = make()
    app.start()
    app.start()
    await app.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('"Tentar novamente" rearma a espera e só libera de novo depois de segurar', async () => {
    const app = make()
    app.start()
    updater.emit('error', new Error('offline'))
    expect(holdChanges).toEqual([false])
    void app.check()
    expect(app.status().state).toBe('checking')
    updater.emit('update-not-available', { version: '1.0.1' })
    // Never held again in between, so no second release.
    expect(holdChanges).toEqual([false])
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('checkForUpdates que rejeita vira erro, sem derrubar o app', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('boom'))
    const app = make()
    app.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(app.status().state).toBe('error')
    expect(app.isSyncHeld()).toBe(false)
  })

  it('10 s sem resposta viram erro com log e permitem tentar de novo', async () => {
    const app = make()
    app.start()
    clock.advance(UPDATE_SYNC_GRACE_MS)
    expect(app.status().state).toBe('error')
    expect(log.warn).toHaveBeenCalledWith('update', 'check_timeout')
    await app.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('"Tentar novamente" depois de um download falho mantém o sync segurado', async () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('error', new Error('sha512 checksum mismatch'))
    void app.check()
    expect(app.status().state).toBe('checking')
    expect(app.isSyncHeld()).toBe(true)
    expect(holdChanges).toEqual([])
    // The retry finds the same version again: still held while it downloads.
    updater.emit('update-available', { version: '1.2.0' })
    expect(app.isSyncHeld()).toBe(true)
    expect(holdChanges).toEqual([])
  })

  it('Release retirado: a nova consulta sem versão libera o sync', async () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('error', new Error('404'))
    void app.check()
    updater.emit('update-not-available', { version: '1.0.1' })
    expect(app.isSyncHeld()).toBe(false)
    expect(holdChanges).toEqual([false])
  })

  it('uma versão sem número ainda segura o sync quando o download falha', () => {
    const app = make()
    app.start()
    updater.emit('update-available', {})
    updater.emit('error', new Error('offline'))
    expect(app.isSyncHeld()).toBe(true)
  })

  it('macOS: um erro depois do aviso manual não segura o sync', () => {
    const app = make({ platform: 'darwin' })
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('error', new Error('offline'))
    expect(app.isSyncHeld()).toBe(false)
  })

  it('instalação que falha na hora devolve false e fica pronta com aviso', () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('update-downloaded', { version: '1.2.0' })
    // electron-updater never throws here: it emits 'error' and returns.
    updater.quitAndInstall.mockImplementationOnce(() => {
      updater.emit('error', new Error("No update filepath provided, can't quit and install"))
    })
    const onFailed = vi.fn()
    expect(app.quitAndInstall(onFailed)).toBe(false)
    expect(app.status()).toMatchObject({ state: 'ready', installError: true })
    expect(onFailed).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith('update', 'install_failed', expect.anything())
  })

  it('instalação que falha depois (pkexec cancelado) chama o aviso de falha', () => {
    const app = make({ platform: 'linux', isDeb: true })
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('update-downloaded', { version: '1.2.0' })
    const onFailed = vi.fn()
    expect(app.quitAndInstall(onFailed)).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    updater.emit('error', new Error('dpkg exited with code 1'))
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(app.status()).toMatchObject({ state: 'ready', installError: true })
    expect(app.isSyncHeld()).toBe(true)
  })

  it('instalação que falhou volta para pronto com aviso', () => {
    const app = make()
    app.start()
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('update-downloaded', { version: '1.2.0' })
    app.markInstallFailed()
    expect(app.status()).toMatchObject({ state: 'ready', installError: true })
  })

  it('publica cada mudança de estado', () => {
    const app = make()
    app.start()
    updater.emit('update-not-available', { version: '1.0.1' })
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'none'])
  })
})
