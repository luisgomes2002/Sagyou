import { describe, it, expect } from 'vitest'
import { formatDuration } from '../../utils/time'

describe('formatDuration', () => {
  it('returns "0s" for zero', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('returns "0s" for negative values', () => {
    expect(formatDuration(-5)).toBe('0s')
  })

  it('formats pure seconds', () => {
    expect(formatDuration(1)).toBe('1s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(59)).toBe('59s')
  })

  it('formats minutes without seconds', () => {
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(3599)).toBe('59m')
  })

  it('formats hours without minutes when minutes are zero', () => {
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(7200)).toBe('2h')
  })

  it('formats hours with minutes when minutes are non-zero', () => {
    expect(formatDuration(3660)).toBe('1h 1m')
    expect(formatDuration(5400)).toBe('1h 30m')
    expect(formatDuration(7320)).toBe('2h 2m')
  })

  it('ignores sub-minute seconds when hours are present', () => {
    expect(formatDuration(3601)).toBe('1h')   // 1h 0m 1s
    expect(formatDuration(3661)).toBe('1h 1m') // 1h 1m 1s
  })
})
