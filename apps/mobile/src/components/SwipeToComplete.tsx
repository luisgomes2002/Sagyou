import { useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { RADIUS, SPACE, useTheme } from '../theme'
import { ACTION_ICONS } from './icons'

/** Share of the row's width a swipe must pass before it completes. */
const THRESHOLD = 0.4

/**
 * Swipe a row to the right to complete it. The same action is offered to
 * screen readers by the row itself (accessibilityActions), never only here.
 */
export function SwipeToComplete({
  children,
  onComplete,
  enabled = true
}: {
  children: ReactNode
  onComplete: () => void
  enabled?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  const ref = useRef<SwipeableMethods>(null)
  const [width, setWidth] = useState(0)
  const Check = ACTION_ICONS.check
  if (!enabled) return <>{children}</>
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Swipeable
        ref={ref}
        friction={1.5}
        leftThreshold={width ? width * THRESHOLD : undefined}
        overshootLeft={false}
        renderLeftActions={() => (
          <View style={[styles.action, { backgroundColor: theme.selected }]}>
            <Check size={22} color={theme.green} />
          </View>
        )}
        onSwipeableOpen={() => {
          ref.current?.close()
          onComplete()
        }}
      >
        {children}
      </Swipeable>
    </View>
  )
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    justifyContent: 'center',
    paddingLeft: SPACE.xl,
    borderRadius: RADIUS.card
  }
})
