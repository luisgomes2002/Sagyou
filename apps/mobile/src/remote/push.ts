/**
 * Push notifications of the remote control (spec controle-remoto-app): the
 * Worker sends "PC ligado, Sagyou pronto", approval cards and failures
 * through FCM with `data.open = 'pc'`. The notification text is generic; the
 * content stays in the encrypted inbox and is read when the PC tab opens.
 *
 * Effects are injected so the rules run in Jest without the native module.
 */
import type { AuthorizationState } from './keys'

/** The part of expo-notifications this module uses. */
export interface NotificationsApi {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>
  requestPermissionsAsync(): Promise<{ granted: boolean }>
  getDevicePushTokenAsync(): Promise<{ type: string; data: unknown }>
}

export interface PushDeps {
  notifications: NotificationsApi
  putPushToken(token: string): Promise<void>
}

export type PushOutcome = 'registered' | 'not-authorized' | 'denied' | 'failed'

/**
 * Asks for permission and hands the FCM token to the Worker, only on a phone
 * the PC authorized. Never throws: without permission, Firebase or network,
 * the app works the same and only the notifications are missing.
 */
export async function registerPush(
  deps: PushDeps,
  authorized: AuthorizationState
): Promise<PushOutcome> {
  if (authorized !== 'yes') return 'not-authorized'
  try {
    const current = await deps.notifications.getPermissionsAsync()
    const granted = current.granted || (await deps.notifications.requestPermissionsAsync()).granted
    if (!granted) return 'denied'
    const token = await deps.notifications.getDevicePushTokenAsync()
    if (typeof token.data !== 'string' || token.data.length === 0) return 'failed'
    await deps.putPushToken(token.data)
    return 'registered'
  } catch {
    return 'failed'
  }
}

/** Where a tapped notification leads: 'pc' for the PC tab, null for nothing. */
export function notificationTarget(response: unknown): 'pc' | null {
  const data = (
    response as { notification?: { request?: { content?: { data?: unknown } } } } | null
  )?.notification?.request?.content?.data
  return data && typeof data === 'object' && (data as { open?: unknown }).open === 'pc'
    ? 'pc'
    : null
}

/**
 * notificationTarget, but each notification only once: the last tap stays in
 * getLastNotificationResponseAsync and comes back on every mount of the bridge
 * (pairing again, leaving read-only), which would reopen the PC tab by itself.
 */
export function createResponseGate(): (response: unknown) => 'pc' | null {
  let last: string | null = null
  return (response) => {
    const target = notificationTarget(response)
    if (!target) return null
    const id = (response as { notification?: { request?: { identifier?: unknown } } })
      .notification?.request?.identifier
    if (typeof id === 'string') {
      if (id === last) return null
      last = id
    }
    return target
  }
}
