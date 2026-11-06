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
/** A power command the ESP32 has not fetched after this long went unanswered. */
export const POWER_COMMAND_TTL_MS = 2 * 60_000
/** After fetching `shutdown`, the ESP32 waits this long before forcing it (abort cancels). */
export const FORCED_SHUTDOWN_MS = 60_000

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
  /** `takenAt`: when the ESP32 fetched it; null = not fetched yet. */
  lastCommand: { cmd: string; at: number; takenAt: number | null } | null
}

export interface PcView {
  state: PcState
  esp32Offline: boolean
  /** Remote Control servers that are down, in the configured order. */
  missing: string[]
  /** The last command was never fetched by the ESP32 within its 2 min and the PC is not up. */
  esp32NoAnswer: boolean
  /**
   * End of the window in which the ESP32 is about to force a `shutdown` it
   * fetched (the phone can still send `abort-shutdown`); null outside it.
   */
  forcedShutdownUntil: number | null
}

export function pcState(input: PcStateInput): PcView {
  const { now, status, lastCommand } = input
  const alive = status !== null && now - status.at < ALIVE_MS
  const state = baseState(input, alive)
  const esp32NoAnswer =
    lastCommand !== null &&
    lastCommand.takenAt === null &&
    now - lastCommand.at >= POWER_COMMAND_TTL_MS &&
    state.state !== 'ready' &&
    state.state !== 'rc-down' &&
    state.state !== 'shutting-down'
  const forcedShutdownUntil =
    !alive &&
    lastCommand !== null &&
    lastCommand.cmd === 'shutdown' &&
    lastCommand.takenAt !== null &&
    now < lastCommand.takenAt + FORCED_SHUTDOWN_MS
      ? lastCommand.takenAt + FORCED_SHUTDOWN_MS
      : null
  return { ...state, esp32NoAnswer, forcedShutdownUntil }
}

function baseState(
  input: PcStateInput,
  alive: boolean
): Pick<PcView, 'state' | 'esp32Offline' | 'missing'> {
  const { now, status, power, lastCommand } = input
  // A stale report re-sent with a fresh poll is not contact either.
  const esp32Offline =
    !power ||
    !power.verified ||
    now - power.lastPoll >= ALIVE_MS ||
    now - power.at >= ALIVE_MS
  if (alive && status) {
    const missing = status.servers.filter((s) => !s.up).map((s) => s.name)
    if (status.shutdownAt !== null && status.shutdownAt > now) {
      return { state: 'shutting-down', esp32Offline, missing }
    }
    return { state: missing.length ? 'rc-down' : 'ready', esp32Offline, missing }
  }
  const ping = !esp32Offline && power !== null && power.pcPing
  if (ping) return { state: 'waiting-sagyou', esp32Offline, missing: [] }
  if (lastCommand && lastCommand.cmd === 'wake' && now - lastCommand.at < BOOTING_MS) {
    return { state: 'booting', esp32Offline, missing: [] }
  }
  return { state: 'off', esp32Offline, missing: [] }
}
