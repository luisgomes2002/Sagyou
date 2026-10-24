import type { IpcMain } from 'electron'
import type { LegacyChatRemovalResult } from '../modules/ai/legacy-chat-removal'

const SNAPSHOT_KEY = 'legacyChatSnapshotDir'
const DISMISSED_KEY = 'legacyChatNoticeDismissedAt'

interface SettingsAccess {
  readSetting: (key: string) => unknown
  writeSetting: (key: string, value: unknown) => void
}

/**
 * Runs the one-time removal and remembers where the snapshot went. The first
 * snapshot wins: an interrupted run that retries makes a second one holding no
 * conversations, and that is not the folder the user should be pointed to.
 * A failure here must never stop the app from opening.
 */
export async function startLegacyChatRemoval(
  deps: SettingsAccess & {
    run: () => Promise<LegacyChatRemovalResult>
    warn?: (message: string) => void
  }
): Promise<void> {
  try {
    const result = await deps.run()
    for (const message of result.warnings) deps.warn?.(message)
    if (result.snapshotDir && !deps.readSetting(SNAPSHOT_KEY)) {
      deps.writeSetting(SNAPSHOT_KEY, result.snapshotDir)
    }
  } catch (reason) {
    deps.warn?.(
      `Remoção do histórico falhou: ${reason instanceof Error ? reason.message : String(reason)}`
    )
  }
}

/** The renderer pulls the notice when the Fleet opens; main has no window yet at migration time. */
export function registerLegacyChatHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  deps: SettingsAccess & { now: () => Date }
): void {
  ipcMain.handle('legacy-chat:notice', () => {
    const snapshotDir = deps.readSetting(SNAPSHOT_KEY)
    if (typeof snapshotDir !== 'string' || !snapshotDir) return null
    if (deps.readSetting(DISMISSED_KEY)) return null
    return { snapshotDir }
  })
  ipcMain.handle('legacy-chat:dismiss', () => {
    deps.writeSetting(DISMISSED_KEY, deps.now().toISOString())
  })
}
