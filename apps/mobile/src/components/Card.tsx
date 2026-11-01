import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

/** A solid surface with a neutral border; pressable when given onPress. */
export function Card({
  children,
  onPress,
  a11yLabel
}: {
  children: ReactNode
  onPress?: () => void
  a11yLabel?: string
}): React.JSX.Element {
  const theme = useTheme()
  const base = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]
  if (!onPress) return <View style={base}>{children}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={({ pressed }) => [
        ...base,
        styles.pressable,
        pressed && { backgroundColor: theme.selected }
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.card, padding: SPACE.lg, gap: SPACE.sm },
  pressable: { minHeight: MIN_TOUCH }
})
