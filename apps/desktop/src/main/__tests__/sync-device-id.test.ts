// @vitest-environment node
//
// The device id lives in its own file, outside SQLite (persistAll empties
// `settings` on every first save) and outside every backup (a restore on another
// machine must not clone this device's identity).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadOrCreateDeviceId,
  SYNC_DEVICE_FILE,
  SYNC_DEVICE_FILE_DEV
} from '../modules/sync/device-id'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-sync-device-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadOrCreateDeviceId', () => {
  it('creates the file on first use and reports it as new', () => {
    const onNew = vi.fn()
    const id = loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE, onNew)

    expect(id).toMatch(/^[0-9a-f]{32}$/)
    const stored = JSON.parse(readFileSync(join(dir, SYNC_DEVICE_FILE), 'utf-8'))
    expect(stored.deviceId).toBe(id)
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false)
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNew).toHaveBeenCalledWith('missing')
  })

  it('returns the same id afterwards without reporting anything', () => {
    const first = loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE)
    const onNew = vi.fn()
    expect(loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE, onNew)).toBe(first)
    expect(onNew).not.toHaveBeenCalled()
  })

  it('replaces an unreadable file and reports it as corrupt', () => {
    writeFileSync(join(dir, SYNC_DEVICE_FILE), '{nope', 'utf-8')
    const onNew = vi.fn()
    const id = loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE, onNew)

    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.parse(readFileSync(join(dir, SYNC_DEVICE_FILE), 'utf-8')).deviceId).toBe(id)
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNew).toHaveBeenCalledWith('corrupt')
  })

  it('replaces an id in the wrong format and reports it as corrupt', () => {
    writeFileSync(join(dir, SYNC_DEVICE_FILE), JSON.stringify({ deviceId: '../x' }), 'utf-8')
    const onNew = vi.fn()
    const id = loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE, onNew)

    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(onNew).toHaveBeenCalledWith('corrupt')
  })

  it('leaves no temporary file behind', () => {
    loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE)
    expect(existsSync(join(dir, `${SYNC_DEVICE_FILE}.tmp`))).toBe(false)
  })

  it('keeps development and production identities apart', () => {
    expect(loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE_DEV)).not.toBe(
      loadOrCreateDeviceId(dir, SYNC_DEVICE_FILE)
    )
  })
})
