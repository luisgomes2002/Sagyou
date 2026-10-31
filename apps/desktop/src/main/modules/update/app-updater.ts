// App updates from the project's GitHub Releases, as a state machine over an
// injected electron-updater. No Electron import, so it runs under vitest.
//
// It also owns the sync hold: a found version must be installed before sync
// talks to the server, but a GitHub that never answers may only delay sync by
// UPDATE_SYNC_GRACE_MS.
import type { EventEmitter } from 'events'
import type { LogArea, LogData } from '../logs/logger'

export const UPDATE_SYNC_GRACE_MS = 10_000
export const RELEASES_URL = 'https://github.com/luisgomes2002/Sagyou/releases/tag/v'

export type UpdateState =
  | 'disabled'
  | 'checking'
  | 'none'
  | 'downloading'
  | 'ready'
  | 'manual'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent: number | null
  releaseUrl: string | null
  installError: boolean
}

/** The part of electron-updater's autoUpdater this module drives. */
export interface UpdaterLike extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

type LogFn = (area: LogArea, event: string, data?: LogData) => void

export interface AppUpdaterDeps {
  updater: UpdaterLike
  enabled: boolean
  platform: NodeJS.Platform
  isDeb: boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  emitStatus: (status: UpdateStatus) => void
  /** Called on every change of isSyncHeld(). */
  onSyncHoldChanged: (held: boolean) => void
  log: { info: LogFn; warn: LogFn; error: LogFn }
}

export interface AppUpdater {
  start(): void
  check(): Promise<UpdateStatus>
  status(): UpdateStatus
  isSyncHeld(): boolean
  markInstallFailed(): void
  /**
   * false when the install failed on the spot; onFailed runs when it fails
   * later (electron-updater emits 'error' instead of throwing).
   */
  quitAndInstall(onFailed: () => void): boolean
}

/** Dev, unpacked and Snap builds never check: they cannot install a release. */
export function shouldEnableUpdater(env: {
  isDev: boolean
  isPackaged: boolean
  snap: boolean
  hasUpdateYml: boolean
}): boolean {
  return !env.isDev && env.isPackaged && !env.snap && env.hasUpdateYml
}

const versionOf = (info: unknown): string | null => {
  const version = (info as { version?: unknown } | null)?.version
  return typeof version === 'string' && version ? version : null
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function createAppUpdater(deps: AppUpdaterDeps): AppUpdater {
  const { updater } = deps
  // macOS has no signed build yet, so it cannot install in place.
  const manualOnly = deps.platform === 'darwin'

  let state: UpdateState = deps.enabled ? 'checking' : 'disabled'
  let version: string | null = null
  // A newer version was announced; it owes an install even if its number is missing.
  let found = false
  let installing: { onFailed: () => void; returned: boolean; failed: boolean } | null = null
  let percent: number | null = null
  let installError = false
  let started = false
  // Only the first check holds sync; a retry never pauses a running sync again.
  let graceOver = !deps.enabled
  let graceTimer: unknown = null
  let lastHeld = deps.enabled

  const isSyncHeld = (): boolean => {
    switch (state) {
      case 'checking':
        // A retry after a failed download still owes that install.
        return !graceOver || (found && !manualOnly)
      case 'downloading':
      case 'ready':
        return true
      case 'error':
        // A failed download still owes an install; a failed check does not.
        return found && !manualOnly
      default:
        return false
    }
  }

  const status = (): UpdateStatus => ({
    state,
    version,
    percent,
    releaseUrl: state === 'manual' && version ? `${RELEASES_URL}${version}` : null,
    installError
  })

  const publish = (): void => {
    deps.emitStatus(status())
    const held = isSyncHeld()
    if (held !== lastHeld) {
      lastHeld = held
      deps.onSyncHoldChanged(held)
    }
  }

  const endGrace = (): void => {
    if (graceTimer !== null) deps.clearTimer(graceTimer)
    graceTimer = null
    graceOver = true
  }

  const fail = (error: unknown): void => {
    if (state === 'disabled') return
    if (installing) {
      const attempt = installing
      installing = null
      attempt.failed = true
      deps.log.error('update', 'install_failed', { version, msg: messageOf(error) })
      state = 'ready'
      installError = true
      publish()
      if (attempt.returned) attempt.onFailed()
      return
    }
    if (found && state !== 'manual') {
      deps.log.error('update', 'download_failed', { version, msg: messageOf(error) })
    } else {
      deps.log.warn('update', 'check_failed', { msg: messageOf(error) })
    }
    state = 'error'
    percent = null
    endGrace()
    publish()
  }

  updater.on('update-not-available', () => {
    if (state !== 'checking') return
    // A withdrawn release: nothing is owed any more.
    found = false
    version = null
    state = 'none'
    endGrace()
    publish()
  })
  updater.on('update-available', (info: unknown) => {
    found = true
    version = versionOf(info)
    percent = manualOnly ? null : 0
    state = manualOnly ? 'manual' : 'downloading'
    installError = false
    endGrace()
    deps.log.info('update', 'available', { version })
    publish()
  })
  updater.on('download-progress', (progress: unknown) => {
    if (state !== 'downloading') return
    const value = Number((progress as { percent?: unknown } | null)?.percent)
    if (!Number.isFinite(value)) return
    percent = Math.round(Math.min(100, Math.max(0, value)))
    publish()
  })
  updater.on('update-downloaded', (info: unknown) => {
    version = versionOf(info) ?? version
    state = 'ready'
    percent = 100
    publish()
  })
  updater.on('error', fail)

  const check = async (): Promise<UpdateStatus> => {
    if (!deps.enabled) return status()
    // A check is in flight once state is 'checking' and the updater was asked.
    if (state === 'checking' && started) return status()
    if (state === 'downloading' || state === 'ready') return status()
    started = true
    state = 'checking'
    publish()
    try {
      await updater.checkForUpdates()
    } catch (error) {
      if (state === 'checking') fail(error)
    }
    return status()
  }

  return {
    start(): void {
      if (!deps.enabled) {
        publish()
        return
      }
      if (started) return
      updater.autoDownload = !manualOnly
      updater.autoInstallOnAppQuit = !manualOnly && !deps.isDeb
      updater.allowPrerelease = false
      updater.allowDowngrade = false
      graceTimer = deps.setTimer(() => {
        graceTimer = null
        graceOver = true
        // No answer in time: show it as a failure the user can retry.
        if (state === 'checking') {
          deps.log.warn('update', 'check_timeout')
          state = 'error'
        }
        publish()
      }, UPDATE_SYNC_GRACE_MS)
      void check()
    },
    check,
    status,
    isSyncHeld,
    markInstallFailed(): void {
      if (!found) return
      state = 'ready'
      installError = true
      publish()
    },
    quitAndInstall(onFailed: () => void): boolean {
      deps.log.info('update', 'install_started', { version })
      const attempt = { onFailed, returned: false, failed: false }
      installing = attempt
      try {
        updater.quitAndInstall(true, true)
      } catch (error) {
        fail(error)
      }
      attempt.returned = true
      return !attempt.failed
    }
  }
}
