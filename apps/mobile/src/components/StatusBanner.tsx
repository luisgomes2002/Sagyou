import { StyleSheet, Text, View } from 'react-native'
import { DISCONNECTED_TEXT, OFFLINE_TEXT, useApp } from '../store/app'
import { useTheme } from '../theme'

/** One line at the top: read-only after a revoke, or offline with changes waiting. */
export function StatusBanner(): React.JSX.Element | null {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const status = useApp((s) => s.status)
  const text = readOnly
    ? DISCONNECTED_TEXT
    : status?.state === 'offline' && status.pendingCount > 0
      ? OFFLINE_TEXT
      : null
  if (!text) return null
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={{ color: readOnly ? theme.attention : theme.muted }}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 }
})
