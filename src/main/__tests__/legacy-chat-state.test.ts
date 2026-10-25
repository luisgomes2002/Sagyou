// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLegacyChatState } from '../modules/ai/legacy-chat-state'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-legacy-state-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// The migration's marker used to live in the SQLite `settings` table, which
// persistAll() empties on the first save of every session. The state now lives
// in its own file, so nothing the store does can reach it.
describe('createLegacyChatState', () => {
  it('survives a restart: a fresh instance reads what the last one wrote', () => {
    createLegacyChatState(dir).write('legacyChatRemovedAt', '2026-10-24T12:00:00.000Z')

    expect(createLegacyChatState(dir).read('legacyChatRemovedAt')).toBe('2026-10-24T12:00:00.000Z')
  })

  it('keeps other keys when one is written', () => {
    const state = createLegacyChatState(dir)
    state.write('legacyChatSnapshotDir', '/backups/pre-1')
    state.write('legacyChatNoticeDismissedAt', '2026-10-24T13:00:00.000Z')

    expect(state.read('legacyChatSnapshotDir')).toBe('/backups/pre-1')
    expect(state.read('legacyChatNoticeDismissedAt')).toBe('2026-10-24T13:00:00.000Z')
  })

  it('reads null for a key that was never written or when there is no file', () => {
    expect(createLegacyChatState(dir).read('legacyChatRemovedAt')).toBeNull()
  })

  it('does not stay stuck on an unreadable file: it reads as empty and the next write repairs it', () => {
    writeFileSync(join(dir, 'legacy-chat-state.json'), '{ not json')
    const state = createLegacyChatState(dir)

    expect(state.read('legacyChatRemovedAt')).toBeNull()
    state.write('legacyChatRemovedAt', 'ok')
    expect(JSON.parse(readFileSync(join(dir, 'legacy-chat-state.json'), 'utf-8'))).toEqual({
      legacyChatRemovedAt: 'ok'
    })
  })

  it('writes atomically and leaves no temporary file behind', () => {
    createLegacyChatState(dir).write('legacyChatRemovedAt', 'x')

    expect(existsSync(join(dir, 'legacy-chat-state.json'))).toBe(true)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
