/**
 * Hybrid logical clock for sync versions.
 *
 * A version is `<ms, 15 decimal digits>-<counter, 4 hex digits>-<deviceId>`, so
 * plain string comparison orders it. Each new version is greater than the last
 * one seen, even when the system clock went backwards or another device's clock
 * runs ahead: the counter carries the order until the wall clock catches up.
 */

const MS_DIGITS = 15
const COUNTER_DIGITS = 4
const MAX_COUNTER = 0xffff
const HLC_PATTERN = /^(\d{15})-([0-9a-f]{4})-(.+)$/

export function parseHlc(hlc: string): { ms: number; counter: number; deviceId: string } | null {
  const match = HLC_PATTERN.exec(hlc)
  if (!match) return null
  return { ms: Number(match[1]), counter: parseInt(match[2], 16), deviceId: match[3] }
}

function formatHlc(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(MS_DIGITS, '0')}-${counter.toString(16).padStart(COUNTER_DIGITS, '0')}-${deviceId}`
}

export function nextHlc(nowMs: number, last: string | null, deviceId: string): string {
  const previous = last === null ? null : parseHlc(last)
  if (!previous || nowMs > previous.ms) return formatHlc(nowMs, 0, deviceId)
  if (previous.counter < MAX_COUNTER) return formatHlc(previous.ms, previous.counter + 1, deviceId)
  return formatHlc(previous.ms + 1, 0, deviceId)
}
