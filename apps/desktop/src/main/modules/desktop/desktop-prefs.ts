import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export const IDLE_LOCK_OPTIONS = [0, 5, 15, 30, 60] as const
export type IdleLockMinutes = (typeof IDLE_LOCK_OPTIONS)[number]

/**
 * Preferences of this machine only: the tray, the automatic lock and the
 * one-time tray notice. Outside SQLite (persistAll empties `settings` on a
 * session's first save) and outside every backup and sync.
 */
export interface DesktopPrefs {
  closeToTray: boolean
  /** 0 = never. */
  idleLockMinutes: IdleLockMinutes
  lockOnSystemLock: boolean
  trayNoticeShown: boolean
}

export function desktopPrefsFileName(isDev: boolean): string {
  return isDev ? 'desktop-prefs-dev.json' : 'desktop-prefs.json'
}

/** Linux and macOS keep the old close: many Linux desktops show no tray icon. */
export function defaultDesktopPrefs(platform: NodeJS.Platform): DesktopPrefs {
  return {
    closeToTray: platform === 'win32',
    idleLockMinutes: 15,
    lockOnSystemLock: true,
    trayNoticeShown: false
  }
}

export function normalizeDesktopPrefs(raw: unknown, platform: NodeJS.Platform): DesktopPrefs {
  const defaults = defaultDesktopPrefs(platform)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const value = raw as Record<string, unknown>
  const bool = (key: keyof DesktopPrefs): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : (defaults[key] as boolean)
  return {
    closeToTray: bool('closeToTray'),
    idleLockMinutes: IDLE_LOCK_OPTIONS.includes(value.idleLockMinutes as IdleLockMinutes)
      ? (value.idleLockMinutes as IdleLockMinutes)
      : defaults.idleLockMinutes,
    lockOnSystemLock: bool('lockOnSystemLock'),
    trayNoticeShown: bool('trayNoticeShown')
  }
}

export function loadDesktopPrefs(
  dir: string,
  isDev: boolean,
  platform: NodeJS.Platform
): DesktopPrefs {
  const path = join(dir, desktopPrefsFileName(isDev))
  if (!existsSync(path)) return defaultDesktopPrefs(platform)
  try {
    return normalizeDesktopPrefs(JSON.parse(readFileSync(path, 'utf-8')), platform)
  } catch {
    return defaultDesktopPrefs(platform)
  }
}

/** Reads, merges, normalizes and writes atomically; returns what was stored. */
export function saveDesktopPrefs(
  dir: string,
  isDev: boolean,
  platform: NodeJS.Platform,
  patch: Partial<DesktopPrefs>
): DesktopPrefs {
  const next = normalizeDesktopPrefs(
    { ...loadDesktopPrefs(dir, isDev, platform), ...patch },
    platform
  )
  mkdirSync(dir, { recursive: true })
  const path = join(dir, desktopPrefsFileName(isDev))
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmp, path)
  return next
}
