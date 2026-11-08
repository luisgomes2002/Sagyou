import * as Clipboard from 'expo-clipboard'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Skeleton } from '../components/Skeleton'
import { Button, Card, Field, QrCode, Screen, Snackbar } from '../components/ui'
import { useLockState } from '../lock/lockState'
import { useApp } from '../store/app'
import { countdownText, fetchInvite, forgetCopiedCode, type InviteState } from '../sync/invite'
import { FONT, SPACE, useTheme } from '../theme'

export const PAIR_DEVICE_TITLE = 'Parear outro aparelho'
export const PAIR_HINT =
  'Escaneie no outro aparelho, ou cole o código em Configurações → Sincronização → Entrar com código.'
export const COPY_LABEL = 'Copiar código'
export const COPIED_TEXT = 'Código copiado.'
export const EXPIRED_TEXT = 'O código expirou.'
export const NEW_CODE_LABEL = 'Gerar outro'
export const FACTOR_LABEL = 'Código do autenticador'
export const FACTOR_HINT = 'Ou um código reserva.'
export const GENERATE_LABEL = 'Gerar código'
export const QR_LABEL = 'Código de pareamento'
const SNACK_MS = 4000
const QR_SIZE = 240

export interface PairDeviceScreenProps {
  navigation?: { goBack(): void }
  /** Injected by tests; the clock the countdown reads. */
  now?: () => number
}

/**
 * Ajustes → Parear outro aparelho: a one-time code (QR + text) that another PC
 * or phone uses to join this sync, from the phone (spec
 * docs/specs/2026-11-03-acesso-remoto.md). The code carries the sync key, so
 * it lives only in this screen's state: never a log, a pref or SQLite, and it
 * is dropped when the screen closes or the app locks.
 */
export function PairDeviceScreen({
  navigation,
  now = Date.now
}: PairDeviceScreenProps = {}): React.JSX.Element {
  const theme = useTheme()
  const engine = useApp((s) => s.services?.runtime.engine)
  const [invite, setInvite] = useState<InviteState>({ kind: 'factor' })
  // The TOTP or backup code; dropped as soon as it is sent (good once).
  const [totp, setTotp] = useState('')
  const [clock, setClock] = useState(now)
  const [snack, setSnack] = useState<string | null>(null)
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A late answer for a screen already gone (or a newer request) is dropped.
  const request = useRef(0)
  // The code put in the system clipboard, cleared again when it stops being valid here.
  const copied = useRef<string | null>(null)
  const forget = (): void => {
    const code = copied.current
    copied.current = null
    void forgetCopiedCode(code)
  }

  /** "Gerar código": the skeleton, then the invite; only the latest answer lands. */
  const generate = (): void => {
    const code = totp.trim()
    if (!engine || !code) return
    setTotp('')
    setInvite({ kind: 'loading' })
    const id = ++request.current
    void fetchInvite(engine, code).then((next) => {
      if (id !== request.current) return
      setClock(now())
      // A refusal goes back to the field, with the engine's message as is.
      setInvite(next.kind === 'error' ? { kind: 'factor', error: next.message } : next)
    })
  }

  /** "Gerar outro": a new authenticator code is needed. */
  const again = (): void => setInvite({ kind: 'factor' })

  useEffect(() => {
    return () => {
      // Closing the screen forgets the code and ignores a request still on the way.
      request.current += 1
      if (snackTimer.current) clearTimeout(snackTimer.current)
      void forgetCopiedCode(copied.current)
    }
  }, [])

  // Locked or in the background: the code goes away with the screen.
  useEffect(
    () =>
      useLockState.subscribe((state) => {
        if (!state.hidden) return
        request.current += 1
        setTotp('')
        forget()
        setInvite({ kind: 'expired' })
        navigation?.goBack()
      }),
    [navigation]
  )

  const ready = invite.kind === 'ready'
  const expiresAt = ready ? invite.expiresAt : 0
  useEffect(() => {
    if (!ready) return
    const tick = setInterval(() => {
      const current = now()
      setClock(current)
      if (current >= expiresAt) {
        forget()
        setInvite({ kind: 'expired' })
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [ready, expiresAt, now])

  const copy = async (): Promise<void> => {
    if (invite.kind !== 'ready') return
    await Clipboard.setStringAsync(invite.code)
    copied.current = invite.code
    setSnack(COPIED_TEXT)
    if (snackTimer.current) clearTimeout(snackTimer.current)
    snackTimer.current = setTimeout(() => setSnack(null), SNACK_MS)
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Screen>
          <Card>
            <Text style={[styles.body, { color: theme.text }]}>{PAIR_HINT}</Text>
            {invite.kind === 'factor' ? (
              <View style={styles.factor}>
                <Field
                  label={FACTOR_LABEL}
                  value={totp}
                  onChangeText={setTotp}
                  error={invite.error}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  textContentType="oneTimeCode"
                />
                <Text style={[styles.hint, { color: theme.muted }]}>{FACTOR_HINT}</Text>
                <Button
                  variant="primary"
                  label={GENERATE_LABEL}
                  disabled={!engine || totp.trim() === ''}
                  onPress={generate}
                />
              </View>
            ) : null}
            {invite.kind === 'loading' ? <Skeleton lines={3} /> : null}
            {invite.kind === 'ready' ? (
              <View style={styles.code}>
                <QrCode value={invite.code} size={QR_SIZE} accessibilityLabel={QR_LABEL} />
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.body, { color: theme.muted }]}
                >
                  {`Vale uma vez só e expira em ${countdownText(invite.expiresAt, clock)}`}
                </Text>
                <Button variant="primary" label={COPY_LABEL} onPress={() => void copy()} />
              </View>
            ) : null}
            {invite.kind === 'expired' ? (
              <View style={styles.code}>
                <Text style={[styles.body, { color: theme.attention }]}>{EXPIRED_TEXT}</Text>
                <Button label={NEW_CODE_LABEL} onPress={again} />
              </View>
            ) : null}
          </Card>
        </Screen>
      </ScrollView>
      <View style={styles.snack}>
        <Snackbar visible={snack !== null} message={snack} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { fontSize: FONT.body },
  code: { alignItems: 'center', gap: SPACE.md, paddingTop: SPACE.md },
  factor: { gap: SPACE.sm, paddingTop: SPACE.md },
  hint: { fontSize: FONT.caption },
  snack: { position: 'absolute', left: SPACE.md, right: SPACE.md, bottom: SPACE.md }
})
