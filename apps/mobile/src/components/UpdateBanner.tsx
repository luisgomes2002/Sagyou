import { StyleSheet, Text, View } from 'react-native'
import { useApp } from '../store/app'
import { bannerUpdate, useUpdate } from '../store/update'
import { FONT, SPACE, useTheme } from '../theme'
import {
  availableText,
  DISMISS_LABEL,
  DOWNLOAD_LABEL,
  openDownload,
  updateDeps
} from '../update/actions'
import { installedVersion } from '../update/installed'
import { Button } from './Button'

/**
 * A newer published version, under the header next to the status line.
 * Announced politely: it shows up on its own after a background check.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const theme = useTheme()
  const repo = useApp((s) => s.services?.repo)
  const available = useUpdate((s) => s.available)
  const dismissed = useUpdate((s) => s.dismissed)
  const update = bannerUpdate({ available, dismissed }, installedVersion())
  if (!update) return null
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={[styles.text, { color: theme.text }]}>{availableText(update.version)}</Text>
      <View style={styles.actions}>
        <Button
          variant="primary"
          label={DOWNLOAD_LABEL}
          a11yLabel={`Baixar a versão ${update.version}`}
          onPress={() => openDownload(update.url)}
        />
        <Button
          variant="ghost"
          label={DISMISS_LABEL}
          onPress={() => {
            if (repo) useUpdate.getState().dismiss(updateDeps(repo))
          }}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1
  },
  text: { fontSize: FONT.body, fontWeight: '600' },
  // Wraps with a large system font instead of pushing "Agora não" off screen.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }
})
