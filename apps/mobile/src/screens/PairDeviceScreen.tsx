import { SyncUserError } from '@sagyou/core/sync/engine'
import * as Clipboard from 'expo-clipboard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Skeleton } from '../components/Skeleton'
import { Button, Card, QrCode, Screen, Snackbar } from '../components/ui'
import { useLockState } from '../lock/lockState'
import { useApp } from '../store/app'
import { FONT, SPACE, useTheme } from '../theme'

export const PAIR_DEVICE_TITLE = 'Parear outro aparelho'
export const PAIR_HINT =
  'Escaneie no outro aparelho, ou cole o código em Configurações → Sincronização → Entrar com código.'
export const COPY_LABEL = 'Copiar código'
export const COPIED_TEXT = 'Código copiado.'
export const EXPIRED_TEXT = 'O código expirou.'
export const NEW_CODE_LABEL = 'Gerar outro'
export const RETRY_LABEL = 'Tentar de novo'
export const UNEXPECTED_ERROR_TEXT = 'Não foi possível gerar o código.'
export const QR_LABEL = 'Código de pareamento'
const SNACK_MS = 4000
const QR_SIZE = 240

/** "M:SS" until `expiresAt`; never negative. */
export function countdownText(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const minutes = Math.floor(left / 60)
  const seconds = String(left % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

type InviteState =
  | { kind: 'loading' }
  | { kind: 'ready'; code: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

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
  const [invite, setInvite] = useState<InviteState>({ kind: 'loading' })
  const [clock, setClock] = useState(now)
  const [snack, setSnack] = useState<string | null>(null)
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A late answer for a screen already gone (or a newer request) is dropped.
  const request = useRef(0)

  // Only sets state once the engine answers, so the first request can run from an effect.
  const load = useCallback(async (): Promise<void> => {
    if (!engine) return
    const id = ++request.current
    try {
      const { code, expiresAt } = await engine.createInvite()
      if (id !== request.current) return
      setClock(now())
      setInvite({ kind: 'ready', code, expiresAt })
    } catch (cause) {
      if (id !== request.current) return
      setInvite({
        kind: 'error',
        message:
          cause instanceof SyncUserError && cause.message ? cause.message : UNEXPECTED_ERROR_TEXT
      })
    }
  }, [engine, now])

  /** "Gerar outro" / "Tentar de novo": back to the skeleton, then a new invite. */
  const generate = (): void => {
    setInvite({ kind: 'loading' })
    void load()
  }

  useEffect(() => {
    void load()
    return () => {
      // Closing the screen forgets the code and ignores a request still on the way.
      request.current += 1
      if (snackTimer.current) clearTimeout(snackTimer.current)
    }
  }, [load])

  // Locked or in the background: the code goes away with the screen.
  useEffect(
    () =>
      useLockState.subscribe((state) => {
        if (!state.hidden) return
        request.current += 1
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
      if (current >= expiresAt) setInvite({ kind: 'expired' })
    }, 1000)
    return () => clearInterval(tick)
  }, [ready, expiresAt, now])

  const copy = async (): Promise<void> => {
    if (invite.kind !== 'ready') return
    await Clipboard.setStringAsync(invite.code)
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
                <Button label={NEW_CODE_LABEL} onPress={generate} />
              </View>
            ) : null}
            {invite.kind === 'error' ? (
              <View style={styles.code}>
                <Text accessibilityRole="alert" style={[styles.body, { color: theme.red }]}>
                  {invite.message}
                </Text>
                <Button label={RETRY_LABEL} onPress={generate} />
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
  snack: { position: 'absolute', left: SPACE.md, right: SPACE.md, bottom: SPACE.md }
})
