import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { SyncConflictView } from '@sagyou/core/sync/engine'
import {
  compareConflict,
  conflictNames,
  conflictSummary,
  conflictTitle
} from '@sagyou/core/sync/conflict-view'
import { ACTION_ICONS } from '../components/icons'
import { Button, Card, EmptyState, Screen, Snackbar } from '../components/ui'
import { useApp } from '../store/app'
import { FONT, SPACE, useTheme } from '../theme'

export const EMPTY_TITLE = 'Nenhum conflito'
export const EMPTY_TEXT =
  'Quando o mesmo item mudar em dois aparelhos, as duas versões aparecem aqui.'
export const ORPHAN_TEXT = 'Removido: o item de origem foi apagado em outro aparelho'
const SNACK_MS = 4000

export interface ConflictsParams {
  /** What the comparison screen reports when it closes ("Versão escolhida."). */
  notice?: string
  at?: number
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

/**
 * The conflicts this phone detected (spec 2026-11-10): each one opens the
 * field-by-field comparison; an orphan is dismissed right here.
 */
export function ConflictsScreen({
  navigation,
  route
}: {
  navigation?: { navigate(screen: 'Conflito', params: { id: string }): void }
  route?: { params?: ConflictsParams }
}): React.JSX.Element {
  const theme = useTheme()
  const engine = useApp((s) => s.services?.runtime.engine)
  const status = useApp((s) => s.status)
  const readOnly = useApp((s) => s.readOnly)
  const data = useApp((s) => s.state)
  // Bumped after each choice so the list is read again from the engine.
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [snack, setSnack] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notice = route?.params?.notice
  const noticeAt = route?.params?.at
  // Every published status (after each pull) may have closed some on its own,
  // and coming back from the comparison means one was just decided.
  const conflicts = useMemo((): SyncConflictView[] => {
    void status
    void version
    void noticeAt
    if (!engine) return []
    try {
      return engine.conflicts()
    } catch {
      return []
    }
  }, [engine, status, version, noticeAt])
  const names = useMemo(() => conflictNames(data), [data])

  const show = (message: string): void => {
    setSnack(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSnack(null), SNACK_MS)
  }

  // The comparison's "Versão escolhida." shows here for a few seconds.
  const [noticeShownAt, setNoticeShownAt] = useState<number | undefined>()
  const routeNotice = notice && noticeAt !== noticeShownAt ? notice : null
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNoticeShownAt(noticeAt), SNACK_MS)
    return () => clearTimeout(t)
  }, [notice, noticeAt])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const dismiss = (conflict: SyncConflictView): void => {
    if (!engine || busy) return
    setBusy(true)
    try {
      engine.resolve(conflict.id, 'local')
      setVersion((v) => v + 1)
      show('Conflito dispensado.')
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
              const title = conflictTitle(conflict)
              if (conflict.type === 'orphan')
                return (
                  <Card key={conflict.id}>
                    <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
                    <Text style={[styles.body, { color: theme.attention }]}>{ORPHAN_TEXT}</Text>
                    <Button
                      variant="secondary"
                      label="Dispensar"
                      onPress={() => dismiss(conflict)}
                      disabled={busy || readOnly}
                    />
                  </Card>
                )
              const summary = conflictSummary(conflict, compareConflict(conflict, names))
              return (
                <Card
                  key={conflict.id}
                  a11yLabel={`${title}, ${summary}`}
                  onPress={
                    readOnly
                      ? undefined
                      : () => navigation?.navigate('Conflito', { id: conflict.id })
                  }
                >
                  <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
                  <Text style={[styles.caption, { color: theme.muted }]}>{summary}</Text>
                </Card>
              )
            })
          )}
        </Screen>
      </ScrollView>
      <View style={styles.snack}>
        <Snackbar visible={(snack ?? routeNotice) !== null} message={snack ?? routeNotice} />
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
  snack: { position: 'absolute', left: SPACE.lg, right: SPACE.lg, bottom: SPACE.lg }
})
