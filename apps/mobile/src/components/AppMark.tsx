import { Image, StyleSheet } from 'react-native'
import { RADIUS } from '../theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ICON = require('../../assets/icon.png')

/** The Sagyou icon (same as the PC's), for the pairing, lock and loading screens. */
export function AppMark({
  size = 72,
  a11yLabel = 'Sagyou'
}: {
  size?: number
  a11yLabel?: string
}): React.JSX.Element {
  return (
    <Image
      source={ICON}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
      style={[styles.mark, { width: size, height: size }]}
    />
  )
}

const styles = StyleSheet.create({ mark: { borderRadius: RADIUS.card } })
