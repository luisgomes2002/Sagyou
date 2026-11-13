/**
 * Push notifications of the remote control (spec controle-remoto-app and
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): the Worker sends fixed texts
 * through FCM with `data.open = 'pc'` and `data.code` (what happened). The notification text is
 * generic; the content stays in the encrypted inbox and is read when the PC tab opens.
 *
 * Effects are injected so the rules run in Jest without the native module.
 */
import {
  NOTIFY_CATEGORY_LABEL,
  isNotifyCode,
  notifyTarget,
  type NotifyCategory,
  type NotifyCode
} from '@sagyou/core/control/notify'
import { HISTORY_TEXT_MAX, type HistoryEntry } from '../notifications/history'
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

/** The Android channels (one per category) the Worker's pushes go to. */
export const CHANNELS: { id: NotifyCategory; name: string }[] = (
  ['pc', 'sessions', 'security'] as const
).map((id) => ({ id, name: NOTIFY_CATEGORY_LABEL[id] }))

export interface ChannelsApi {
  setNotificationChannelAsync(id: string, channel: Record<string, unknown>): Promise<unknown>
}

/**
 * Creates the three channels; the user mutes each one in the Android settings. Never throws: a
 * push on a missing channel just uses the default one.
 */
export async function registerChannels(
  api: ChannelsApi,
  importance: { HIGH: number; MAX: number }
): Promise<void> {
  for (const channel of CHANNELS) {
    try {
      await api.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.id === 'security' ? importance.MAX : importance.HIGH
      })
    } catch {
      // See above.
    }
  }
}

type Notification = {
  date?: unknown
  request?: { identifier?: unknown; content?: { body?: unknown; data?: unknown } }
}

const dataOf = (notification: unknown): Record<string, unknown> | null => {
  const data = (notification as Notification | null)?.request?.content?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** What happened, from `data.code`; null for an older Worker or an unknown code. */
export function pushCode(notification: unknown): NotifyCode | null {
  const code = dataOf(notification)?.code
  return isNotifyCode(code) ? code : null
}

/** An arrival time in ms; expo gives seconds on some versions. Null when it makes no sense. */
function arrivalTime(date: unknown): number | null {
  if (typeof date !== 'number' || !Number.isFinite(date) || date <= 0) return null
  return date < 1e12 ? date * 1000 : date
}

/**
 * The history entry of a notification (the id is the Android notification identifier). Only the
 * code and the time are kept; a push without a known code keeps its own generic body.
 */
export function entryFromNotification(notification: unknown, now: number): HistoryEntry | null {
  const n = notification as Notification | null
  const id = n?.request?.identifier
  if (typeof id !== 'string' || id === '') return null
  const at = arrivalTime(n?.date) ?? now
  const code = pushCode(notification)
  if (code) return { id, code, at, read: false }
  const body = n?.request?.content?.body
  const entry: HistoryEntry = { id, code: 'unknown', at, read: false }
  if (typeof body === 'string' && body !== '') entry.text = body.slice(0, HISTORY_TEXT_MAX)
  return entry
}

export interface Tap {
  target: 'pc' | 'notifications'
  code: NotifyCode | null
}

/**
 * Where a tapped notification leads: an approval to the Notificações screen, everything else
 * with `open: 'pc'` (an older Worker included) to the PC tab; null for nothing.
 */
export function notificationTap(response: unknown): Tap | null {
  const notification = (response as { notification?: unknown } | null)?.notification
  const code = pushCode(notification)
  if (code) return { target: notifyTarget(code), code }
  return dataOf(notification)?.open === 'pc' ? { target: 'pc', code: null } : null
}

/**
 * notificationTap, but each notification only once: the last tap stays in
 * getLastNotificationResponseAsync and comes back on every mount of the bridge
 * (pairing again, leaving read-only), which would reopen the screen by itself.
 */
export function createResponseGate(): (response: unknown) => Tap | null {
  let last: string | null = null
  return (response) => {
    const tap = notificationTap(response)
    if (!tap) return null
    const id = (response as { notification?: { request?: { identifier?: unknown } } })
      .notification?.request?.identifier
    if (typeof id === 'string') {
      if (id === last) return null
      last = id
    }
    return tap
  }
}
