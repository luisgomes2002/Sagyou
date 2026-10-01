import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync
} from 'fs'
import { safeAttachmentName } from '../backup-files'
import { isValidBackup } from '../backup-validation'
import type { IpcMain, Dialog } from 'electron'

interface BlobEntry {
  id: string
  ext: string
  base64: string
}

interface ImageEntry {
  id: string
  base64: string
}

interface BackupDeps {
  dialog: Dialog
  filesDir: string
  chatImagesDir: string
  taskImagesDir: string
  sep: string
  chatImagePath: (id: unknown) => string | null
  taskImagePath: (id: unknown, ext: unknown) => string | null
  backupDir: string
}

export function registerBackupHandlers(ipcMain: IpcMain, deps: BackupDeps): void {
  const { dialog, filesDir, chatImagesDir, taskImagesDir, sep, chatImagePath, taskImagePath } = deps

  let pendingBlobs: { fileBlobs?: unknown; chatImages?: unknown; taskImages?: unknown } | null =
    null

  const fullBackup = (backup: unknown): Record<string, unknown> => ({
    ...(backup as Record<string, unknown>),
    fileBlobs: collectFileBlobs((backup as { files?: unknown })?.files),
    chatImages: collectChatImages(),
    taskImages: collectTaskImageBlobs((backup as { tasks?: unknown })?.tasks)
  })

  const writeAtomic = (path: string, content: string): void => {
    const tmp = `${path}.tmp`
    try {
      writeFileSync(tmp, content, 'utf-8')
      renameSync(tmp, path)
    } catch (error) {
      if (existsSync(tmp)) unlinkSync(tmp)
      throw error
    }
  }

  const collectFileBlobs = (files: unknown): BlobEntry[] => {
    if (!Array.isArray(files)) return []
    const out: BlobEntry[] = []
    for (const f of files) {
      const id = (f as { id?: unknown })?.id
      const ext = (f as { ext?: unknown })?.ext ?? ''
      const name = safeAttachmentName(id, ext)
      if (!name) continue
      const full = join(filesDir, name)
      if (!full.startsWith(filesDir + sep) || !existsSync(full)) continue
      try {
        out.push({
          id: id as string,
          ext: ext as string,
          base64: readFileSync(full).toString('base64')
        })
      } catch {
        /* unreadable blob is skipped, not fatal to the backup */
      }
    }
    return out
  }

  const collectChatImages = (): ImageEntry[] => {
    if (!existsSync(chatImagesDir)) return []
    const out: ImageEntry[] = []
    for (const id of readdirSync(chatImagesDir)) {
      const full = chatImagePath(id)
      if (!full || !existsSync(full)) continue
      try {
        out.push({ id, base64: readFileSync(full).toString('base64') })
      } catch {
        /* skip an unreadable image */
      }
    }
    return out
  }

  const collectTaskImageBlobs = (tasks: unknown): BlobEntry[] => {
    if (!Array.isArray(tasks)) return []
    const out: BlobEntry[] = []
    for (const t of tasks) {
      const imgs = (t as { images?: unknown })?.images
      if (!Array.isArray(imgs)) continue
      for (const img of imgs) {
        const id = (img as { id?: unknown })?.id
        const ext = (img as { ext?: unknown })?.ext ?? ''
        const full = taskImagePath(id, ext)
        if (!full || !existsSync(full)) continue
        try {
          out.push({
            id: id as string,
            ext: ext as string,
            base64: readFileSync(full).toString('base64')
          })
        } catch {
          /* unreadable blob is skipped */
        }
      }
    }
    return out
  }

  const restoreFileBlobs = (blobs: unknown): void => {
    if (!Array.isArray(blobs)) return
    if (!existsSync(filesDir)) mkdirSync(filesDir, { recursive: true })
    for (const b of blobs) {
      const name = safeAttachmentName(
        (b as { id?: unknown })?.id,
        (b as { ext?: unknown })?.ext ?? ''
      )
      const b64 = (b as { base64?: unknown })?.base64
      if (!name || typeof b64 !== 'string') continue
      const full = join(filesDir, name)
      if (!full.startsWith(filesDir + sep)) continue
      try {
        writeFileSync(full, Buffer.from(b64, 'base64'))
      } catch {
        /* one bad blob doesn't abort the restore */
      }
    }
  }

  const restoreChatImages = (images: unknown): void => {
    if (!Array.isArray(images)) return
    if (!existsSync(chatImagesDir)) mkdirSync(chatImagesDir, { recursive: true })
    for (const img of images) {
      const id = (img as { id?: unknown })?.id
      const b64 = (img as { base64?: unknown })?.base64
      const full = chatImagePath(id)
      if (!full || typeof b64 !== 'string') continue
      try {
        writeFileSync(full, Buffer.from(b64, 'base64'))
      } catch {
        /* skip a bad image */
      }
    }
  }

  const restoreTaskImages = (blobs: unknown): void => {
    if (!Array.isArray(blobs)) return
    if (!existsSync(taskImagesDir)) mkdirSync(taskImagesDir, { recursive: true })
    for (const b of blobs) {
      const full = taskImagePath((b as { id?: unknown })?.id, (b as { ext?: unknown })?.ext ?? '')
      const b64 = (b as { base64?: unknown })?.base64
      if (!full || typeof b64 !== 'string') continue
      try {
        writeFileSync(full, Buffer.from(b64, 'base64'))
      } catch {
        /* one bad blob doesn't abort the restore */
      }
    }
  }

  ipcMain.handle('backup:export', async (_, backup) => {
    const date = new Date().toISOString().split('T')[0]
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `kanban-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    const full = fullBackup(backup)
    writeAtomic(filePath, JSON.stringify(full, null, 2))
    return { success: true }
  })

  // One local restore point per day, plus forced snapshots just before import.
  // The latest seven snapshots stay available even when the user never exports manually.
  ipcMain.handle('backup:auto-save', async (_, backup: unknown, force = false) => {
    if (!isValidBackup(backup)) return { success: false }
    try {
      mkdirSync(deps.backupDir, { recursive: true })
      const now = new Date()
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const name = force
        ? `sagyou-before-import-${day}-${now.toTimeString().slice(0, 8).replace(/:/g, '-')}-${now.getMilliseconds()}.json`
        : `sagyou-${day}.json`
      const path = join(deps.backupDir, name)
      writeAtomic(path, JSON.stringify(fullBackup(backup)))
      const snapshots = readdirSync(deps.backupDir)
        .filter((file) => /^sagyou-(?:before-import-)?\d{4}-\d{2}-\d{2}.*\.json$/.test(file))
        .sort(
          (a, b) =>
            statSync(join(deps.backupDir, b)).mtimeMs - statSync(join(deps.backupDir, a)).mtimeMs
        )
      for (const old of snapshots.slice(7)) unlinkSync(join(deps.backupDir, old))
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('backup:import', async () => {
    pendingBlobs = null
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, cancelled: true }
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      const data = JSON.parse(content)
      if (!isValidBackup(data)) return { success: false, error: 'Backup inválido ou incompatível' }
      pendingBlobs = {
        fileBlobs: data.fileBlobs,
        chatImages: data.chatImages,
        taskImages: data.taskImages
      }
      if (data && typeof data === 'object') {
        delete data.fileBlobs
        delete data.chatImages
        delete data.taskImages
      }
      return { success: true, data }
    } catch {
      return { success: false, error: 'Arquivo inválido' }
    }
  })

  ipcMain.handle('backup:commit-blobs', () => {
    if (!pendingBlobs) return { success: false }
    const blobs = pendingBlobs
    pendingBlobs = null
    restoreFileBlobs(blobs.fileBlobs)
    restoreChatImages(blobs.chatImages)
    restoreTaskImages(blobs.taskImages)
    return { success: true }
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
}
