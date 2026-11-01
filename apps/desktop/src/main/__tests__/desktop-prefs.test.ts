// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  defaultDesktopPrefs,
  desktopPrefsFileName,
  loadDesktopPrefs,
  saveDesktopPrefs
} from '../modules/desktop/desktop-prefs'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-prefs-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (value: string): void =>
  writeFileSync(join(dir, 'desktop-prefs.json'), value, 'utf-8')

describe('desktop prefs', () => {
  it('names the file per build', () => {
    expect(desktopPrefsFileName(false)).toBe('desktop-prefs.json')
    expect(desktopPrefsFileName(true)).toBe('desktop-prefs-dev.json')
  })

  it('defaults to hiding on close only on Windows', () => {
    expect(defaultDesktopPrefs('win32')).toEqual({
      closeToTray: true,
      idleLockMinutes: 15,
      lockOnSystemLock: true,
      trayNoticeShown: false
    })
    expect(defaultDesktopPrefs('linux').closeToTray).toBe(false)
    expect(defaultDesktopPrefs('darwin').closeToTray).toBe(false)
  })

  it('reads a missing or broken file as the defaults', () => {
    expect(loadDesktopPrefs(dir, false, 'win32')).toEqual(defaultDesktopPrefs('win32'))
    write('{ not json')
    expect(loadDesktopPrefs(dir, false, 'linux')).toEqual(defaultDesktopPrefs('linux'))
    write('[1,2]')
    expect(loadDesktopPrefs(dir, false, 'win32')).toEqual(defaultDesktopPrefs('win32'))
  })

  it('replaces unexpected values with the default and drops unknown keys', () => {
    write(JSON.stringify({ idleLockMinutes: 7, closeToTray: 'sim', foo: 1, lockOnSystemLock: false }))
    const prefs = loadDesktopPrefs(dir, false, 'win32')
    expect(prefs).toEqual({
      closeToTray: true,
      idleLockMinutes: 15,
      lockOnSystemLock: false,
      trayNoticeShown: false
    })
    expect(prefs).not.toHaveProperty('foo')
  })

  it('merges a patch, keeps the other fields and leaves no temp file', () => {
    saveDesktopPrefs(dir, false, 'win32', { closeToTray: false, trayNoticeShown: true })
    const saved = saveDesktopPrefs(dir, false, 'win32', { idleLockMinutes: 5 })
    expect(saved).toEqual({
      closeToTray: false,
      idleLockMinutes: 5,
      lockOnSystemLock: true,
      trayNoticeShown: true
    })
    expect(JSON.parse(readFileSync(join(dir, 'desktop-prefs.json'), 'utf-8'))).toEqual(saved)
    expect(readdirSync(dir)).toEqual(['desktop-prefs.json'])
  })

  it('writes the dev file in dev', () => {
    saveDesktopPrefs(dir, true, 'linux', { idleLockMinutes: 30 })
    expect(existsSync(join(dir, 'desktop-prefs-dev.json'))).toBe(true)
    expect(existsSync(join(dir, 'desktop-prefs.json'))).toBe(false)
  })
})
