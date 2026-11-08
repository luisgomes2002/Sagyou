import { CONTROL_TEXT, PC_STATE_TEXT, rcDownText } from '@sagyou/core/control/texts'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text } from 'react-native'
import { ACTION_ICONS } from '../components/icons'
import { Button, Card, Field, Screen } from '../components/ui'
import { useLockState } from '../lock/lockState'
import { useRemote } from '../remote/store'
import { REMOTE_TEXT, compareText } from '../remote/texts'
import { FONT, SPACE, useTheme } from '../theme'

export const CONTROL_TITLE = 'Controlar o PC'
export const ASK_LABEL = 'Pedir autorização'
export const AWAY_LABEL = 'Estou longe do PC'
export const WAITING_TEXT = 'Aguardando o PC'
export const WAITING_CODE_TEXT = 'Aguardando o código do PC…'
export const AUTHORIZED_TEXT = 'Autorizado'
export const ASK_AGAIN_LABEL = 'Pedir de novo'
export const REMOVE_LABEL = 'Remover este celular'
export const REMOVE_MESSAGE =
  'Este celular deixa de controlar o PC. Para voltar, peça autorização de novo.'
export const INTRO_TEXT =
  'Ligue, desligue, desbloqueie o Sagyou e aprove os cartões do Fleet pelo celular. No PC, ative Configurações → Controle remoto antes.'
export const AWAY_TEXT =
  'Para trocar de celular longe de casa. Os celulares autorizados antes perdem o controle do PC.'

export interface ControlSetupScreenProps {
  navigation?: { goBack(): void }
}

/** Ajustes → Controlar o PC (spec docs/specs/2026-11-03-controle-remoto-app.md). */
export function ControlSetupScreen({
  navigation
}: ControlSetupScreenProps = {}): React.JSX.Element {
  const theme = useTheme()
  const authorized = useRemote((s) => s.authorized)
  const pairing = useRemote((s) => s.pairingCode)
  const error = useRemote((s) => s.error)
  const notice = useRemote((s) => s.notice)
  const requestExpired = useRemote((s) => s.requestExpired)
  const busy = useRemote((s) => s.busy)
  const view = useRemote((s) => s.view)
  const [away, setAway] = useState(false)
  // The Sagyou password and the second factor live only here, and go with the screen.
  const [password, setPassword] = useState('')
  const [factor, setFactor] = useState('')

  // Waiting for the PC (or authorized): read its answers and its state while this screen is open.
  useEffect(() => {
    if (authorized === 'none') return
    useRemote.getState().startPolling()
    return () => useRemote.getState().stopPolling()
  }, [authorized])

  // Locked or in the background: drop what was typed and leave.
  useEffect(
    () =>
      useLockState.subscribe((state) => {
        if (!state.hidden) return
        setPassword('')
        setFactor('')
        setAway(false)
        navigation?.goBack()
      }),
    [navigation]
  )

  const send = async (): Promise<void> => {
    await useRemote.getState().requestRemote(password, factor)
    if (useRemote.getState().authorized !== 'none') {
      setPassword('')
      setFactor('')
      setAway(false)
    }
  }

  const remove = (): void => {
    Alert.alert(REMOVE_LABEL, REMOVE_MESSAGE, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => void useRemote.getState().removeThisPhone()
      }
    ])
  }

  const cancel = (
    <Button
      label={CONTROL_TEXT.cancelRequest}
      disabled={busy}
      onPress={() => void useRemote.getState().cancelRequest()}
    />
  )

  // Switching phones from afar: the PC may be off, and only the ESP32 turns it on.
  // Unlock, shutdown and the cards stay in the PC tab, for an authorized phone.
  const pcCard =
    (authorized === 'waiting-pc' || authorized === 'yes') && view ? (
      <Card>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.text, fontSize: FONT.bodyLg }}>
          {view.state === 'rc-down' ? rcDownText(view.missing) : PC_STATE_TEXT[view.state]}
        </Text>
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
        {view.state === 'off' ? (
          <Button
            variant="primary"
            label="Ligar"
            icon={ACTION_ICONS.power}
            disabled={busy}
            onPress={() => void useRemote.getState().wake()}
          />
        ) : null}
      </Card>
    ) : null

  const alert = error ? (
    <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
      {error}
    </Text>
  ) : null

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        {authorized === 'none' && !away ? (
          <>
            <Text style={[styles.lead, { color: theme.muted }]}>{INTRO_TEXT}</Text>
            {alert}
            <Button
              variant="primary"
              label={ASK_LABEL}
              disabled={busy}
              onPress={() => void useRemote.getState().requestAuthorization()}
            />
            <Button
              label={AWAY_LABEL}
              disabled={busy}
              onPress={() => {
                useRemote.getState().clearError()
                setAway(true)
              }}
            />
          </>
        ) : null}

        {authorized === 'none' && away ? (
          <>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {AWAY_LABEL}
            </Text>
            <Text style={[styles.lead, { color: theme.muted }]}>{AWAY_TEXT}</Text>
            <Field
              label="Senha do Sagyou"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              importantForAutofill="no"
            />
            <Field
              label="Código do autenticador ou reserva"
              value={factor}
              onChangeText={setFactor}
              autoCapitalize="characters"
              autoCorrect={false}
              importantForAutofill="no"
            />
            <Text style={{ color: theme.muted, fontSize: FONT.caption }}>
              {CONTROL_TEXT.secondFactorAgain}
            </Text>
            {alert}
            <Button
              variant="primary"
              label="Enviar"
              disabled={busy || !password || !factor.trim()}
              onPress={() => void send()}
            />
            <Button
              label="Voltar"
              disabled={busy}
              onPress={() => {
                setPassword('')
                setFactor('')
                setAway(false)
              }}
            />
          </>
        ) : null}

        {authorized === 'pending' ? (
          <Card>
            <Text accessibilityLiveRegion="polite" style={[styles.code, { color: theme.text }]}>
              {pairing ? compareText(pairing) : WAITING_CODE_TEXT}
            </Text>
            <Text style={{ color: theme.muted, fontSize: FONT.body }}>{WAITING_TEXT}</Text>
            {alert}
            {cancel}
          </Card>
        ) : null}

        {authorized === 'waiting-pc' && requestExpired ? (
          <Card>
            <Text style={{ color: theme.attention, fontSize: FONT.bodyLg }}>
              {REMOTE_TEXT.requestExpired}
            </Text>
            <Button
              variant="primary"
              label={ASK_AGAIN_LABEL}
              disabled={busy}
              onPress={() => void useRemote.getState().cancelRequest()}
            />
          </Card>
        ) : null}
        {authorized === 'waiting-pc' && !requestExpired ? (
          <Card>
            <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>
              {CONTROL_TEXT.waitingPc}
            </Text>
            {notice ? (
              <Text style={{ color: theme.attention, fontSize: FONT.body }}>{notice}</Text>
            ) : null}
            {alert}
            {cancel}
          </Card>
        ) : null}
        {authorized === 'waiting-pc' && !requestExpired ? pcCard : null}

        {authorized === 'yes' ? (
          <>
            <Card>
              <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>{AUTHORIZED_TEXT}</Text>
              {notice ? (
                <Text style={{ color: theme.attention, fontSize: FONT.body }}>{notice}</Text>
              ) : null}
            </Card>
            {pcCard}
            {alert}
            <Button variant="danger" label={REMOVE_LABEL} onPress={remove} />
          </>
        ) : null}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: FONT.title, fontWeight: '700' },
  lead: { fontSize: FONT.bodyLg },
  code: { fontSize: FONT.bodyLg, fontWeight: '700', marginBottom: SPACE.xs }
})
