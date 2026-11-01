import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useTheme } from '../theme'

export function Button({
  label,
  onPress,
  primary,
  danger,
  disabled,
  a11yLabel
}: {
  label: string
  onPress: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  /** What a screen reader says when the visible label repeats (e.g. one per row). */
  a11yLabel?: string
}): React.JSX.Element {
  const theme = useTheme()
  const background = primary ? theme.primary : theme.selected
  const color = primary ? theme.onPrimary : danger ? theme.red : theme.text
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: background, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  )
}

export function Field(props: TextInputProps & { label: string }): React.JSX.Element {
  const theme = useTheme()
  const { label, style, ...rest } = props
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          { backgroundColor: theme.field, borderColor: theme.border, color: theme.text },
          style
        ]}
        {...rest}
      />
    </View>
  )
}

/** A selectable option (radio or checkbox look depends on how the caller uses it). */
export function Chip({
  label,
  selected,
  onPress
}: {
  label: string
  selected: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.selected : theme.surface,
          borderColor: selected ? theme.purple : theme.border
        }
      ]}
    >
      <Text style={{ color: selected ? theme.text : theme.muted }}>{label}</Text>
    </Pressable>
  )
}

export function Row({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>
}

export function Card({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
  )
}

export function Screen({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = useTheme()
  return <View style={[styles.screen, { backgroundColor: theme.bg }]}>{children}</View>
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: { gap: 4 },
  label: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15
  },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center'
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { flex: 1, padding: 16, gap: 12 }
})
