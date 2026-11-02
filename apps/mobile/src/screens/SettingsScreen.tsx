import { useState, type ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ACTION_ICONS } from '../components/icons'
import { SYNC_GUIDE_LINK } from '../components/SyncGuideContent'
import { Button, Card, ListItem, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { useUpdate } from '../store/update'
import { conflictsText, statusLines } from '../sync/status-text'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'
import { availableText, DOWNLOAD_LABEL, openDownload, updateDeps } from '../update/actions'
import { installedVersion } from '../update/installed'

export const DISCONNECT_LABEL = 'Desconectar este aparelho'
export const CHECK_UPDATE_LABEL = 'Procurar atualização'
export const CHECKING_LABEL = 'Procurando…'
export const LATEST_TEXT = 'Você já está na versão mais recente.'
export const CHECK_ERROR_TEXT = 'Não foi possível verificar agora. Tente de novo mais tarde.'

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

/** "Versão do app": what is installed, and a check on demand. */
function VersionCard(): React.JSX.Element {
  const theme = useTheme()
  const repo = useApp((s) => s.services?.repo)
  const manual = useUpdate((s) => s.manual)
  const available = useUpdate((s) => s.available)
  const checking = manual === 'checking'
  return (
    <View style={{ gap: SPACE.sm }}>
      <Text
        style={[styles.value, { color: theme.text }]}
      >{`Instalada: ${installedVersion()}`}</Text>
      <Button
        label={checking ? CHECKING_LABEL : CHECK_UPDATE_LABEL}
        disabled={checking || !repo}
        onPress={() => {
          if (repo) void useUpdate.getState().manualCheck(updateDeps(repo))
        }}
      />
      <View accessibilityLiveRegion="polite" style={{ gap: SPACE.sm }}>
        {manual === 'latest' ? (
          <Text style={{ color: theme.text, fontSize: FONT.body }}>{LATEST_TEXT}</Text>
        ) : null}
        {manual === 'error' ? (
          <Text style={{ color: theme.attention, fontSize: FONT.body }}>{CHECK_ERROR_TEXT}</Text>
        ) : null}
        {manual === 'available' && available ? (
          <>
            <Text style={{ color: theme.text, fontSize: FONT.body }}>
              {availableText(available.version)}
            </Text>
            <Button
              variant="primary"
              label={DOWNLOAD_LABEL}
              a11yLabel={`Baixar a versão ${available.version}`}
              onPress={() => openDownload(available.url)}
            />
          </>
        ) : null}
      </View>
    </View>
  )
}

/** What the root stack hands the screen; absent when rendered alone (tests). */
export interface SettingsScreenProps {
  navigation?: { navigate(screen: 'Conflitos' | 'ComoFunciona'): void }
}

export function SettingsScreen({ navigation }: SettingsScreenProps = {}): React.JSX.Element {
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
          {conflicts > 0 && !readOnly ? (
            <ListItem
              title={conflictsText(conflicts)}
              a11yLabel={`${conflictsText(conflicts)}, ver e resolver`}
              right={<ACTION_ICONS.chevron size={18} color={theme.attention} />}
              onPress={() => navigation?.navigate('Conflitos')}
            />
          ) : null}
          <ListItem
            title={SYNC_GUIDE_LINK}
            right={<ACTION_ICONS.chevron size={18} color={theme.muted} />}
            onPress={() => navigation?.navigate('ComoFunciona')}
          />
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
        <Section title="Versão do app">
          <VersionCard />
        </Section>
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
