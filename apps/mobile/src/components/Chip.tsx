import type { LucideIcon } from 'lucide-react-native'
import { Pressable, StyleSheet, Text } from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

/** A selectable option (radio or checkbox look depends on how the caller uses it). */
export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  disabled
}: {
  label: string
  selected: boolean
  onPress: () => void
  icon?: LucideIcon
  disabled?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.selected : theme.surface,
          borderColor: selected ? theme.purple : theme.border,
          opacity: disabled ? 0.5 : 1
        }
      ]}
    >
      {Icon ? <Icon size={16} color={selected ? theme.purple : theme.onSurfaceIcon} /> : null}
      {/* A long sprint or tag name is cut with "…", never past the screen edge. */}
      <Text
        numberOfLines={1}
        style={{ color: selected ? theme.text : theme.muted, fontSize: FONT.body, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md + 2,
    minHeight: MIN_TOUCH
  }
})
