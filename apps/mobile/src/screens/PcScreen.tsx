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
import { Button, Card, EmptyState, Field, Screen } from '../components/ui'
import { useRemote } from '../remote/store'
import { REMOTE_TEXT, accessCutText, cardCountdown } from '../remote/texts'
import { FONT, SPACE, useTheme } from '../theme'

export const LOCKED_TEXT = 'Sagyou bloqueado'
export const UNLOCKED_TEXT = 'Sagyou desbloqueado'
export const CARDS_TITLE = 'Aprovações pendentes'
export const LOADING_TEXT = 'Buscando o estado do PC…'

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
  const [factor, setFactor] = useState('')

  useEffect(() => {
    if (!focused) return
    useRemote.getState().startPolling()
    return () => useRemote.getState().stopPolling()
  }, [focused])

  // A shutdown forced through the ESP32 can still be cancelled until this instant.
  const forcedUntil = view?.forcedShutdownUntil ?? null
  // Countdowns (shutdown, cards) tick once a second while the tab is open.
  const ticking =
    view?.state === 'shutting-down' ||
    (forcedUntil !== null && forcedUntil > clock) ||
    cards.length > 0
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

  const confirmCut = (): void => {
    Alert.alert('Cortar acesso', REMOTE_TEXT.cutConfirm, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cortar', style: 'destructive', onPress: () => void remote().cutAccess() }
    ])
  }

  const restore = (): void => {
    const code = factor
    // The code lives only on this screen, and only until it is sent.
    setFactor('')
    void remote().restoreAccess(code)
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
  const forcing = forcedUntil !== null && forcedUntil > clock
  // Only the state is a live region; the countdown below it would be read every second.
  const title = state === 'rc-down' ? rcDownText(view.missing) : PC_STATE_TEXT[state]
  const countdown =
    state === 'shutting-down' && status?.shutdownAt
      ? shuttingDownText(status.shutdownAt - clock)
      : forcing && forcedUntil !== null
        ? shuttingDownText(forcedUntil - clock)
        : null
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
          {countdown ? (
            <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>{countdown}</Text>
          ) : null}
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
          {view.esp32NoAnswer ? (
            <Text style={{ color: theme.attention, fontSize: FONT.body }}>
              {CONTROL_TEXT.esp32NoAnswer}
            </Text>
          ) : null}
        </Card>

        {connection || error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {connection || error}
          </Text>
        ) : null}

        {state === 'off' && !forcing ? (
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
        {state === 'waiting-sagyou' && !forcing ? (
          <Button
            variant="danger"
            label="Forçar pelo ESP32"
            icon={ACTION_ICONS.powerOff}
            disabled={busy}
            onPress={confirmForce}
          />
        ) : null}
        {state === 'shutting-down' || forcing ? (
          <Button
            variant="primary"
            label="Cancelar"
            disabled={busy}
            onPress={() => void remote().abortShutdown()}
          />
        ) : null}

        {alive && status ? (
          status.accessCutAt ? (
            <Card>
              <Text style={{ color: theme.attention, fontSize: FONT.bodyLg }}>
                {accessCutText(status.accessCutAt)}
              </Text>
              <Field
                label="Código do autenticador ou reserva"
                value={factor}
                onChangeText={setFactor}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Button
                variant="primary"
                label="Restaurar acesso"
                icon={ACTION_ICONS.unlock}
                disabled={busy || factor.trim() === ''}
                onPress={restore}
              />
            </Card>
          ) : (
            <Button
              variant="danger"
              label="Cortar acesso"
              icon={ACTION_ICONS.lock}
              disabled={busy}
              onPress={confirmCut}
            />
          )
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
