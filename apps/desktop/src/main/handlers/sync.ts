import type { IpcMain } from 'electron'
import { log } from '../modules/logs/logger'
import {
  SyncUserError,
  type SyncEngine,
  type SyncResult,
  type SyncSecondFactor,
  type SyncStatus
} from '../modules/sync/sync-engine'

interface SyncHandlerDeps {
  engine: SyncEngine
  /** Attachment metadata as the store has it, for files:availability. */
  listFiles: () => { id: string; ext: string }[]
  hasFileBytes: (id: string, ext: string) => boolean
  /** True when the app has no password, or the given one is right. */
  verifyAppPassword: (password: unknown) => boolean
  /** Used when the renderer sends no device name (the OS host name). */
  defaultDeviceName: () => string
}

const GENERIC_ERROR = 'Não foi possível concluir a operação de sincronização.'

/** Every action answers `{ok: true, ...}` or `{ok: false, error}`; only SyncUserError text reaches the screen. */
async function run<T extends object>(
  action: string,
  fn: () => Promise<T> | T
): Promise<SyncResult<T>> {
  try {
    const value = await fn()
    return { ...value, ok: true as const }
  } catch (err) {
    if (err instanceof SyncUserError) return { ok: false, error: err.message }
    log.error('sync', 'ipc_failed', { action, name: err instanceof Error ? err.name : 'unknown' })
    return { ok: false, error: GENERIC_ERROR }
  }
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new SyncUserError('Dados inválidos.')
  return value
}

function factorOf(value: unknown): SyncSecondFactor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const totp = (value as { totp?: unknown }).totp
  return typeof totp === 'string' && /^[0-9A-Za-z-]{1,32}$/.test(totp) ? { totp } : undefined
}

/**
 * The sync:* channels and files:availability. Registered after protectDataIpc,
 * like every handler that reads or writes data: nothing here runs locked.
 */
export function registerSyncHandlers(ipcMain: IpcMain, deps: SyncHandlerDeps): void {
  const { engine } = deps
  const deviceName = (value: unknown): string =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : deps.defaultDeviceName()

  ipcMain.handle('sync:status', (): SyncStatus => engine.status())

  ipcMain.handle(
    'sync:activate',
    (_, url: unknown, setupToken: unknown, name: unknown, factor: unknown) =>
      run('activate', () =>
        engine.activate(text(url, 2048), text(setupToken, 512), deviceName(name), factorOf(factor))
      )
  )

  ipcMain.handle('sync:invite', () => run('invite', () => engine.createInvite()))

  ipcMain.handle(
    'sync:recover',
    (_, code: unknown, setupToken: unknown, name: unknown, factor: unknown) =>
      run('recover', async () => ({
        status: await engine.recover(
          text(code, 4096),
          text(setupToken, 512),
          deviceName(name),
          factorOf(factor)
        )
      }))
  )

  ipcMain.handle('sync:join', (_, code: unknown, mode: unknown, name: unknown) =>
    run('join', async () => {
      if (mode !== 'merge' && mode !== 'replace') throw new SyncUserError('Dados inválidos.')
      return { status: await engine.join(text(code, 4096), mode, deviceName(name)) }
    })
  )

  ipcMain.handle('sync:now', (): Promise<SyncStatus> => engine.syncNow())

  ipcMain.handle('sync:devices', () =>
    run('devices', async () => ({ devices: await engine.devices() }))
  )

  ipcMain.handle('sync:revoke', (_, id: unknown, wipe: unknown, factor: unknown) =>
    run('revoke', async () => {
      if (typeof wipe !== 'boolean') throw new SyncUserError('Dados inválidos.')
      await engine.revoke(text(id, 64), wipe, factorOf(factor))
      return {}
    })
  )

  ipcMain.handle('sync:totp:enroll', () =>
    run('totp-enroll', async () => ({ uri: await engine.enrollTotp() }))
  )

  ipcMain.handle('sync:totp:confirm', (_, code: unknown) =>
    run('totp-confirm', async () => ({ backupCodes: await engine.confirmTotp(text(code, 6)) }))
  )

  ipcMain.handle('sync:conflicts', () =>
    run('conflicts', () => ({ conflicts: engine.conflicts() }))
  )

  ipcMain.handle('sync:resolve', (_, id: unknown, choice: unknown) =>
    run('resolve', () => {
      if (choice !== 'local' && choice !== 'remote') throw new SyncUserError('Dados inválidos.')
      engine.resolve(text(id, 64), choice)
      return {}
    })
  )

  // The code is the sync key itself: with an app password, only after it is typed again.
  ipcMain.handle('sync:recovery-code', (_, password: unknown) =>
    run('recovery-code', () => {
      if (!deps.verifyAppPassword(password)) throw new SyncUserError('Senha incorreta.')
      return { code: engine.recoveryCode() }
    })
  )

  ipcMain.handle('sync:disable', () =>
    run('disable', async () => {
      await engine.disable()
      return {}
    })
  )

  ipcMain.handle('sync:resume', (_, choice: unknown) =>
    run('resume', async () => {
      if (choice !== 'push-local' && choice !== 'take-cloud')
        throw new SyncUserError('Dados inválidos.')
      return { status: await engine.resume(choice) }
    })
  )

  ipcMain.handle('sync:after-restore', (_, choice: unknown) =>
    run('after-restore', async () => {
      if (choice !== 'propagate' && choice !== 'pause') throw new SyncUserError('Dados inválidos.')
      return { status: await engine.afterRestore(choice) }
    })
  )

  // {fileId: null} when the bytes are here; otherwise the name of the device that has them.
  ipcMain.handle(
    'files:availability',
    (): Promise<Record<string, string | null>> =>
      engine.fileAvailability(deps.listFiles(), deps.hasFileBytes)
  )
}
