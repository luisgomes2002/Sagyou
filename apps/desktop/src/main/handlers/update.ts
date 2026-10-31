import type { IpcMain } from 'electron'
import type { LogArea, LogData } from '../modules/logs/logger'
import type { AppUpdater, UpdateStatus } from '../modules/update/app-updater'

type LogFn = (area: LogArea, event: string, data?: LogData) => void

export interface UpdateHandlerDeps {
  updater: Pick<AppUpdater, 'status' | 'check' | 'markInstallFailed' | 'quitAndInstall'>
  /** Stops agent-run timers while the renderer can still save their time. */
  stopAgentTimers: () => Promise<void>
  flushForInstall: () => Promise<boolean>
  allowCloseForInstall: (on: boolean) => void
  abortInstall: () => void
  openExternal: (url: string) => unknown
  log: { info: LogFn; warn: LogFn; error: LogFn }
}

/** `update:*`. Register after protectDataIpc: installing flushes the user's data. */
export function registerUpdateHandlers(ipcMain: IpcMain, deps: UpdateHandlerDeps): void {
  const { updater } = deps
  let installing = false

  const abort = (reason: string): UpdateStatus => {
    deps.log.warn('update', 'install_aborted', { msg: reason })
    deps.abortInstall()
    updater.markInstallFailed()
    return updater.status()
  }

  ipcMain.handle('update:status', () => updater.status())
  ipcMain.handle('update:check', () => updater.check())

  ipcMain.handle('update:install', async () => {
    if (installing || updater.status().state !== 'ready') return updater.status()
    installing = true
    try {
      try {
        await deps.stopAgentTimers()
      } catch {
        return abort('timers')
      }
      if (!(await deps.flushForInstall())) return abort('flush')
      deps.allowCloseForInstall(true)
      // The updater marks the failure itself; this gives back the close guard and the screen.
      const giveBack = (): void => {
        deps.log.warn('update', 'install_aborted', { msg: 'install' })
        deps.abortInstall()
      }
      if (!updater.quitAndInstall(giveBack)) giveBack()
      return updater.status()
    } finally {
      installing = false
    }
  })

  // Only the Release URL the updater built; never one from the renderer.
  ipcMain.handle('update:open-release', () => {
    const url = updater.status().releaseUrl
    if (url) void deps.openExternal(url)
  })
}
