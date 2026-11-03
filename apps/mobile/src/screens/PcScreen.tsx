import type { PcState } from '@sagyou/core/control/state'
import {
  CONTROL_TEXT,
  PC_STATE_TEXT,
  rcDownText,
  shuttingDownText,
  updateReadyText
} from '@sagyou/core/control/texts'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ACTION_ICONS } from '../components/icons'
import { Button, Card, EmptyState, Screen } from '../components/ui'
import { useRemote } from '../remote/store'
import { FONT, SPACE, useTheme } from '../theme'

export const LOCKED_TEXT = 'Sagyou bloqueado'
export const UNLOCKED_TEXT = 'Sagyou desbloqueado'
export const CARDS_TITLE = 'Aprovações pendentes'
export const LOADING_TEXT = 'Buscando o estado do PC…'

/** Seconds left on a card, "4:59". */
export function cardCountdown(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface PcScreenProps {
  /** The tab is on screen: only then the app asks the Worker every 5 s. */
  focused?: boolean
  /** Injected by tests. */
  now?: () => number
}

/** The "PC" tab (spec docs/specs/2026-11-03-controle-remoto-app.md). */
export function PcScreen({ focused = true, now = Date.now }: PcScreenProps): React.JSX.Element {
  const theme = useTheme()
  const view = useRemote((s) => s.view)
  const status = useRemote((s) => s.status)
  const cards = useRemote((s) => s.cards)
  const error = useRemote((s) => s.error)
  const connection = useRemote((s) => s.connection)
  const busy = useRemote((s) => s.busy)
  const [clock, setClock] = useState(now)

  useEffect(() => {
    if (!focused) return
    useRemote.getState().startPolling()
    return () => useRemote.getState().stopPolling()
  }, [focused])

  // Countdowns (shutdown, cards) tick once a second while the tab is open.
  const ticking = view?.state === 'shutting-down' || cards.length > 0
  useEffect(() => {
    if (!focused || !ticking) return
    const id = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(id)
  }, [focused, ticking, now])

  const remote = useRemote.getState

  const confirmForce = (): void => {
    Alert.alert('Forçar pelo ESP32', CONTROL_TEXT.forceConfirm, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Forçar', style: 'destructive', onPress: () => void remote().forceShutdown() }
    ])
  }

  const confirmInstall = (): void => {
    Alert.alert('Instalar atualização', CONTROL_TEXT.installConfirm, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Instalar', onPress: () => void remote().installUpdate() }
    ])
  }

  if (!view)
    return (
      <Screen>
        {connection ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {connection}
          </Text>
        ) : (
          <EmptyState icon={ACTION_ICONS.pc} text={LOADING_TEXT} />
        )}
      </Screen>
    )

  const state: PcState = view.state
  const alive = state === 'ready' || state === 'rc-down' || state === 'shutting-down'
  const title =
    state === 'rc-down'
      ? rcDownText(view.missing)
      : state === 'shutting-down' && status?.shutdownAt
        ? shuttingDownText(status.shutdownAt - clock)
        : PC_STATE_TEXT[state]
  const stateColor =
    state === 'ready' ? theme.green : state === 'off' ? theme.muted : theme.attention
  const Icon = state === 'off' ? ACTION_ICONS.powerOff : ACTION_ICONS.pc

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Card>
          <View style={styles.row}>
            <Icon size={28} color={stateColor} />
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="header"
              style={[styles.state, { color: theme.text }]}
            >
              {title}
            </Text>
          </View>
          {alive && status ? (
            <Text style={{ color: theme.muted, fontSize: FONT.body }}>
              {status.locked ? LOCKED_TEXT : UNLOCKED_TEXT}
            </Text>
          ) : null}
          {view.esp32Offline ? (
            <Text style={{ color: theme.attention, fontSize: FONT.body }}>
              {CONTROL_TEXT.esp32Offline}
            </Text>
          ) : null}
        </Card>

        {connection ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {connection}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {error}
          </Text>
        ) : null}

        {state === 'off' ? (
          <Button
            variant="primary"
            label="Ligar"
            icon={ACTION_ICONS.power}
            disabled={busy}
            onPress={() => void remote().wake()}
          />
        ) : null}
        {state === 'ready' || state === 'rc-down' ? (
          <>
            {status?.locked ? (
              <Button
                variant="primary"
                label="Desbloquear"
                icon={ACTION_ICONS.unlock}
                disabled={busy}
                onPress={() => void remote().unlock()}
              />
            ) : (
              <Button
                label="Bloquear agora"
                icon={ACTION_ICONS.lock}
                disabled={busy}
                onPress={() => void remote().lock()}
              />
            )}
            <Button
              variant="danger"
              label="Desligar"
              icon={ACTION_ICONS.powerOff}
              disabled={busy}
              onPress={() => void remote().shutdown()}
            />
          </>
        ) : null}
        {state === 'waiting-sagyou' ? (
          <Button
            variant="danger"
            label="Forçar pelo ESP32"
            icon={ACTION_ICONS.powerOff}
            disabled={busy}
            onPress={confirmForce}
          />
        ) : null}
        {state === 'shutting-down' ? (
          <Button
            variant="primary"
            label="Cancelar"
            disabled={busy}
            onPress={() => void remote().abortShutdown()}
          />
        ) : null}

        {alive && status?.updateVersion ? (
          <Card>
            <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>
              {updateReadyText(status.updateVersion)}
            </Text>
            <Button label="Instalar atualização" disabled={busy} onPress={confirmInstall} />
          </Card>
        ) : null}

        {cards.length > 0 ? (
          <View style={{ gap: SPACE.sm }}>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.muted }]}>
              {CARDS_TITLE}
            </Text>
            {cards.map((card) => {
              const left = card.expiresAt - clock
              const expired = left <= 0
              return (
                <Card key={card.id}>
                  <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>{card.resumo}</Text>
                  <Text style={{ color: theme.muted, fontSize: FONT.caption }}>
                    {`${card.session} · ${card.tool} · ${expired ? CONTROL_TEXT.cardGone : cardCountdown(left)}`}
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      variant="primary"
                      label="Aprovar"
                      a11yLabel={`Aprovar: ${card.resumo}`}
                      disabled={busy || expired}
                      onPress={() => void remote().answer(card.id, true)}
                    />
                    <Button
                      label="Recusar"
                      a11yLabel={`Recusar: ${card.resumo}`}
                      disabled={busy || expired}
                      onPress={() => void remote().answer(card.id, false)}
                    />
                  </View>
                </Card>
              )
            })}
          </View>
        ) : null}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  state: { flex: 1, fontSize: FONT.title, fontWeight: '700' },
  section: { fontSize: FONT.caption, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' }
})
