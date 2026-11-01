import { useState, type ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { conflictsText, statusLines } from '../sync/status-text'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

export const DISCONNECT_LABEL = 'Desconectar este aparelho'

function Section({
  title,
  children,
  testID
}: {
  title: string
  children: ReactNode
  testID?: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View testID={testID} style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.muted }]}>
        {title}
      </Text>
      <Card>{children}</Card>
    </View>
  )
}

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
  const lines = statusLines(status, readOnly, now)
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Section title="Este aparelho">
          <Text style={[styles.value, { color: theme.text }]}>{status?.deviceName || '—'}</Text>
        </Section>
        <Section title="Sincronização">
          {lines.length === 0 ? <Text style={{ color: theme.muted }}>—</Text> : null}
          {lines.map((line) => (
            <Text key={line} style={[styles.value, { color: theme.text }]}>
              {line}
            </Text>
          ))}
          {conflicts > 0 ? (
            <Text style={{ color: theme.attention, fontSize: FONT.body }}>
              {conflictsText(conflicts)}
            </Text>
          ) : null}
        </Section>
        <Section title="Perfil financeiro">
          <View accessibilityRole="radiogroup">
            {profiles.map((p) => {
              const checked = p.id === profileId
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityLabel={p.name}
                  accessibilityState={{ checked }}
                  onPress={() => setProfile(p.id)}
                  style={[styles.option, checked && { backgroundColor: theme.selected }]}
                >
                  <View
                    style={[
                      styles.radio,
                      { borderColor: checked ? theme.purple : theme.border },
                      checked && { borderWidth: 6 }
                    ]}
                  />
                  <Text style={[styles.value, { color: theme.text }]}>{p.name}</Text>
                </Pressable>
              )
            })}
          </View>
        </Section>
        {/* Versão do app: spec mobile-releases */}
        <Section title="Zona de perigo" testID="zona-de-perigo">
          <Text style={{ color: theme.muted, fontSize: FONT.body }}>
            Apaga os dados deste celular. Eles continuam na nuvem e nos PCs.
          </Text>
          <Button variant="danger" label={DISCONNECT_LABEL} onPress={disconnect} disabled={busy} />
        </Section>
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm },
  sectionTitle: { fontSize: FONT.caption, fontWeight: '600', textTransform: 'uppercase' },
  value: { fontSize: FONT.bodyLg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: MIN_TOUCH,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.control
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 }
})
