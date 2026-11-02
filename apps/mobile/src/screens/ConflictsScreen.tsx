import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { SyncConflictView, SyncVersionView } from '@sagyou/core/sync/engine'
import { recordName, syncKindLabel, versionLines, versionTimeText } from '@sagyou/core/sync/view'
import { ACTION_ICONS } from '../components/icons'
import { Button, Card, EmptyState, Screen, Snackbar } from '../components/ui'
import { useApp } from '../store/app'
import { FONT, RADIUS, SPACE, useTheme } from '../theme'

export const EMPTY_TITLE = 'Nenhum conflito'
export const EMPTY_TEXT =
  'Quando o mesmo item mudar em dois aparelhos, as duas versões aparecem aqui.'
export const ORPHAN_TEXT = 'Removido: o item de origem foi apagado em outro aparelho'
const SNACK_MS = 4000

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

/** One side of a conflict: when, which fields, and "Usar esta". */
function VersionCard({
  label,
  useLabel,
  version,
  busy,
  onUse
}: {
  label: string
  useLabel: string
  version: SyncVersionView
  busy: boolean
  onUse: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const time = versionTimeText(version.at)
  return (
    <View style={[styles.version, { borderColor: theme.border }]}>
      <View accessible accessibilityLabel={`${label}, ${time}`} style={styles.versionBody}>
        <Text style={[styles.caption, { color: theme.muted }]}>
          {label} · {time}
        </Text>
        {version.deleted || !version.payload ? (
          <Text style={[styles.body, { color: theme.red }]}>Apagado</Text>
        ) : (
          versionLines(version.payload).map((line) => (
            <Text key={line} style={[styles.body, { color: theme.text }]}>
              {line}
            </Text>
          ))
        )}
      </View>
      <Button
        variant="secondary"
        label="Usar esta"
        a11yLabel={useLabel}
        onPress={onUse}
        disabled={busy}
      />
    </View>
  )
}

/**
 * The conflicts this phone detected, as the desktop shows its own: both
 * versions side by side, or "Dispensar" when the item's parent is gone.
 */
export function ConflictsScreen(): React.JSX.Element {
  const theme = useTheme()
  const engine = useApp((s) => s.services?.runtime.engine)
  const status = useApp((s) => s.status)
  // Bumped after each choice so the list is read again from the engine.
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [snack, setSnack] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every published status (after each pull) may have closed some on its own.
  const conflicts = useMemo((): SyncConflictView[] => {
    void status
    void version
    if (!engine) return []
    try {
      return engine.conflicts()
    } catch {
      return []
    }
  }, [engine, status, version])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const show = (message: string): void => {
    setSnack(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSnack(null), SNACK_MS)
  }

  const resolve = async (conflict: SyncConflictView, choice: 'local' | 'remote'): Promise<void> => {
    if (!engine || busy) return
    setBusy(true)
    try {
      engine.resolve(conflict.id, choice)
      setVersion((v) => v + 1)
      show(conflict.type === 'orphan' ? 'Conflito dispensado.' : 'Versão escolhida.')
    } catch (cause) {
      show(messageOf(cause, 'Não foi possível usar esta versão.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Screen>
          {conflicts.length === 0 ? (
            <View style={styles.empty}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                {EMPTY_TITLE}
              </Text>
              <EmptyState icon={ACTION_ICONS.check} text={EMPTY_TEXT} />
            </View>
          ) : (
            conflicts.map((conflict) => {
              const name = recordName(conflict.remote.payload) ?? recordName(conflict.local.payload)
              const other = conflict.remote.deviceName
              return (
                <Card key={conflict.id}>
                  <Text style={[styles.title, { color: theme.text }]}>
                    {syncKindLabel(conflict.kind)}
                    {name ? `: ${name}` : ''}
                  </Text>
                  {conflict.type === 'orphan' ? (
                    <>
                      <Text style={[styles.body, { color: theme.attention }]}>{ORPHAN_TEXT}</Text>
                      <Button
                        variant="secondary"
                        label="Dispensar"
                        onPress={() => void resolve(conflict, 'local')}
                        disabled={busy}
                      />
                    </>
                  ) : (
                    <>
                      <VersionCard
                        label="Versão deste aparelho"
                        useLabel="Usar a versão deste aparelho"
                        version={conflict.local}
                        busy={busy}
                        onUse={() => void resolve(conflict, 'local')}
                      />
                      <VersionCard
                        label={`Versão de ${other}`}
                        useLabel={`Usar a versão de ${other}`}
                        version={conflict.remote}
                        busy={busy}
                        onUse={() => void resolve(conflict, 'remote')}
                      />
                    </>
                  )}
                </Card>
              )
            })
          )}
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
  empty: { alignItems: 'center', paddingTop: SPACE.xl },
  title: { fontSize: FONT.bodyLg, fontWeight: '600' },
  caption: { fontSize: FONT.caption },
  body: { fontSize: FONT.body },
  version: { borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md, gap: SPACE.sm },
  versionBody: { gap: 2 },
  snack: { position: 'absolute', left: SPACE.lg, right: SPACE.lg, bottom: SPACE.lg }
})
