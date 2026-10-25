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
import { readFile } from 'fs/promises'
import { safeAttachmentName } from '../modules/files/backup-files'
import { isValidBackup } from '../modules/files/backup-validation'
import type { IpcMain, Dialog, IpcMainInvokeEvent } from 'electron'

interface BlobEntry {
  id: string
  ext: string
  base64: string
}

interface BackupDeps {
  dialog: Dialog
  filesDir: string
  taskImagesDir: string
  sep: string
  taskImagePath: (id: unknown, ext: unknown) => string | null
  backupDir: string
}

export function registerBackupHandlers(ipcMain: IpcMain, deps: BackupDeps): void {
  const { dialog, filesDir, taskImagesDir, sep, taskImagePath } = deps

  let pendingBlobs: { fileBlobs?: unknown; taskImages?: unknown } | null =
    null
  const exportJobs = new Map<number, { cancelled: boolean }>()
  const yieldToRenderer = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  const fullBackup = async (
    backup: unknown,
    event?: IpcMainInvokeEvent,
    job?: { cancelled: boolean }
  ): Promise<Record<string, unknown>> => {
    const source = backup as { files?: unknown; tasks?: unknown }
    const total =
      (Array.isArray(source.files) ? source.files.length : 0) +
      (Array.isArray(source.tasks)
        ? source.tasks.reduce(
            (count, task) =>
              count +
              (Array.isArray((task as { images?: unknown }).images)
                ? (task as { images: unknown[] }).images.length
                : 0),
            0
          )
        : 0)
    let completed = 0
    const progress = (): void => event?.sender.send('backup:export-progress', { completed, total })
    const checkpoint = async (): Promise<void> => {
      if (job?.cancelled) throw new Error('Exportação cancelada.')
      completed++
      progress()
      await yieldToRenderer()
    }
    progress()
    return {
      ...(backup as Record<string, unknown>),
      fileBlobs: await collectFileBlobs(source.files, checkpoint),
      taskImages: await collectTaskImageBlobs(source.tasks, checkpoint)
    }
  }

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

  const collectFileBlobs = async (
    files: unknown,
    checkpoint: () => Promise<void>
  ): Promise<BlobEntry[]> => {
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
          base64: (await readFile(full)).toString('base64')
        })
      } catch {
        /* unreadable blob is skipped, not fatal to the backup */
      }
      await checkpoint()
    }
    return out
  }

  const collectTaskImageBlobs = async (
    tasks: unknown,
    checkpoint: () => Promise<void>
  ): Promise<BlobEntry[]> => {
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
            base64: (await readFile(full)).toString('base64')
          })
        } catch {
          /* unreadable blob is skipped */
        }
        await checkpoint()
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
      writeFileSync(full, Buffer.from(b64, 'base64'))
    }
  }

  const restoreTaskImages = (blobs: unknown): void => {
    if (!Array.isArray(blobs)) return
    if (!existsSync(taskImagesDir)) mkdirSync(taskImagesDir, { recursive: true })
    for (const b of blobs) {
      const full = taskImagePath((b as { id?: unknown })?.id, (b as { ext?: unknown })?.ext ?? '')
      const b64 = (b as { base64?: unknown })?.base64
      if (!full || typeof b64 !== 'string') continue
      writeFileSync(full, Buffer.from(b64, 'base64'))
    }
  }

  ipcMain.on('backup:export:cancel', (event) => {
    const job = exportJobs.get(event.sender.id)
    if (job) job.cancelled = true
  })

  ipcMain.handle('backup:export', async (event, backup) => {
    const date = new Date().toISOString().split('T')[0]
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `kanban-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    const job = { cancelled: false }
    exportJobs.set(event.sender.id, job)
    try {
      const full = await fullBackup(backup, event, job)
      if (job.cancelled) return { success: false, cancelled: true }
      writeAtomic(filePath, JSON.stringify(full, null, 2))
      event.sender.send('backup:export-progress', { completed: 1, total: 1, done: true })
      return { success: true }
    } catch (error) {
      if (job.cancelled || (error instanceof Error && error.message === 'Exportação cancelada.'))
        return { success: false, cancelled: true }
      throw error
    } finally {
      exportJobs.delete(event.sender.id)
    }
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
      writeAtomic(path, JSON.stringify(await fullBackup(backup)))
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
        taskImages: data.taskImages
      }
      if (data && typeof data === 'object') {
        delete data.fileBlobs
        // Removed chat history: never reaches the renderer or disk.
        delete data.conversations
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
    try {
      restoreFileBlobs(blobs.fileBlobs)
      restoreTaskImages(blobs.taskImages)
      pendingBlobs = null
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Não foi possível restaurar os anexos.'
      }
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
}
