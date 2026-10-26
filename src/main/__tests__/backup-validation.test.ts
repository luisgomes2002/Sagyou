/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import type { Dialog, IpcMain } from 'electron'
import { isValidBackup } from '../modules/files/backup-validation'
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
            handlers.set(name, fn),
          on: vi.fn()
        } as unknown as IpcMain,
        {
          dialog: {
            showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [selected] })
          } as unknown as Dialog,
          filesDir,
          taskImagesDir: join(root, 'task-images'),
          backupDir: join(root, 'backups'),
          sep,
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

describe('legacy chat data in a backup', () => {
  it('backup:import drops conversations and chatImages and writes no chat-images', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sagyou-backup-chat-'))
    try {
      const filesDir = join(root, 'files')
      mkdirSync(filesDir)
      const selected = join(root, 'old.json')
      writeFileSync(
        selected,
        JSON.stringify({
          ...backup(),
          conversations: [{ id: 'c1' }, { id: 'c1' }, 'lixo'],
          chatImages: [{ id: '../../ai-config.json', base64: '!!' }]
        })
      )
      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
      registerBackupHandlers(
        {
          handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
            handlers.set(name, fn),
          on: vi.fn()
        } as unknown as IpcMain,
        {
          dialog: {
            showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [selected] })
          } as unknown as Dialog,
          filesDir,
          taskImagesDir: join(root, 'task-images'),
          backupDir: join(root, 'backups'),
          sep,
          taskImagePath: () => null
        }
      )
      const result = (await handlers.get('backup:import')?.(null)) as {
        success: boolean
        data: Record<string, unknown>
      }
      expect(result.success).toBe(true)
      expect(result.data).not.toHaveProperty('conversations')
      expect(result.data).not.toHaveProperty('chatImages')
      expect(result.data.projects).toHaveLength(1)
      await handlers.get('backup:commit-blobs')?.(null)
      expect(readdirSync(root)).not.toContain('chat-images')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('backup writing', () => {
  it('still carries fileBlobs and taskImages but never chatImages or conversations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sagyou-backup-out-'))
    try {
      const filesDir = join(root, 'files')
      const taskImagesDir = join(root, 'task-images')
      mkdirSync(filesDir)
      mkdirSync(taskImagesDir)
      mkdirSync(join(root, 'chat-images'))
      writeFileSync(join(root, 'chat-images', 'a.png'), 'chat')
      const fileId = '12345678-1234-1234-1234-123456789abc'
      const imgId = '22345678-1234-1234-1234-123456789abc'
      writeFileSync(join(filesDir, `${fileId}.txt`), 'doc')
      writeFileSync(join(taskImagesDir, `${imgId}.png`), 'img')
      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
      registerBackupHandlers(
        {
          handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
            handlers.set(name, fn),
          on: vi.fn()
        } as unknown as IpcMain,
        {
          dialog: {} as unknown as Dialog,
          filesDir,
          taskImagesDir,
          backupDir: join(root, 'backups'),
          sep,
          taskImagePath: (id, ext) => join(taskImagesDir, `${id}${ext}`)
        }
      )
      await handlers.get('backup:auto-save')?.(null, {
        ...backup(),
        files: [{ id: fileId, ext: '.txt' }],
        tasks: [],
        conversations: [{ id: 'c1' }]
      })
      const name = readdirSync(join(root, 'backups'))[0]
      const saved = JSON.parse(readFileSync(join(root, 'backups', name), 'utf8'))
      expect(saved.fileBlobs).toHaveLength(1)
      expect(saved.taskImages).toEqual([])
      expect(saved).not.toHaveProperty('chatImages')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('backup validation', () => {
  it('ignores malformed conversations and chatImages entirely', () => {
    expect(
      isValidBackup({
        ...backup(),
        conversations: [{ id: 'c1' }, { id: 'c1' }, null, 'lixo'],
        chatImages: [{ id: '../../x', base64: 'not base64!' }, 42]
      })
    ).toBe(true)
    expect(isValidBackup({ ...backup(), conversations: 'x', chatImages: {} })).toBe(true)
  })

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

  it('rejects duplicate ids, broken references and invalid planning data', () => {
    expect(
      isValidBackup({
        ...backup(),
        projects: [
          { id: 'p1', name: 'A', columns: [] },
          { id: 'p1', name: 'B', columns: [] }
        ]
      })
    ).toBe(false)
    expect(
      isValidBackup({
        ...backup(),
        tasks: [{ id: 't1', title: 'Órfã', projectId: 'missing', columnId: 'c1' }]
      })
    ).toBe(false)
    expect(
      isValidBackup({
        ...backup(),
        projects: [{ id: 'p1', name: 'Projeto', columns: [{ id: 'c1', name: 'A', order: 0 }] }],
        timeBlocks: [
          {
            id: 'block-1',
            date: '2026-99-40',
            startTime: '09:00',
            endTime: '10:00',
            title: 'Inválido',
            order: 0
          }
        ]
      })
    ).toBe(false)
  })

  it('accepts valid references and rejects malformed persisted timestamps', () => {
    const valid = {
      ...backup(),
      projects: [{ id: 'p1', name: 'Projeto', columns: [{ id: 'c1', name: 'Fazer', order: 0 }] }],
      tasks: [{ id: 't1', title: 'Task', projectId: 'p1', columnId: 'c1' }],
      timeBlocks: [
        {
          id: 'b1',
          date: '2026-10-01',
          startTime: '09:00',
          endTime: '10:00',
          title: 'Foco',
          order: 0,
          taskId: 't1'
        }
      ]
    }
    expect(isValidBackup(valid)).toBe(true)
    expect(isValidBackup({ ...valid, tasks: [{ ...valid.tasks[0], createdAt: 'ontem' }] })).toBe(
      false
    )
  })
})

// Regression: a backup the app itself exported (orphan sprints of a deleted
// project, a 23:20–00:00 planner block) was refused on import, and the same
// state made every automatic snapshot fail silently.
describe('backups with repairable leftovers', () => {
  it('import and auto-save accept them after repair', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sagyou-backup-repair-'))
    try {
      const leftovers = {
        ...backup(),
        sprints: [
          { id: 's1', projectId: 'gone', name: 'v1', createdAt: '2026-06-11T20:15:48.807Z' }
        ],
        timeBlocks: [
          { id: 'b1', date: '2026-08-10', startTime: '23:20', endTime: '00:00', title: 'Inglês' }
        ]
      }
      const selected = join(root, 'backup.json')
      writeFileSync(selected, JSON.stringify(leftovers))
      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
      registerBackupHandlers(
        {
          handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
            handlers.set(name, fn),
          on: vi.fn()
        } as unknown as IpcMain,
        {
          dialog: {
            showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [selected] })
          } as unknown as Dialog,
          filesDir: join(root, 'files'),
          taskImagesDir: join(root, 'task-images'),
          backupDir: join(root, 'backups'),
          sep,
          taskImagePath: () => null
        }
      )
      const result = (await handlers.get('backup:import')?.(null)) as {
        success: boolean
        data: { sprints: unknown[]; timeBlocks: { endTime: string }[] }
      }
      expect(result.success).toBe(true)
      expect(result.data.sprints).toEqual([])
      expect(result.data.timeBlocks[0].endTime).toBe('23:59')

      expect(await handlers.get('backup:auto-save')?.(null, leftovers)).toEqual({ success: true })
      const [snapshot] = readdirSync(join(root, 'backups'))
      const saved = JSON.parse(readFileSync(join(root, 'backups', snapshot), 'utf8'))
      expect(isValidBackup(saved)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
