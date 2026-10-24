// @vitest-environment node
import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  registerLegacyChatHandlers,
  startLegacyChatRemoval
} from '../handlers/legacy-chat'
import type { LegacyChatRemovalResult } from '../modules/ai/legacy-chat-removal'

function fakeSettings(initial: Record<string, unknown> = {}): {
  read: (key: string) => unknown
  write: (key: string, value: unknown) => void
  values: Record<string, unknown>
} {
  const values = { ...initial }
  return {
    values,
    read: (key) => values[key] ?? null,
    write: (key, value) => {
      values[key] = value
    }
  }
}

function fakeIpc(): {
  handle: (channel: string, fn: (...args: never[]) => unknown) => void
  invoke: (channel: string) => Promise<unknown>
} {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  return {
    handle: (channel, fn) => void handlers.set(channel, fn),
    invoke: async (channel) => handlers.get(channel)?.({} as never)
  }
}

const done = (snapshotDir: string): LegacyChatRemovalResult => ({
  status: 'done',
  snapshotDir,
  warnings: []
})

describe('startLegacyChatRemoval', () => {
  it('remembers the first snapshot so the notice survives a restart', async () => {
    const settings = fakeSettings()
    await startLegacyChatRemoval({
      run: async () => done('/backups/pre-1'),
      readSetting: settings.read,
      writeSetting: settings.write
    })

    expect(settings.values.legacyChatSnapshotDir).toBe('/backups/pre-1')
  })

  it('does not replace the first snapshot after an interrupted retry', async () => {
    const settings = fakeSettings({ legacyChatSnapshotDir: '/backups/pre-1' })
    await startLegacyChatRemoval({
      run: async () => done('/backups/pre-2'),
      readSetting: settings.read,
      writeSetting: settings.write
    })

    expect(settings.values.legacyChatSnapshotDir).toBe('/backups/pre-1')
  })

  it('records nothing when the migration was skipped or aborted without a snapshot', async () => {
    const settings = fakeSettings()
    await startLegacyChatRemoval({
      run: async () => ({ status: 'skipped', warnings: [] }),
      readSetting: settings.read,
      writeSetting: settings.write
    })
    await startLegacyChatRemoval({
      run: async () => ({ status: 'aborted', warnings: ['disco cheio'] }),
      readSetting: settings.read,
      writeSetting: settings.write
    })

    expect(settings.values).toEqual({})
  })

  it('never lets a migration crash stop the app from starting', async () => {
    const settings = fakeSettings()
    const warn = vi.fn()
    await expect(
      startLegacyChatRemoval({
        run: async () => {
          throw new Error('boom')
        },
        readSetting: settings.read,
        writeSetting: settings.write,
        warn
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('legacy-chat IPC', () => {
  it('shows the notice once, then not after it is dismissed', async () => {
    const settings = fakeSettings({ legacyChatSnapshotDir: '/backups/pre-1' })
    const ipc = fakeIpc()
    registerLegacyChatHandlers(ipc as unknown as Pick<IpcMain, 'handle'>, {
      readSetting: settings.read,
      writeSetting: settings.write,
      now: () => new Date('2026-10-24T12:00:00.000Z')
    })

    expect(await ipc.invoke('legacy-chat:notice')).toEqual({ snapshotDir: '/backups/pre-1' })
    await ipc.invoke('legacy-chat:dismiss')
    expect(settings.values.legacyChatNoticeDismissedAt).toBe('2026-10-24T12:00:00.000Z')
    expect(await ipc.invoke('legacy-chat:notice')).toBeNull()
  })

  it('has no notice when no migration ever produced a snapshot', async () => {
    const settings = fakeSettings()
    const ipc = fakeIpc()
    registerLegacyChatHandlers(ipc as unknown as Pick<IpcMain, 'handle'>, {
      readSetting: settings.read,
      writeSetting: settings.write,
      now: () => new Date()
    })

    expect(await ipc.invoke('legacy-chat:notice')).toBeNull()
  })
})
