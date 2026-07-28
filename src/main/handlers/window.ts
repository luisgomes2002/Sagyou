import type { BrowserWindow, IpcMain } from 'electron'

export function registerWindowHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null
): void {
  const win = () => getWindow()
  ipcMain.handle('window:minimize', () => win()?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (win()?.isMaximized()) win()?.restore()
    else win()?.maximize()
  })
  ipcMain.handle('window:close', () => win()?.close())
  ipcMain.handle('window:is-maximized', () => win()?.isMaximized())
}
