import { INVITE_EXPIRED_MESSAGE, SyncUserError } from '@sagyou/core/sync/engine'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Device from 'expo-device'
import { useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Button, Field, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { useTheme } from '../theme'

export const PAIR_TITLE = 'Parear com o Sagyou'
export const DOWNLOADING_TEXT = 'Baixando seus dados…'
export const EXPIRED_TEXT = 'Este código expirou. Gere outro no Sagyou do PC.'
export const DOWNLOAD_FAILED_TEXT =
  'Não foi possível baixar seus dados. Confira a conexão e tente de novo.'
export const PAIR_FAILED_TEXT = 'Não deu para parear. Confira o código e a conexão.'

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
        <View style={styles.center}>
          <ActivityIndicator color={theme.purple} />
          <Text style={{ color: theme.text }}>{DOWNLOADING_TEXT}</Text>
        </View>
      </Screen>
    )

  if (downloadPending)
    return (
      <Screen>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {PAIR_TITLE}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red }}>
            {error}
          </Text>
        ) : null}
        <Button primary label="Tentar de novo" onPress={() => void retryDownload()} />
      </Screen>
    )

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        {PAIR_TITLE}
      </Text>
      <Text style={{ color: theme.muted }}>
        No Sagyou do PC, abra Configurações → Sincronização → Parear novo aparelho.
      </Text>
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
          primary
          label="Escanear QR"
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
        <Text accessibilityRole="alert" style={{ color: theme.red }}>
          {error}
        </Text>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700' },
  camera: { height: 260, borderRadius: 8, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }
})
