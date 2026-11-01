import { INVITE_EXPIRED_MESSAGE, SyncUserError } from '@sagyou/core/sync/engine'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Device from 'expo-device'
import { useRef, useState } from 'react'
import { ScanQrCode } from 'lucide-react-native'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AppMark } from '../components/AppMark'
import { Button, Field, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { FONT, RADIUS, SPACE, useTheme } from '../theme'

export const PAIR_TITLE = 'Parear com o Sagyou'
export const DOWNLOADING_TEXT = 'Baixando seus dados…'
export const EXPIRED_TEXT = 'Este código expirou. Gere outro no Sagyou do PC.'
export const DOWNLOAD_FAILED_TEXT =
  'Não foi possível baixar seus dados. Confira a conexão e tente de novo.'
export const PAIR_FAILED_TEXT = 'Não deu para parear. Confira o código e a conexão.'
export const PAIR_STEPS = ['Boas-vindas', 'No PC', 'Conectando'] as const
export const WELCOME_TEXT = 'Leve suas tarefas, hábitos e finanças no bolso'
export const ON_PC_TEXT =
  'Abra Configurações → Sincronização → Parear novo aparelho no Sagyou do PC'

/** "2 de 3" above each step, read as one line. */
function StepHeader({ step }: { step: 1 | 2 | 3 }): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.steps}>
      <View style={styles.dots}>
        {PAIR_STEPS.map((name, i) => (
          <View
            key={name}
            style={[styles.stepDot, { backgroundColor: i < step ? theme.purple : theme.selected }]}
          />
        ))}
      </View>
      <Text style={{ color: theme.muted, fontSize: FONT.caption }}>{`${step} de 3`}</Text>
    </View>
  )
}

/** The engine's own messages are already pt-BR (SyncUserError); anything else gets a generic one. */
function pairErrorText(err: unknown): string {
  if (err instanceof SyncUserError)
    return err.message === INVITE_EXPIRED_MESSAGE ? EXPIRED_TEXT : err.message
  return PAIR_FAILED_TEXT
}

/** The phone only joins an existing sync: QR from the PC, or the same code pasted. */
export function PairScreen(): React.JSX.Element {
  const theme = useTheme()
  const services = useApp((s) => s.services)
  const paired = useApp((s) => s.paired)
  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState(Device.modelName ?? 'Celular')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Paired, but the first download did not finish: the engine stays paused
  // ('join') and must take the cloud before this phone can be used.
  const [downloadPending, setDownloadPending] = useState(false)
  const [started, setStarted] = useState(false)
  const used = useRef(false)

  const finish = (): void => {
    if (!services) return
    if (services.runtime.engine.status().state === 'paused') {
      setDownloadPending(true)
      setError(DOWNLOAD_FAILED_TEXT)
      return
    }
    setDownloadPending(false)
    paired()
  }

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      finish()
    } catch (err) {
      setError(pairErrorText(err))
      used.current = false
    } finally {
      setBusy(false)
    }
  }

  const join = async (text: string): Promise<void> => {
    if (!services || busy || !text.trim()) return
    // The code carries the sync key: it does not stay on screen after a try.
    setCode('')
    await run(() => services.runtime.engine.join(text.trim(), 'replace', name))
  }

  const retryDownload = async (): Promise<void> => {
    if (!services || busy) return
    await run(() => services.runtime.engine.resume('take-cloud'))
  }

  if (busy)
    return (
      <Screen>
        <StepHeader step={3} />
        <View style={styles.center}>
          <ActivityIndicator color={theme.purple} />
          <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>{DOWNLOADING_TEXT}</Text>
        </View>
      </Screen>
    )

  if (downloadPending)
    return (
      <Screen>
        <StepHeader step={3} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {PAIR_TITLE}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {error}
          </Text>
        ) : null}
        <Button variant="primary" label="Tentar de novo" onPress={() => void retryDownload()} />
      </Screen>
    )

  if (!started)
    return (
      <Screen>
        <StepHeader step={1} />
        <View style={styles.center}>
          <AppMark size={96} />
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {PAIR_TITLE}
          </Text>
          <Text style={[styles.lead, { color: theme.muted }]}>{WELCOME_TEXT}</Text>
        </View>
        <Button variant="primary" label="Começar" onPress={() => setStarted(true)} />
      </Screen>
    )

  return (
    // With 200% text or the keyboard up the code step is taller than the screen.
    <ScrollView testID="pair-scroll" keyboardShouldPersistTaps="handled">
      <Screen>
        <StepHeader step={2} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {PAIR_STEPS[1]}
        </Text>
        <Text style={[styles.lead, { color: theme.muted }]}>{ON_PC_TEXT}</Text>
        <Field label="Nome deste aparelho" value={name} onChangeText={setName} maxLength={80} />
        {scanning && permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (used.current) return
              used.current = true
              setScanning(false)
              void join(data)
            }}
          />
        ) : (
          <Button
            variant="primary"
            label="Ler QR"
            icon={ScanQrCode}
            onPress={async () => {
              const granted = permission?.granted || (await requestPermission()).granted
              if (granted) setScanning(true)
              else setError('Sem permissão para a câmera. Use "Colar código".')
            }}
          />
        )}
        <Field
          label="Código de pareamento"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          // The code holds the sync key: keep it out of keyboard learning and autofill.
          keyboardType="visible-password"
          importantForAutofill="no"
          multiline
        />
        <Button label="Colar código" onPress={() => void join(code)} disabled={!code.trim()} />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {error}
          </Text>
        ) : null}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: FONT.title, fontWeight: '700', textAlign: 'center' },
  lead: { fontSize: FONT.bodyLg, textAlign: 'center' },
  camera: { height: 260, borderRadius: RADIUS.card, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md },
  steps: { alignItems: 'center', gap: SPACE.xs },
  dots: { flexDirection: 'row', gap: SPACE.sm },
  stepDot: { width: 28, height: 4, borderRadius: RADIUS.pill }
})
