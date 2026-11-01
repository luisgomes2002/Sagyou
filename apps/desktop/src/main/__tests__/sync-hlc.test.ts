// @vitest-environment node
//
// Sync versions are ordered by a hybrid logical clock: wall-clock ms plus a
// counter, so a version minted after another always compares greater even when
// the system clock moved backwards or two edits land in the same millisecond.
import { describe, expect, it } from 'vitest'
import { nextHlc, parseHlc } from '../modules/sync/hlc'

describe('nextHlc', () => {
  it('starts from the wall clock with a zero counter', () => {
    expect(nextHlc(1000, null, 'a')).toBe('000000000001000-0000-a')
  })

  it('bumps the counter within the same millisecond', () => {
    const last = nextHlc(1000, null, 'a')
    expect(nextHlc(1000, last, 'a')).toBe('000000000001000-0001-a')
  })

  it('stays ahead of the last version when the clock goes backwards', () => {
    expect(nextHlc(500, '000000000001000-0003-a', 'a')).toBe('000000000001000-0004-a')
  })

  it('carries a full counter into the next millisecond', () => {
    expect(nextHlc(1000, '000000000001000-ffff-a', 'a')).toBe('000000000001001-0000-a')
  })

  it('stays ahead of a version minted by another device', () => {
    expect(nextHlc(1000, '000000000002000-0005-b', 'a')).toBe('000000000002000-0006-a')
  })

  it('treats an unreadable last version as absent', () => {
    expect(parseHlc('lixo')).toBeNull()
    expect(nextHlc(1000, 'lixo', 'a')).toBe('000000000001000-0000-a')
  })

  it('parses its own output', () => {
    expect(parseHlc('000000000001000-00ff-abc')).toEqual({
      ms: 1000,
      counter: 255,
      deviceId: 'abc'
    })
  })

  it('produces a strictly increasing sequence whatever the clock does', () => {
    let last: string | null = null
    for (let i = 0; i < 1000; i++) {
      const now = Math.floor(Math.random() * 5000)
      const next = nextHlc(now, last, 'a')
      if (last !== null) expect(next > last).toBe(true)
      last = next
    }
  })
})
