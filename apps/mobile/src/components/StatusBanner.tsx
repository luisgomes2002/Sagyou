import { StyleSheet, Text, View } from 'react-native'
import { DISCONNECTED_TEXT, OFFLINE_TEXT, useApp } from '../store/app'
import { FONT, SPACE, useTheme } from '../theme'
import { ACTION_ICONS } from './icons'

/**
 * One quiet line under the header: read-only after a revoke, or offline with
 * changes waiting. Nothing at all the rest of the time, so the content does not jump.
 */
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
  const Icon = readOnly ? ACTION_ICONS.readOnly : ACTION_ICONS.offline
  const color = readOnly ? theme.attention : theme.muted
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Icon size={16} color={color} />
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1
  },
  text: { flex: 1, fontSize: FONT.caption }
})
