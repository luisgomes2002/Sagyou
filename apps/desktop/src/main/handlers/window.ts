import { BrowserWindow, shell } from 'electron'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { safeExternalUrl } from '../modules/web/external-links'

export interface ManagedWindow {
  window: BrowserWindow
  completeClose: () => void
  /** Asks the renderer to save without closing; false on failure or timeout. */
  flushForInstall: (timeoutMs?: number) => Promise<boolean>
  completeInstallFlush: (ok: boolean) => void
  /** Lets the updater's quit close the window without a second flush. */
  allowCloseForInstall: (on: boolean) => void
  /** Restores the normal close and the renderer's screen after a failed install. */
  abortInstall: () => void
}

interface CreateManagedWindowOptions {
  preloadPath: string
  productionPagePath: string
  icon?: string
  isDev: boolean
  rendererUrl?: string
}

/** Owns window navigation policy and the async renderer-flush close protocol. */
export function createManagedWindow(options: CreateManagedWindowOptions): ManagedWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Sagyou',
    frame: false,
    ...(process.platform === 'linux' && options.icon ? { icon: options.icon } : {}),
    webPreferences: { preload: options.preloadPath, sandbox: false, spellcheck: false }
  })
  let allowClose = false
  let closePending = false
  let flushTimeout: ReturnType<typeof setTimeout> | null = null
  const completeClose = (): void => {
    if (window.isDestroyed()) return
    if (flushTimeout) clearTimeout(flushTimeout)
    flushTimeout = null
    allowClose = true
    window.close()
  }

  let installFlush: ((ok: boolean) => void) | null = null
  const flushForInstall = (timeoutMs = 10_000): Promise<boolean> =>
    new Promise((resolve) => {
      if (window.isDestroyed() || closePending || installFlush) {
        resolve(false)
        return
      }
      const timer = setTimeout(() => installFlush?.(false), timeoutMs)
      installFlush = (ok) => {
        clearTimeout(timer)
        installFlush = null
        resolve(ok)
      }
      window.webContents.send('app:flush-before-install')
    })

  window.on('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    if (closePending) return
    closePending = true
    window.webContents.send('app:flush-before-close')
    flushTimeout = setTimeout(completeClose, 10_000)
  })
  window.on('maximize', () => window.webContents.send('window:maximized-change', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized-change', false))
  window.webContents.setWindowOpenHandler((details) => {
    const url = safeExternalUrl(details.url)
    if (url) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  if (options.isDev && options.rendererUrl) window.loadURL(options.rendererUrl)
  else window.loadFile(options.productionPagePath)
  return {
    window,
    completeClose,
    flushForInstall,
    completeInstallFlush: (ok) => installFlush?.(ok),
    allowCloseForInstall: (on) => {
      allowClose = on
    },
    abortInstall: () => {
      allowClose = false
      if (!window.isDestroyed()) window.webContents.send('app:install-aborted')
    }
  }
}

export function registerWindowHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  getManagedWindow: () => ManagedWindow | null,
  assertTrustedRenderer: (event: IpcMainInvokeEvent) => void
): void {
  const win = (): BrowserWindow | null => getWindow()
  ipcMain.handle('window:minimize', () => win()?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (win()?.isMaximized()) win()?.restore()
    else win()?.maximize()
  })
  ipcMain.handle('window:close', () => win()?.close())
  ipcMain.handle('window:is-maximized', () => win()?.isMaximized())
  ipcMain.handle('app:flush-before-close:complete', (event) => {
    // This lifecycle reply must work before password unlock, but only the app
    // renderer may end the window's close handshake.
    assertTrustedRenderer(event)
    getManagedWindow()?.completeClose()
  })
  ipcMain.handle('app:flush-before-install:complete', (event, ok: unknown) => {
    assertTrustedRenderer(event)
    getManagedWindow()?.completeInstallFlush(ok === true)
  })
}
