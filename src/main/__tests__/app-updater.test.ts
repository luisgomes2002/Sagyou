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
  quitAndInstall = vi.fn()
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
