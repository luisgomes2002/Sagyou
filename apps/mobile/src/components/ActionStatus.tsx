import { StyleSheet, Text, View } from 'react-native'
import type { ActionProgress } from '../remote/progress'
import { FONT, SPACE, useTheme } from '../theme'

/**
 * The step of a Ligar/Desligar on the PC tab (spec 2026-11-13): sober colours, no blinking, and
 * a live region so a screen reader says each step once. The progress indicator is the button's.
 */
export function ActionStatus({ action }: { action: ActionProgress }): React.JSX.Element {
  const theme = useTheme()
  const color =
    action.step === 'done' ? theme.green : action.step === 'failed' ? theme.red : theme.muted
  return (
    <View accessibilityLiveRegion="polite" testID="action-status" style={styles.row}>
      <Text style={{ color, fontSize: FONT.body, flex: 1 }}>{action.text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }
})
