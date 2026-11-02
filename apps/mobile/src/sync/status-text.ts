import type { SyncStatus } from '@sagyou/core/sync/engine'
import { pendingText, syncedAgoText } from '@sagyou/core/sync/view'
import { DISCONNECTED_TEXT, OFFLINE_TEXT } from '../store/app'

export function conflictsText(count: number): string {
  return count === 1 ? '1 conflito' : `${count} conflitos`
}

/** The same status lines as the desktop's Sincronização screen. */
export function statusLines(status: SyncStatus | null, readOnly: boolean, now: number): string[] {
  if (readOnly) return [DISCONNECTED_TEXT]
  if (!status) return []
  const lines: string[] = []
  if (status.state === 'offline') lines.push(OFFLINE_TEXT)
  else if (status.state === 'paused') lines.push('Pausado: escolha o que vale')
  else if (status.lastSyncAt) lines.push(syncedAgoText(status.lastSyncAt, now))
  if (status.pendingCount > 0) lines.push(pendingText(status.pendingCount))
  return lines
}
