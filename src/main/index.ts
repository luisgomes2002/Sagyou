import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename } from 'path'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, unlinkSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadData, saveData } from './store'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Sagyou',
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  mainWindow.on('maximize', () => mainWindow!.webContents.send('window:maximized-change', true))
  mainWindow.on('unmaximize', () => mainWindow!.webContents.send('window:maximized-change', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sagyou')

  const filesDir = join(app.getPath('userData'), 'files')
  if (!existsSync(filesDir)) mkdirSync(filesDir)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.restore()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized())

  ipcMain.handle('store:load', () => loadData())

  ipcMain.handle('store:save', (_, data) => {
    saveData(data)
  })

  ipcMain.handle('backup:export', async (_, backup) => {
    const date = new Date().toISOString().split('T')[0]
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `kanban-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8')
    return { success: true }
  })

  ipcMain.handle('backup:import', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, cancelled: true }
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      return { success: true, data: JSON.parse(content) }
    } catch {
      return { success: false, error: 'Arquivo inválido' }
    }
  })

  ipcMain.handle('files:upload', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Selecionar arquivos',
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return []
    const results: { id: string; name: string; ext: string; size: number; createdAt: string }[] = []
    for (const filePath of filePaths) {
      try {
        const id = randomUUID()
        const ext = extname(filePath)
        const name = basename(filePath)
        const size = statSync(filePath).size
        copyFileSync(filePath, join(filesDir, `${id}${ext}`))
        results.push({ id, name, ext, size, createdAt: new Date().toISOString() })
      } catch {
        // skip files that can't be copied
      }
    }
    return results
  })

  ipcMain.handle('files:delete', (_, id: string, ext: string) => {
    try {
      const filePath = join(filesDir, `${id}${ext}`)
      if (existsSync(filePath)) unlinkSync(filePath)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('files:open', async (_, id: string, ext: string) => {
    const filePath = join(filesDir, `${id}${ext}`)
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  ipcMain.handle('files:openInBrowser', async (_, id: string, ext: string) => {
    const filePath = join(filesDir, `${id}${ext}`)
    try {
      await shell.openExternal(`file://${filePath}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('files:download', async (_, id: string, name: string, ext: string) => {
    const { filePath: dest, canceled } = await dialog.showSaveDialog({
      defaultPath: name,
      filters: [{ name: 'Todos os arquivos', extensions: ['*'] }]
    })
    if (canceled || !dest) return { success: false, cancelled: true }
    try {
      copyFileSync(join(filesDir, `${id}${ext}`), dest)
      return { success: true }
    } catch {
      return { success: false, error: 'Erro ao salvar arquivo' }
    }
  })

  ipcMain.handle('excel:export', async (_, buffer: Buffer, filename: string) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    try {
      writeFileSync(filePath, Buffer.from(buffer))
      return { success: true }
    } catch {
      return { success: false, error: 'Erro ao salvar arquivo' }
    }
  })

  ipcMain.handle('ai:import', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, cancelled: true }
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      return { success: true, data: JSON.parse(content) }
    } catch {
      return { success: false, error: 'Arquivo inválido' }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
