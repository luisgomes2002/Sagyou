import { rmSync } from 'fs'
import { resolve, sep } from 'path'
import { SYNC_DEVICE_FILE, SYNC_DEVICE_FILE_DEV } from './device-id'
import { SYNC_CONFIG_FILE, SYNC_CONFIG_FILE_DEV } from './sync-config'
import { MCP_EXTERNAL_FILE, MCP_EXTERNAL_FILE_DEV } from '../agent/mcp-external'

/** What a remote wipe deletes, relative to userData. ai-config.json holds no data and stays. */
export function wipeTargets(dev: boolean): string[] {
  if (dev) {
    // Development shares userData with the installed app: only the files with
    // a dev name are its own. files/, backups/ and the rest belong to the app.
    return [
      'kanban-dev.db',
      'kanban-dev.db-wal',
      'kanban-dev.db-shm',
      // A lost PC must not keep a valid external MCP token.
      MCP_EXTERNAL_FILE_DEV,
      SYNC_CONFIG_FILE_DEV,
      SYNC_DEVICE_FILE_DEV
    ]
  }
  return [
    'kanban.db',
    'kanban.db-wal',
    'kanban.db-shm',
    'files',
    'task-images',
    'backups',
    'agent-runs',
    MCP_EXTERNAL_FILE,
    SYNC_CONFIG_FILE,
    SYNC_DEVICE_FILE
  ]
}

/**
 * Delete this device's data after a revoke with wipe. No backup first, by
 * decision: the data stays in the cloud and on the other devices. Every path
 * is checked to sit inside userData before it is removed. The sync config and
 * device files go last, and only when everything before them went: a partial
 * wipe keeps the revoked token, so the next launch gets the 401 and finishes it.
 */
export function wipeLocalData(
  userDataDir: string,
  dev: boolean,
  remove: (path: string) => void = (path) => rmSync(path, { recursive: true, force: true })
): { removed: string[]; failed: number } {
  const root = resolve(userDataDir)
  const identity = new Set<string>([
    dev ? SYNC_CONFIG_FILE_DEV : SYNC_CONFIG_FILE,
    dev ? SYNC_DEVICE_FILE_DEV : SYNC_DEVICE_FILE
  ])
  const targets = wipeTargets(dev)
  const ordered = [
    ...targets.filter((name) => !identity.has(name)),
    ...targets.filter((name) => identity.has(name))
  ]
  const removed: string[] = []
  let failed = 0
  for (const name of ordered) {
    if (failed && identity.has(name)) break
    const path = resolve(root, name)
    if (!path.startsWith(root + sep)) continue
    try {
      remove(path)
      removed.push(path)
    } catch {
      failed += 1
    }
  }
  return { removed, failed }
}
