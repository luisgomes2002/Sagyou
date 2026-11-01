import { StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useApp, useStatusBannerText } from '../store/app'
import { useTheme } from '../theme'

/**
 * One line at the top: read-only after a revoke, or offline with changes
 * waiting. It takes the status-bar inset only while it shows, so there is no
 * empty band above the header the rest of the time.
 */
export function StatusBanner(): React.JSX.Element | null {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const text = useStatusBannerText()
  if (!text) return null
  return (
    <SafeAreaView
      edges={['top']}
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={{ color: readOnly ? theme.attention : theme.muted }}>{text}</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 }
})
