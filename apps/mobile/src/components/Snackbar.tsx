import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

/** A one-line notice at the bottom, with an optional action ("Desfazer"). */
export function Snackbar({
  visible,
  message,
  actionLabel,
  onAction
}: {
  visible: boolean
  message: string | null
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element | null {
  const theme = useTheme()
  if (!visible || !message) return null
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: theme.selected, borderColor: theme.border }]}
    >
      <Text style={[styles.text, { color: theme.text }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.action}
        >
          <Text style={[styles.actionText, { color: theme.purple }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.control,
    paddingLeft: SPACE.lg,
    paddingRight: SPACE.xs,
    minHeight: MIN_TOUCH,
    elevation: 6
  },
  text: { flex: 1, fontSize: FONT.body, paddingVertical: SPACE.md },
  action: { minHeight: MIN_TOUCH, paddingHorizontal: SPACE.md, justifyContent: 'center' },
  actionText: { fontSize: FONT.body, fontWeight: '600' }
})
