import { useEffect } from 'react'
import { AppState, Linking, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { RecordRepo } from '../data/records'
import { useApp } from '../store/app'
import { bannerUpdate, useUpdate, type UpdateDeps } from '../store/update'
import { useTheme } from '../theme'
import { installedVersion } from '../update/installed'
import { useStatusBannerText } from './StatusBanner'
import { Button } from './ui'

export const DOWNLOAD_LABEL = 'Baixar'
export const DISMISS_LABEL = 'Agora não'
export const availableText = (version: string): string => `Versão ${version} disponível`

/** The real effects of a check: global fetch, the clock and the APK's own version. */
export function updateDeps(repo: Pick<RecordRepo, 'readPref' | 'writePref'>): UpdateDeps {
  return {
    repo,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    installed: installedVersion()
  }
}

/** Opening the APK: the browser downloads it and Android asks to install it over this one. */
export function openDownload(url: string): void {
  Linking.openURL(url).catch(() => undefined)
}

/** Checks on mount and whenever the app comes back to the foreground (at most every 24 h). */
export function useAutoUpdateCheck(): void {
  const repo = useApp((s) => s.services?.repo)
  useEffect(() => {
    if (!repo) return
    const check = (): void => {
      void useUpdate.getState().autoCheck(updateDeps(repo))
    }
    check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    return () => sub.remove()
  }, [repo])
}

export function UpdateBanner(): React.JSX.Element | null {
  useAutoUpdateCheck()
  const theme = useTheme()
  const repo = useApp((s) => s.services?.repo)
  const available = useUpdate((s) => s.available)
  const dismissed = useUpdate((s) => s.dismissed)
  // The status banner above already takes the status-bar inset when it shows.
  const statusShown = useStatusBannerText() !== null
  const update = bannerUpdate({ available, dismissed }, installedVersion())
  if (!update) return null
  const style = [styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]
  const content = (
    <>
      <Text accessibilityRole="header" style={[styles.text, { color: theme.text }]}>
        {availableText(update.version)}
      </Text>
      <View style={styles.actions}>
        <Button
          primary
          label={DOWNLOAD_LABEL}
          a11yLabel={`Baixar a versão ${update.version}`}
          onPress={() => openDownload(update.url)}
        />
        <Button
          label={DISMISS_LABEL}
          onPress={() => {
            if (repo) useUpdate.getState().dismiss(updateDeps(repo))
          }}
        />
      </View>
    </>
  )
  return statusShown ? (
    <View style={style}>{content}</View>
  ) : (
    <SafeAreaView edges={['top']} style={style}>
      {content}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, gap: 8 },
  text: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 }
})
