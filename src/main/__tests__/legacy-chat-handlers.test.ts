// @vitest-environment node
import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  registerLegacyChatHandlers,
  shouldRunLegacyChatRemoval,
  startLegacyChatRemoval
} from '../handlers/legacy-chat'

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

describe('shouldRunLegacyChatRemoval', () => {
  // Only the database has a dev suffix; every other file shares userData with
  // the installed app, so a dev run would delete the real chat and API keys.
  it('runs in a packaged app', () => {
    expect(shouldRunLegacyChatRemoval({ isDev: false, optIn: undefined })).toBe(true)
  })

  it('does not run in dev unless explicitly opted in', () => {
    expect(shouldRunLegacyChatRemoval({ isDev: true, optIn: undefined })).toBe(false)
    expect(shouldRunLegacyChatRemoval({ isDev: true, optIn: '0' })).toBe(false)
    expect(shouldRunLegacyChatRemoval({ isDev: true, optIn: '1' })).toBe(true)
  })
})

describe('startLegacyChatRemoval', () => {
  it('reports the migration warnings', async () => {
    const warn = vi.fn()
    await startLegacyChatRemoval({
      run: async () => ({ status: 'aborted', warnings: ['disco cheio'] }),
      warn
    })
    expect(warn).toHaveBeenCalledWith('disco cheio')
  })

  it('never lets a migration crash stop the app from starting', async () => {
    const warn = vi.fn()
    await expect(
      startLegacyChatRemoval({
        run: async () => {
          throw new Error('boom')
        },
        warn
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('legacy-chat IPC', () => {
  const done = { legacyChatRemovedAt: '2026-10-24T11:00:00.000Z', legacyChatSnapshotDir: '/backups/pre-1' }

  it('shows the notice once, then not after it is dismissed', async () => {
    const settings = fakeSettings(done)
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

  it('does not say the history was removed while the migration is still unfinished', async () => {
    // A snapshot exists but the marker does not: the run was interrupted and
    // the API keys are still on disk waiting for the next launch.
    const settings = fakeSettings({ legacyChatSnapshotDir: '/backups/pre-1' })
    const ipc = fakeIpc()
    registerLegacyChatHandlers(ipc as unknown as Pick<IpcMain, 'handle'>, {
      readSetting: settings.read,
      writeSetting: settings.write,
      now: () => new Date()
    })

    expect(await ipc.invoke('legacy-chat:notice')).toBeNull()
  })

  it('has no notice when no migration ever produced a snapshot', async () => {
    const settings = fakeSettings({ legacyChatRemovedAt: '2026-10-24T11:00:00.000Z' })
    const ipc = fakeIpc()
    registerLegacyChatHandlers(ipc as unknown as Pick<IpcMain, 'handle'>, {
      readSetting: settings.read,
      writeSetting: settings.write,
      now: () => new Date()
    })

    expect(await ipc.invoke('legacy-chat:notice')).toBeNull()
  })
})
