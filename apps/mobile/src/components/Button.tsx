import type { LucideIcon } from 'lucide-react-native'
import { Pressable, StyleSheet, Text } from 'react-native'
import { Spinner } from './Spinner'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  icon?: LucideIcon
  disabled?: boolean
  /**
   * An action is under way (spec 2026-11-13): the button is disabled and shows a small
   * progress indicator, or only its label when the person asked for no animations.
   */
  loading?: boolean
  /** What a screen reader says when the visible label repeats (e.g. one per row). */
  a11yLabel?: string
}

/**
 * Primary: the one solid purple action on a screen. Secondary: neutral solid
 * surface (UI_DESIGN.md: create/add buttons too). Danger: neutral surface,
 * red text. Ghost: no fill, for actions inside a row or a sheet header.
 */
export function Button({
  label,
  onPress,
  variant,
  icon: Icon,
  disabled,
  loading,
  a11yLabel
}: ButtonProps): React.JSX.Element {
  const theme = useTheme()
  const off = !!disabled || !!loading
  const kind: ButtonVariant = variant ?? 'secondary'
  const color = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? theme.red : theme.text
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            kind === 'primary'
              ? theme.primary
              : kind === 'ghost'
                ? pressed
                  ? theme.selected
                  : 'transparent'
                : pressed
                  ? theme.border
                  : theme.selected,
          opacity: off && !loading ? 0.5 : kind === 'primary' && pressed ? 0.85 : 1
        }
      ]}
    >
      {loading ? <Spinner color={color} /> : null}
      {Icon && !loading ? (
        <Icon
          size={18}
          color={
            kind === 'primary' ? theme.onPrimary : kind === 'danger' ? theme.red : theme.purple
          }
        />
      ) : null}
      <Text style={[styles.text, { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: SPACE.sm,
    borderRadius: RADIUS.control,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: { fontSize: FONT.bodyLg, fontWeight: '600' }
})
