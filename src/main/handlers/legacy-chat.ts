import type { IpcMain } from 'electron'
import type { LegacyChatRemovalResult } from '../modules/ai/legacy-chat-removal'

const SNAPSHOT_KEY = 'legacyChatSnapshotDir'
const MARKER_KEY = 'legacyChatRemovedAt'
const DISMISSED_KEY = 'legacyChatNoticeDismissedAt'

interface SettingsAccess {
  readSetting: (key: string) => unknown
  writeSetting: (key: string, value: unknown) => void
}

/**
 * Only the database file has a dev suffix; the conversations, API keys and the
 * migration's own state share userData with the installed app. A dev run would
 * therefore delete the user's real chat, so dev needs an explicit opt-in.
 */
export function shouldRunLegacyChatRemoval(env: {
  isDev: boolean
  optIn: string | undefined
}): boolean {
  return !env.isDev || env.optIn === '1'
}

/** A failure here must never stop the app from opening. */
export async function startLegacyChatRemoval(deps: {
  run: () => Promise<LegacyChatRemovalResult>
  warn?: (message: string) => void
}): Promise<void> {
  try {
    const result = await deps.run()
    for (const message of result.warnings) deps.warn?.(message)
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
    // "Removed" is only true once the run finished; before that the keys are
    // still on disk waiting for the next launch.
    if (typeof deps.readSetting(MARKER_KEY) !== 'string') return null
    const snapshotDir = deps.readSetting(SNAPSHOT_KEY)
    if (typeof snapshotDir !== 'string' || !snapshotDir) return null
    if (deps.readSetting(DISMISSED_KEY)) return null
    return { snapshotDir }
  })
  ipcMain.handle('legacy-chat:dismiss', () => {
    deps.writeSetting(DISMISSED_KEY, deps.now().toISOString())
  })
}
