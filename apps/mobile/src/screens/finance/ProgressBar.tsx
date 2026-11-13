import { StyleSheet, View } from 'react-native'
import { RADIUS, useTheme } from '../../theme'

const HEIGHT = 8

/**
 * A thin bar for a share of 0..100. ⚠️ Geometry only: whoever draws it also writes the value out
 * (the percentage, the amounts), so the bar is never the only information.
 */
export function ProgressBar({
  percent,
  color,
  label
}: {
  percent: number
  color: string
  /** What a screen reader says: "Pago: 40%". */
  label: string
}): React.JSX.Element {
  const theme = useTheme()
  const share = Math.min(100, Math.max(0, percent))
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share) }}
      style={[styles.track, { backgroundColor: theme.selected }]}
    >
      <View
        testID="progress-fill"
        style={[styles.fill, { width: `${share}%`, backgroundColor: color }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: HEIGHT, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: HEIGHT, borderRadius: RADIUS.pill }
})
