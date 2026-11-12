import { StyleSheet, Text, View } from 'react-native'
import { FONT, useTheme } from '../../theme'

/** A label over a money value; the value shrinks (down to 0.85) before it would be cut. */
export function Metric({
  label,
  value,
  color,
  testID
}: {
  label: string
  value: string
  color: string
  testID: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.metric}>
      <Text style={[styles.caption, { color: theme.muted }]}>{label}</Text>
      <Text
        testID={testID}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={[styles.value, { color }]}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  metric: { flex: 1, gap: 2 },
  caption: { fontSize: FONT.caption },
  value: { fontSize: FONT.bodyLg, fontWeight: '600', fontVariant: ['tabular-nums'] }
})
