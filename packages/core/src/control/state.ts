/**
 * What the phone shows about the PC, from the last heartbeat, the ESP32's last
 * (signed) report and the last power command the Worker accepted. Pure: the
 * caller passes `now`.
 */
import type { PcStatus } from './messages'

export type PcState = 'ready' | 'rc-down' | 'waiting-sagyou' | 'booting' | 'shutting-down' | 'off'

/** Without a heartbeat (or an ESP32 poll) for this long, it counts as gone. */
export const ALIVE_MS = 2 * 60_000
/** A wake command keeps the PC "booting" for this long without a ping. */
export const BOOTING_MS = 5 * 60_000

export interface PowerView {
  pcPing: boolean
  /** When the ESP32 made this report. */
  at: number
  lastPoll: number
  /** The report's HMAC matched the ESP32 key; an unverified report is ignored. */
  verified: boolean
}

export interface PcStateInput {
  now: number
  status: PcStatus | null
  power: PowerView | null
  lastCommand: { cmd: string; at: number } | null
}

export interface PcView {
  state: PcState
  esp32Offline: boolean
  /** Remote Control servers that are down, in the configured order. */
  missing: string[]
}

export function pcState(input: PcStateInput): PcView {
  const { now, status, power, lastCommand } = input
  const esp32Offline = !power || !power.verified || now - power.lastPoll >= ALIVE_MS
  const alive = status !== null && now - status.at < ALIVE_MS
  if (alive) {
    const missing = status.servers.filter((s) => !s.up).map((s) => s.name)
    if (status.shutdownAt !== null && status.shutdownAt > now) {
      return { state: 'shutting-down', esp32Offline, missing }
    }
    return { state: missing.length ? 'rc-down' : 'ready', esp32Offline, missing }
  }
  const ping = !esp32Offline && power !== null && power.pcPing && now - power.at < ALIVE_MS
  if (ping) return { state: 'waiting-sagyou', esp32Offline, missing: [] }
  if (lastCommand && lastCommand.cmd === 'wake' && now - lastCommand.at < BOOTING_MS) {
    return { state: 'booting', esp32Offline, missing: [] }
  }
  return { state: 'off', esp32Offline, missing: [] }
}
