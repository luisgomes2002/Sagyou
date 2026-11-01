import type { ReactNode } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo
} from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

export interface ListItemProps {
  title: string
  subtitle?: ReactNode
  left?: ReactNode
  right?: ReactNode
  onPress?: () => void
  a11yLabel?: string
  a11yActions?: AccessibilityActionInfo[]
  onA11yAction?: (event: AccessibilityActionEvent) => void
}

/** One row of a list: optional leading marker, title + subtitle, trailing value. */
export function ListItem({
  title,
  subtitle,
  left,
  right,
  onPress,
  a11yLabel,
  a11yActions,
  onA11yAction
}: ListItemProps): React.JSX.Element {
  const theme = useTheme()
  const content = (
    <>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {typeof subtitle === 'string' ? (
          <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>
        ) : (
          subtitle
        )}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  )
  const base = [styles.item, { backgroundColor: theme.surface, borderColor: theme.border }]
  if (!onPress)
    return (
      <View
        accessible={!!a11yActions}
        accessibilityLabel={a11yLabel}
        accessibilityActions={a11yActions}
        onAccessibilityAction={onA11yAction}
        style={base}
      >
        {content}
      </View>
    )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? title}
      accessibilityActions={a11yActions}
      onAccessibilityAction={onA11yAction}
      onPress={onPress}
      style={({ pressed }) => [...base, pressed && { backgroundColor: theme.selected }]}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    minHeight: MIN_TOUCH
  },
  left: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end' },
  title: { fontSize: FONT.bodyLg },
  subtitle: { fontSize: FONT.caption }
})
