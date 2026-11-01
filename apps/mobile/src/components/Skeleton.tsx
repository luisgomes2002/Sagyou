import { useEffect, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { RADIUS, SPACE, useTheme } from '../theme'

/**
 * Neutral blocks while the first download has not landed. A slow opacity
 * breath (1 → 0.6 in 800 ms), never a shimmer, and still when animations are off.
 */
export function Skeleton({ lines = 4 }: { lines?: number }): React.JSX.Element {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const [opacity] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.6, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [opacity, reduced])
  return (
    <View
      testID="skeleton"
      accessible
      accessibilityLabel="Carregando seus dados"
      style={styles.list}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View
          key={i}
          style={[styles.block, { backgroundColor: theme.selected, opacity }]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: SPACE.sm },
  block: { height: 56, borderRadius: RADIUS.card }
})
