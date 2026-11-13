import { NOTIFY_CATEGORY, NOTIFY_CATEGORY_LABEL } from '@sagyou/core/control/notify'
import * as Notifications from 'expo-notifications'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApprovalCards } from '../components/ApprovalCards'
import { ACTION_ICONS, NOTIFY_ICONS } from '../components/icons'
import { Button, EmptyState, ListItem, Screen } from '../components/ui'
import { entryText } from '../notifications/history'
import { historyTime } from '../notifications/format'
import { useNotifications } from '../notifications/store'
import { useRemote } from '../remote/store'
import {
  APPROVAL_ANSWER_ABOVE,
  APPROVAL_EXPIRED,
  CARDS_TITLE,
  CLEAR_HISTORY,
  HISTORY_EMPTY,
  HISTORY_TITLE
} from '../remote/texts'
import { FONT, SPACE, useTheme } from '../theme'

export interface NotificationsScreenProps {
  /** Where an entry leads; the approvals are answered right here. */
  navigation?: { navigate(route: 'Abas', params: { screen: 'PC' }): void }
  /** On screen: only then the app asks the Worker every 5 s. */
  focused?: boolean
  /** Injected by tests. */
  now?: () => number
}

/**
 * Notificações (spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): the approval cards
 * that can still be answered, then the history of what the phone was told.
 */
export function NotificationsScreen({
  navigation,
  focused = true,
  now = Date.now
}: NotificationsScreenProps): React.JSX.Element {
  const theme = useTheme()
  const cards = useRemote((s) => s.cards)
  const busy = useRemote((s) => s.busy)
  const error = useRemote((s) => s.error)
  const connection = useRemote((s) => s.connection)
  const entries = useNotifications((s) => s.entries)
  const [clock, setClock] = useState(now)
  // The entries unread when the screen opened stay bold during this visit; opening it reads
  // them all (the effect below runs after the first render).
  const [bold] = useState<ReadonlySet<string>>(
    () => new Set(entries.filter((e) => !e.read).map((e) => e.id))
  )

  useEffect(() => {
    if (!focused) return
    useRemote.getState().startPolling()
    return () => useRemote.getState().stopPolling()
  }, [focused])

  // Opening the screen reads everything in the history (what arrives meanwhile too).
  useEffect(() => {
    if (focused) useNotifications.getState().markAllRead()
  }, [focused, entries])

  // The countdown of the cards ticks once a second while there is one.
  const ticking = cards.length > 0
  useEffect(() => {
    if (!focused || !ticking) return
    const id = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(id)
  }, [focused, ticking, now])

  const valid = cards.filter((c) => c.expiresAt > clock)
  const nothing = cards.length === 0 && entries.length === 0

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        {connection || error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {connection || error}
          </Text>
        ) : null}

        {cards.length > 0 ? (
          <View style={{ gap: SPACE.sm }}>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.muted }]}>
              {`${CARDS_TITLE} (${valid.length})`}
            </Text>
            <ApprovalCards
              cards={cards}
              clock={clock}
              busy={busy}
              onAnswer={(id, approved) => void useRemote.getState().answer(id, approved)}
            />
          </View>
        ) : null}

        {entries.length > 0 ? (
          <View style={{ gap: SPACE.sm }}>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.muted }]}>
              {HISTORY_TITLE}
            </Text>
            {entries.map((entry) => {
              const category = entry.code === 'unknown' ? null : NOTIFY_CATEGORY[entry.code]
              const Icon = category ? NOTIFY_ICONS[category] : ACTION_ICONS.bell
              const when = historyTime(entry.at, clock)
              const detail =
                entry.code === 'approval'
                  ? valid.length > 0
                    ? APPROVAL_ANSWER_ABOVE
                    : APPROVAL_EXPIRED
                  : null
              const subtitle = [category ? NOTIFY_CATEGORY_LABEL[category] : null, when, detail]
                .filter(Boolean)
                .join(' · ')
              return (
                <ListItem
                  key={entry.id}
                  title={entryText(entry)}
                  subtitle={subtitle}
                  bold={bold.has(entry.id)}
                  left={<Icon size={20} color={entry.read ? theme.muted : theme.purple} />}
                  // An approval is answered above; the others open the PC tab.
                  onPress={
                    entry.code === 'approval'
                      ? undefined
                      : () => navigation?.navigate('Abas', { screen: 'PC' })
                  }
                />
              )
            })}
            <Button
              label={CLEAR_HISTORY}
              onPress={() => {
                useNotifications.getState().clear()
                // And out of the bar too: they would be read again when the app returns.
                void Notifications.dismissAllNotificationsAsync().catch(() => undefined)
              }}
            />
          </View>
        ) : null}

        {nothing ? <EmptyState icon={ACTION_ICONS.bell} text={HISTORY_EMPTY} /> : null}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: FONT.caption, fontWeight: '700' }
})
