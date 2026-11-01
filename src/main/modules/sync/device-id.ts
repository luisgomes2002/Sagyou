import { randomBytes } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export const SYNC_DEVICE_FILE = 'sync-device.json'
export const SYNC_DEVICE_FILE_DEV = 'sync-device-dev.json'

const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/

/**
 * This installation's sync identity.
 *
 * It must NOT live in SQLite: persistAll() empties the `settings` table on the
 * first save of every session. It must not ride a backup either, or restoring
 * one on another machine would give two devices the same identity. A file of its
 * own in userData stays outside both. Development uses a separate file, like the
 * database, so test data never passes as the real device.
 */
export function loadOrCreateDeviceId(
  userDataDir: string,
  fileName: string,
  onNew?: (reason: 'missing' | 'corrupt') => void
): string {
  const path = join(userDataDir, fileName)
  const exists = existsSync(path)
  if (exists) {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      const deviceId = (value as { deviceId?: unknown } | null)?.deviceId
      if (typeof deviceId === 'string' && DEVICE_ID_PATTERN.test(deviceId)) return deviceId
    } catch {
      // Unreadable: replaced below.
    }
  }

  const deviceId = randomBytes(16).toString('hex')
  const tmp = `${path}.tmp`
  writeFileSync(
    tmp,
    JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2),
    'utf-8'
  )
  renameSync(tmp, path)
  onNew?.(exists ? 'corrupt' : 'missing')
  return deviceId
}
