import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useNotifications } from '../notifications/store'
import { useRemote } from '../remote/store'
import { bellLabel } from '../remote/texts'
import { useApp } from '../store/app'
import { MIN_TOUCH, useTheme } from '../theme'
import { Badge } from './Badge'
import { ACTION_ICONS } from './icons'

/**
 * The bell of the header (spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): only on
 * an authorized phone that may still send. A red number counts the approval cards that can still
 * be answered; with none, a dot says there are unread notifications.
 */
export function NotificationBell({
  onPress,
  now = Date.now
}: {
  onPress: () => void
  /** Injected by tests. */
  now?: () => number
}): React.JSX.Element | null {
  const theme = useTheme()
  const authorized = useRemote((s) => s.authorized)
  const cards = useRemote((s) => s.cards)
  const readOnly = useApp((s) => s.readOnly)
  const unread = useNotifications((s) => s.unread)
  const [clock, setClock] = useState(now)

  // The store only drops an expired card when it reads the PC again, which no tab does on its
  // own: the bell keeps its own clock, and only while there is a card to count.
  const ticking = cards.length > 0
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(id)
  }, [ticking, now])

  if (authorized !== 'yes' || readOnly) return null
  const pending = cards.filter((c) => c.expiresAt > clock).length
  const Bell = ACTION_ICONS.bell
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bellLabel(pending)}
      onPress={onPress}
      style={styles.button}
    >
      <Bell size={22} color={theme.onSurfaceIcon} />
      {pending > 0 ? (
        <View style={styles.badge}>
          <Badge text={String(pending)} tone="red" />
        </View>
      ) : unread > 0 ? (
        <View testID="bell-dot" style={[styles.dot, { backgroundColor: theme.red }]} />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badge: { position: 'absolute', top: 2, right: 0 },
  dot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5 }
})
