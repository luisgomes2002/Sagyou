import type { IpcMain } from 'electron'
import { join, extname } from 'path'
import { existsSync, mkdirSync, copyFileSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { attachmentPath, safeAttachmentName } from '../modules/files/backup-files'
import {
  readImageAsDataUrl,
  deleteImageFiles,
  decodeDataUrl
} from '../modules/files/image-files'
import { isDocumentExt, parseDocument } from '../modules/files/document-parser'
import { createFileImportRegistry } from '../modules/files/file-import'
import { indexProjectFileContent, loadData, removeProjectFileSearchContent } from '../store'
import type { BrowserWindow, Dialog, Shell } from 'electron'

interface Deps {
  mainWindow: BrowserWindow | null
  dialog: Dialog
  shell: Shell
  filesDir: string
  taskImagesDir: string
  userDataPath: string
  sep: string
}

export function registerFilesHandlers(
  ipcMain: IpcMain,
  deps: Deps
): void {
  const { dialog: dlg, shell: sh, filesDir, taskImagesDir, sep } = deps
  // A just-uploaded file returns to the renderer before its debounced store
  // save reaches SQLite. Keep those known names for this process, then fall
  // back to the persisted metadata for files from earlier sessions.
  const uploadedAttachmentNames = new Set<string>()

  const projectAttachmentPath = (id: unknown, ext: unknown): string | null => {
    const name = safeAttachmentName(id, ext)
    if (!name || typeof id !== 'string' || typeof ext !== 'string') return null
    if (!uploadedAttachmentNames.has(name)) {
      try {
        const known = loadData().files.some((file) => file.id === id && file.ext === ext)
        if (!known) return null
      } catch {
        return null
      }
    }
    return attachmentPath(filesDir, sep, id, ext)
  }

  // --- File attachments ---

  // Importing is two-step (see file-import.ts): pick/stage-paths return tokens,
  // the renderer resolves duplicates, then import/discard consume the tokens.
  const fileImport = createFileImportRegistry({
    filesDir,
    index: indexProjectFileContent,
    onImported: (storedName) => uploadedAttachmentNames.add(storedName)
  })

  ipcMain.handle('files:pick', async () => {
    const { filePaths, canceled } = await dlg.showOpenDialog({
      title: 'Selecionar arquivos',
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return { staged: [], skipped: 0, overLimit: 0 }
    return fileImport.stage(filePaths)
  })

  // Paths of files dropped on the window, resolved by the preload with
  // webUtils.getPathForFile. Only staged after validation; never copied here.
  ipcMain.handle('files:stage-paths', (_, paths: unknown) => fileImport.stage(paths))

  ipcMain.handle('files:import', (_, items: unknown) => fileImport.importStaged(items))

  ipcMain.handle('files:discard', (_, tokens: unknown) => fileImport.discard(tokens))

  ipcMain.handle('files:delete', (_, id: unknown, ext: unknown) => {
    const filePath = projectAttachmentPath(id, ext)
    if (!filePath || typeof id !== 'string') return { success: false, error: 'Arquivo inválido' }
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
      removeProjectFileSearchContent(id)
      const name = safeAttachmentName(id, ext)
      if (name) uploadedAttachmentNames.delete(name)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('files:open', async (_, id: unknown, ext: unknown) => {
    const filePath = projectAttachmentPath(id, ext)
    if (!filePath) return { success: false, error: 'Arquivo inválido' }
    const error = await sh.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  ipcMain.handle('files:openInBrowser', async (_, id: unknown, ext: unknown) => {
    const filePath = projectAttachmentPath(id, ext)
    if (!filePath) return { success: false, error: 'Arquivo inválido' }
    try {
      await sh.openExternal(`file://${filePath}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('files:download', async (_, id: unknown, name: string, ext: unknown) => {
    const source = projectAttachmentPath(id, ext)
    if (!source) return { success: false, error: 'Arquivo inválido' }
    const { filePath: dest, canceled } = await dlg.showSaveDialog({
      defaultPath: name,
      filters: [{ name: 'Todos os arquivos', extensions: ['*'] }]
    })
    if (canceled || !dest) return { success: false, cancelled: true }
    try {
      copyFileSync(source, dest)
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

  // --- Project file reading (for the ler_documento tool) ---

  ipcMain.handle('ai:project-file:read', async (_, fileId: string) => {
    if (!safeAttachmentName(fileId, '')) {
      return { error: 'ID do arquivo inválido' }
    }
    // Walk the filesDir to find the file with this id (files are named <id><ext>).
    let filePath: string | null = null
    let ext = ''
    try {
      const { readdirSync } = await import('fs')
      const entries = readdirSync(filesDir)
      for (const entry of entries) {
        if (entry === fileId || entry.startsWith(`${fileId}.`)) {
          ext = extname(entry)
          filePath = join(filesDir, entry)
          break
        }
      }
    } catch {
      return { error: 'Não foi possível acessar os arquivos do projeto' }
    }
    if (!filePath || !existsSync(filePath)) {
      return { error: 'Arquivo não encontrado' }
    }
    if (!isDocumentExt(ext)) {
      return { error: `Tipo de arquivo não suportado: ${ext}. A leitura é compatível com PDF, DOCX, XLSX, CSV, TXT, MD, JSON, HTML, XML, YAML, RTF, ODT e ODS.` }
    }
    const result = await parseDocument(filePath, ext)
    return result
  })
}
