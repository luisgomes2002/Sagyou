/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import type { Dialog, IpcMain } from 'electron'
import { isValidBackup } from '../backup-validation'
import { registerBackupHandlers } from '../handlers/backup'

const backup = (): {
  version: number
  exportedAt: string
  projects: { id: string; name: string; columns: never[] }[]
  tasks: never[]
} => ({
  version: 7,
  exportedAt: '2026-10-01T12:00:00.000Z',
  projects: [{ id: 'p1', name: 'Projeto', columns: [] }],
  tasks: []
})

describe('backup restore flow', () => {
  it('validates first and keeps original bytes until the restore point is saved', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sagyou-backup-test-'))
    try {
      const filesDir = join(root, 'files')
      mkdirSync(filesDir)
      const fileId = '12345678-1234-1234-1234-123456789abc'
      const attachment = join(filesDir, `${fileId}.txt`)
      writeFileSync(attachment, 'original')
      const selected = join(root, 'invalid.json')
      writeFileSync(
        selected,
        JSON.stringify({
          ...backup(),
          projects: undefined,
          fileBlobs: [
            { id: fileId, ext: '.txt', base64: Buffer.from('overwritten').toString('base64') }
          ]
        })
      )
      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
      registerBackupHandlers(
        {
          handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
            handlers.set(name, fn)
        } as unknown as IpcMain,
        {
          dialog: {
            showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [selected] })
          } as unknown as Dialog,
          filesDir,
          chatImagesDir: join(root, 'chat-images'),
          taskImagesDir: join(root, 'task-images'),
          backupDir: join(root, 'backups'),
          sep,
          chatImagePath: () => null,
          taskImagePath: () => null
        }
      )
      expect(await handlers.get('backup:import')?.(null)).toEqual({
        success: false,
        error: 'Backup inválido ou incompatível'
      })
      expect(readFileSync(attachment, 'utf8')).toBe('original')
      expect(await handlers.get('backup:commit-blobs')?.(null)).toEqual({ success: false })
      expect(await handlers.get('backup:auto-save')?.(null, backup())).toEqual({ success: true })
      expect(readdirSync(join(root, 'backups'))).toHaveLength(1)

      writeFileSync(
        selected,
        JSON.stringify({
          ...backup(),
          fileBlobs: [
            { id: fileId, ext: '.txt', base64: Buffer.from('overwritten').toString('base64') }
          ]
        })
      )
      expect(await handlers.get('backup:import')?.(null)).toMatchObject({ success: true })
      expect(readFileSync(attachment, 'utf8')).toBe('original')
      expect(
        await handlers.get('backup:auto-save')?.(
          null,
          {
            ...backup(),
            files: [{ id: fileId, ext: '.txt' }]
          },
          true
        )
      ).toEqual({ success: true })
      const restorePoint = readdirSync(join(root, 'backups')).find((name) =>
        name.startsWith('sagyou-before-import-')
      )
      expect(restorePoint).toBeDefined()
      const saved = JSON.parse(readFileSync(join(root, 'backups', restorePoint!), 'utf8'))
      expect(Buffer.from(saved.fileBlobs[0].base64, 'base64').toString()).toBe('original')
      expect(await handlers.get('backup:commit-blobs')?.(null)).toEqual({ success: true })
      expect(readFileSync(attachment, 'utf8')).toBe('overwritten')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('backup validation', () => {
  it('accepts current and legacy backups, including an intentionally empty board', () => {
    expect(isValidBackup(backup())).toBe(true)
    expect(isValidBackup({ ...backup(), version: 2, projects: [] })).toBe(true)
  })

  it('rejects JSON that would silently erase live data', () => {
    expect(isValidBackup({ ...backup(), projects: undefined })).toBe(false)
    expect(isValidBackup({ ...backup(), tasks: 'missing' })).toBe(false)
    expect(isValidBackup({ ...backup(), projects: [null] })).toBe(false)
    expect(isValidBackup({ ...backup(), version: 99 })).toBe(false)
  })

  it('rejects malformed optional data and blob payloads before writing anything', () => {
    expect(isValidBackup({ ...backup(), lists: {} })).toBe(false)
    expect(isValidBackup({ ...backup(), fileBlobs: [{ id: 'x', base64: null }] })).toBe(false)
    expect(
      isValidBackup({
        ...backup(),
        fileBlobs: [
          { id: '12345678-1234-1234-1234-123456789abc', ext: '.txt', base64: 'not base64!' }
        ]
      })
    ).toBe(false)
  })
})
