import type { IpcMain } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, mkdirSync, copyFileSync, unlinkSync, statSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { safeAttachmentName } from '../backup-files'
import {
  isImageFileName,
  saveImageToDir,
  readImageAsDataUrl,
  deleteImageFiles,
  decodeDataUrl
} from '../chat-images'
import type { BrowserWindow, Dialog, Shell } from 'electron'

interface Deps {
  mainWindow: BrowserWindow | null
  dialog: Dialog
  shell: Shell
  filesDir: string
  chatImagesDir: string
  taskImagesDir: string
  userDataPath: string
  sep: string
}

export function registerFilesHandlers(
  ipcMain: IpcMain,
  deps: Deps
): void {
  const { dialog: dlg, shell: sh, filesDir, chatImagesDir, taskImagesDir, userDataPath: _, sep } = deps

  // --- File attachments ---

  ipcMain.handle('files:upload', async () => {
    const { filePaths, canceled } = await dlg.showOpenDialog({
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
        /* skip files that can't be copied */
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
    const error = await sh.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  ipcMain.handle('files:openInBrowser', async (_, id: string, ext: string) => {
    const filePath = join(filesDir, `${id}${ext}`)
    try {
      await sh.openExternal(`file://${filePath}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('files:download', async (_, id: string, name: string, ext: string) => {
    const { filePath: dest, canceled } = await dlg.showSaveDialog({
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

  // --- Excel export ---

  ipcMain.handle('excel:export', async (_, buffer: Buffer, filename: string) => {
    const { filePath, canceled } = await dlg.showSaveDialog({
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

  // --- Chat images ---

  const chatImagePath = (id: unknown): string | null => {
    if (!isImageFileName(id)) return null
    const full = join(chatImagesDir, id)
    return full.startsWith(chatImagesDir + sep) ? full : null
  }

  ipcMain.handle('ai:images:save', (_, dataUrl: string) =>
    saveImageToDir(chatImagesDir, dataUrl, (decoded) => ({
      id: `${randomUUID()}.${decoded.ext}`
    }))
  )

  ipcMain.handle('ai:images:get', (_, id: string) => {
    const full = chatImagePath(id)
    const ext = typeof id === 'string' ? id.split('.').pop() ?? '' : ''
    return readImageAsDataUrl(full, ext)
  })

  ipcMain.handle('ai:images:delete', (_, ids: string[]) => {
    if (!Array.isArray(ids)) return
    deleteImageFiles(ids.map((id) => chatImagePath(id)))
  })

  // --- Task images ---

  const taskImagePath = (id: unknown, ext: unknown): string | null => {
    const name = safeAttachmentName(id, ext)
    if (!name) return null
    const full = join(taskImagesDir, name)
    return full.startsWith(taskImagesDir + sep) ? full : null
  }

  ipcMain.handle('task:images:save', (_, dataUrl: string) => {
    const decoded = decodeDataUrl(dataUrl)
    if ('error' in decoded) return decoded
    try {
      if (!existsSync(taskImagesDir)) mkdirSync(taskImagesDir, { recursive: true })
      const id = randomUUID()
      const ext = `.${decoded.ext}`
      writeFileSync(join(taskImagesDir, `${id}${ext}`), decoded.bytes)
      return { id, ext, size: decoded.bytes.length }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao salvar a imagem' }
    }
  })

  ipcMain.handle('task:images:get', (_, id: string, ext: string) => {
    const full = taskImagePath(id, ext)
    return readImageAsDataUrl(full, ext.replace(/^\./, ''))
  })

  ipcMain.handle('task:images:delete', (_, items: { id: string; ext: string }[]) => {
    if (!Array.isArray(items)) return
    deleteImageFiles(items.map((it) => taskImagePath(it?.id, it?.ext)))
  })
}
