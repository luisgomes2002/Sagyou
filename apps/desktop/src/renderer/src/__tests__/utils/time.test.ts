import { describe, it, expect } from 'vitest'
import { formatDuration } from '../../utils/time'

describe('formatDuration', () => {
  it('returns "00:00" for zero', () => {
    expect(formatDuration(0)).toBe('00:00')
  })

  it('returns "00:00" for negative values', () => {
    expect(formatDuration(-5)).toBe('00:00')
  })

  it('formats seconds as MM:SS', () => {
    expect(formatDuration(1)).toBe('00:01')
    expect(formatDuration(45)).toBe('00:45')
    expect(formatDuration(59)).toBe('00:59')
  })

  it('formats minutes as MM:SS', () => {
    expect(formatDuration(60)).toBe('01:00')
    expect(formatDuration(120)).toBe('02:00')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('formats hours as H:MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(7200)).toBe('2:00:00')
  })

  it('formats hours with minutes when minutes are non-zero', () => {
    expect(formatDuration(3660)).toBe('1:01:00')
    expect(formatDuration(5400)).toBe('1:30:00')
    expect(formatDuration(7320)).toBe('2:02:00')
  })

  it('includes seconds when hours are present', () => {
    expect(formatDuration(3601)).toBe('1:00:01')
    expect(formatDuration(3661)).toBe('1:01:01')
  })
})
