// "PC sem sinal" (spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): a PC that
// dies cannot say so, and the Worker cannot open the sealed heartbeat. So the PC says in clear,
// with every heartbeat, whether it is expected to keep answering (`watch`); a scheduled job
// warns the phones once when it should be answering and the last heartbeat is old.
import type { ControlDb } from './control-db'
import type { NotifyCode } from './control-routes'

/** No heartbeat for this long while `watch` is on counts as silence. */
export const SILENT_MS = 10 * 60_000
/** A forced shutdown through the ESP32 is no surprise: it was asked this close to the last heartbeat. */
const FORCED_SHUTDOWN_GRACE_MS = 60_000

export type WatchdogResult = 'sent' | 'none'

/** Never throws: a failing push or an old D1 simply warns nobody. */
export async function runWatchdog(
  control: ControlDb,
  notify: (deviceIds: string[], code: NotifyCode) => Promise<void>,
  now: number
): Promise<WatchdogResult> {
  try {
    const watch = await control.getWatch()
    if (!watch || !watch.watch || watch.notifiedAt !== null) return 'none'
    const status = await control.getStatus()
    if (!status || status.at >= now - SILENT_MS) return 'none'
    const { pc, controllers } = await control.getRoles()
    // Another device became the PC since: that heartbeat is not the PC's anymore.
    if (!pc || status.from !== pc || controllers.length === 0) return 'none'
    const command = await control.lastPowerCommand()
    if (
      command?.cmd === 'shutdown' &&
      command.at >= status.at - FORCED_SHUTDOWN_GRACE_MS
    ) {
      return 'none'
    }
    await control.markSilentNotified(now)
    await notify(controllers, 'pc-silent')
    return 'sent'
  } catch {
    return 'none'
  }
}
