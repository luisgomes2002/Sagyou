import { INVITE_EXPIRED_MESSAGE } from '@sagyou/core/sync/engine'
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
  const used = useRef(false)

  const join = async (text: string): Promise<void> => {
    if (!services || busy || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await services.runtime.engine.join(text.trim(), 'replace', name)
      paired()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message === INVITE_EXPIRED_MESSAGE ? EXPIRED_TEXT : message)
      used.current = false
    } finally {
      setBusy(false)
    }
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
