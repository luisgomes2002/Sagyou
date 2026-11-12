import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'
import { BottomSheet } from './BottomSheet'
import { ACTION_ICONS } from './icons'

export interface PickerOption {
  id: string
  label: string
  /** Shown but not pickable (e.g. "Nova tabela…" while the phone is read-only). */
  disabled?: boolean
}

/** "Projeto ▸ Casa": one line that opens a sheet with the options as radios. */
export function Picker({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string
  value: string | undefined
  options: PickerOption[]
  onChange: (id: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.id === value)
  const text = `${label} ▸ ${current?.label ?? '—'}`
  const Chevron = ACTION_ICONS.chevron
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={`Escolher ${label.toLowerCase()}`}
        disabled={disabled || options.length < 2}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.line,
          { backgroundColor: pressed ? theme.selected : theme.field, borderColor: theme.border }
        ]}
      >
        <Text style={[styles.text, { color: theme.text }]} numberOfLines={1}>
          {text}
        </Text>
        {options.length > 1 ? <Chevron size={18} color={theme.onSurfaceIcon} /> : null}
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View accessibilityRole="radiogroup">
          {options.map((o) => {
            const checked = o.id === value
            return (
              <Pressable
                key={o.id}
                accessibilityRole="radio"
                accessibilityLabel={o.label}
                accessibilityState={{ checked, disabled: !!o.disabled }}
                disabled={o.disabled}
                onPress={() => {
                  setOpen(false)
                  if (!checked) onChange(o.id)
                }}
                style={[
                  styles.option,
                  checked && { backgroundColor: theme.selected },
                  o.disabled && { opacity: 0.5 }
                ]}
              >
                <View
                  style={[
                    styles.radio,
                    { borderColor: checked ? theme.purple : theme.border },
                    checked && { borderWidth: 6 }
                  ]}
                />
                <Text style={[styles.text, { color: theme.text }]}>{o.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </BottomSheet>
    </>
  )
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    paddingHorizontal: SPACE.md,
    minHeight: MIN_TOUCH
  },
  text: { flex: 1, fontSize: FONT.bodyLg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: MIN_TOUCH,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.control
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 }
})
