import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { Button, Card, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { conflictsText, statusLines } from '../sync/status-text'
import { useTheme } from '../theme'

export const DISCONNECT_LABEL = 'Desconectar este aparelho'

export function SettingsScreen(): React.JSX.Element {
  const theme = useTheme()
  const status = useApp((s) => s.status)
  const readOnly = useApp((s) => s.readOnly)
  const profiles = useApp((s) => s.state.financialProfiles)
  const profileId = useApp((s) => s.profileId)
  const setProfile = useApp((s) => s.setProfile)
  const services = useApp((s) => s.services)
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => Date.now())

  const disconnect = (): void => {
    Alert.alert(
      DISCONNECT_LABEL,
      'Os dados serão apagados deste celular. Eles continuam na nuvem e nos PCs.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            if (!services) return
            setBusy(true)
            try {
              await services.runtime.engine.disable().catch(() => undefined)
            } finally {
              services.runtime.wipeLocal()
              setBusy(false)
            }
          }
        }
      ]
    )
  }

  const conflicts = status?.conflictCount ?? 0
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Card>
          <Text style={[styles.label, { color: theme.muted }]}>Este aparelho</Text>
          <Text style={{ color: theme.text }}>{status?.deviceName || '—'}</Text>
        </Card>
        <Card>
          <Text style={[styles.label, { color: theme.muted }]}>Sincronização</Text>
          {statusLines(status, readOnly, now).map((line) => (
            <Text key={line} style={{ color: theme.text }}>
              {line}
            </Text>
          ))}
          {conflicts > 0 ? (
            <Text style={{ color: theme.attention }}>{conflictsText(conflicts)}</Text>
          ) : null}
        </Card>
        <Card>
          <Text style={[styles.label, { color: theme.muted }]}>Perfil financeiro</Text>
          {profiles.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: p.id === profileId }}
              onPress={() => setProfile(p.id)}
              style={[styles.option, p.id === profileId && { backgroundColor: theme.selected }]}
            >
              <Text style={{ color: theme.text }}>{p.name}</Text>
            </Pressable>
          ))}
        </Card>
        <Button danger label={DISCONNECT_LABEL} onPress={disconnect} disabled={busy} />
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12 },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 6
  }
})
