import type { NotifyCategory } from '@sagyou/core/control/notify'

/** The part of react-native's Linking this module uses (injected by tests). */
export interface LinkingLike {
  sendIntent(
    action: string,
    extras?: { key: string; value: string | number | boolean }[]
  ): Promise<void>
  openSettings(): Promise<void>
}

/** android.package of app.json (the channel settings screen is asked for by package). */
function appPackage(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../../app.json') as { expo: { android: { package: string } } }).expo.android
    .package
}

/**
 * Opens the Android settings of one notification channel, where the person mutes it (spec
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md). When the system refuses the intent
 * the settings of the whole app open instead. Never throws.
 */
export async function openChannelSettings(
  id: NotifyCategory,
  linking: LinkingLike,
  pkg: string = appPackage()
): Promise<void> {
  try {
    await linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      { key: 'android.provider.extra.CHANNEL_ID', value: id }
    ])
  } catch {
    try {
      await linking.openSettings()
    } catch {
      // Nothing else to try.
    }
  }
}
