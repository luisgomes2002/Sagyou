import { Plus } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'
import { RADIUS, useTheme } from '../theme'

const SIZE = 56

/** The floating (+): the screen's one primary action, solid purple. */
export function Fab({
  onPress,
  disabled,
  a11yLabel
}: {
  onPress: () => void
  disabled?: boolean
  a11yLabel: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: theme.primary, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }
      ]}
    >
      <Plus size={26} color={theme.onPrimary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fab: {
    width: SIZE,
    height: SIZE,
    minHeight: SIZE,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4
  }
})
