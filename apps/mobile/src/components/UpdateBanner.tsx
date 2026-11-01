import { useEffect } from 'react'
import { AppState, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useApp, useStatusBannerText } from '../store/app'
import { bannerUpdate, useUpdate } from '../store/update'
import { useTheme } from '../theme'
import {
  availableText,
  DISMISS_LABEL,
  DOWNLOAD_LABEL,
  openDownload,
  updateDeps
} from '../update/actions'
import { installedVersion } from '../update/installed'
import { Button } from './ui'

/** Checks on mount and whenever the app comes back to the foreground (at most every 24 h). */
function useAutoUpdateCheck(): void {
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
      <Text style={[styles.text, { color: theme.text }]}>{availableText(update.version)}</Text>
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
    <View accessibilityLiveRegion="polite" style={style}>
      {content}
    </View>
  ) : (
    <SafeAreaView edges={['top']} accessibilityLiveRegion="polite" style={style}>
      {content}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, gap: 8 },
  text: { fontWeight: '600' },
  // Wraps with a large system font instead of pushing "Agora não" off screen.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
})
