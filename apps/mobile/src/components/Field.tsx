import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

export type FieldProps = TextInputProps & { label: string; error?: string | null }

/** A labelled input; the error, when there is one, is read out as an alert. */
export function Field(props: FieldProps): React.JSX.Element {
  const theme = useTheme()
  const { label, error, style, ...rest } = props
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          {
            backgroundColor: theme.field,
            borderColor: error ? theme.red : theme.border,
            color: theme.text
          },
          style
        ]}
        {...rest}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.red }]}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: SPACE.xs },
  label: { fontSize: FONT.caption },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.control,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    minHeight: MIN_TOUCH,
    fontSize: FONT.bodyLg
  },
  error: { fontSize: FONT.caption }
})
