import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ConflictChoice, SyncConflictView } from '@sagyou/core/sync/engine'
import {
  CONFLICT_TEXTS,
  compareConflict,
  conflictNames,
  conflictTitle,
  currentHlcOf,
  type FieldRow,
  type FieldValue,
  type Side
} from '@sagyou/core/sync/conflict-view'
import { versionTimeText } from '@sagyou/core/sync/view'
import { Button, Card, Screen, Snackbar } from '../components/ui'
import { useLockState } from '../lock/lockState'
import { useApp } from '../store/app'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme, type Theme } from '../theme'
import type { ConflictsParams } from './ConflictsScreen'

const SIDES: readonly Side[] = ['local', 'remote']
const SNACK_MS = 4000
const CHOSEN = 'Versão escolhida.'

interface Nav {
  goBack(): void
  navigate(screen: 'Conflitos', params: ConflictsParams): void
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function deviceOf(conflict: SyncConflictView, side: Side): string {
  return side === 'local' ? CONFLICT_TEXTS.thisDevice : conflict.remote.deviceName
}

/** "Descrição: usar a de PC de casa" / "Descrição: usar a deste aparelho". */
function radioLabel(row: FieldRow, conflict: SyncConflictView, side: Side): string {
  return side === 'local'
    ? `${row.label}: usar a deste aparelho`
    : `${row.label}: usar a de ${conflict.remote.deviceName}`
}

/** What a screen reader hears after the radio's label: the value itself. */
function hintOf(value: FieldValue): string {
  return value.segments ? `${CONFLICT_TEXTS.diffHint}: ${value.text}` : value.text
}

function Value({ value, theme }: { value: FieldValue; theme: Theme }): React.JSX.Element {
  if (!value.segments) return <Text style={[styles.body, { color: theme.text }]}>{value.text}</Text>
  return (
    <Text
      accessibilityLabel={`${CONFLICT_TEXTS.diffHint}: ${value.text}`}
      style={[styles.body, { color: theme.text }]}
    >
      {value.segments.map((segment, i) =>
        segment.changed ? (
          <Text
            key={i}
            style={{
              backgroundColor: theme.selected,
              color: theme.attention,
              textDecorationLine: 'underline'
            }}
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={i}>{segment.text}</Text>
        )
      )}
    </Text>
  )
}

/**
 * One conflict compared field by field (spec 2026-11-10): pick a side per
 * differing field, or keep a whole version. The engine writes the choice.
 */
export function ConflictScreen({
  route,
  navigation
}: {
  route: { params: { id: string } }
  navigation?: Nav
}): React.JSX.Element | null {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const engine = useApp((s) => s.services?.runtime.engine)
  const status = useApp((s) => s.status)
  const readOnly = useApp((s) => s.readOnly)
  const data = useApp((s) => s.state)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [showEqual, setShowEqual] = useState(false)
  const [snack, setSnack] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const left = useRef(false)
  const id = route.params.id

  const conflict = useMemo((): SyncConflictView | null => {
    void status
    void version
    if (!engine) return null
    try {
      return engine.conflicts().find((c) => c.id === id) ?? null
    } catch {
      return null
    }
  }, [engine, status, version, id])
  const names = useMemo(() => conflictNames(data), [data])
  const cmp = useMemo(() => (conflict ? compareConflict(conflict, names) : null), [conflict, names])
  const signature = conflict ? `${conflict.local.hlc}|${conflict.remote.hlc}` : ''
  const [pick, setPick] = useState<{ signature: string; fields: Record<string, Side> }>({
    signature: '',
    fields: {}
  })
  const picked = pick.signature === signature ? pick.fields : (cmp?.initial ?? {})

  const leave = (notice: string): void => {
    if (left.current) return
    left.current = true
    navigation?.navigate('Conflitos', { notice, at: Date.now() })
  }

  // Closed on its own (a newer version arrived from where it was decided).
  useEffect(() => {
    if (engine && !conflict) leave(CONFLICT_TEXTS.alreadyResolved)
  })
  // Locked, in the background or read-only: nothing is chosen from here.
  useEffect(() => {
    if (readOnly) navigation?.goBack()
  }, [readOnly, navigation])
  useEffect(
    () =>
      useLockState.subscribe((state) => {
        if (state.hidden) navigation?.goBack()
      }),
    [navigation]
  )
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  if (!conflict || !cmp) return null

  const show = (message: string): void => {
    setSnack(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSnack(null), SNACK_MS)
  }

  const resolve = (choice: ConflictChoice): void => {
    if (!engine || busy) return
    setBusy(true)
    try {
      engine.resolve(conflict.id, choice)
      leave(CHOSEN)
    } catch (cause) {
      const message = messageOf(cause, 'Não foi possível usar esta versão.')
      if (message === CONFLICT_TEXTS.alreadyResolved) leave(message)
      else {
        if (message === CONFLICT_TEXTS.changed) setVersion((v) => v + 1)
        show(message)
      }
    } finally {
      setBusy(false)
    }
  }
  const allFrom = (side: Side): ConflictChoice => ({
    fields: Object.fromEntries(cmp.differing.map((row) => [row.field, side])),
    expectedHlc: currentHlcOf(conflict)
  })

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Screen>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {conflictTitle(conflict)}
          </Text>
          <Text style={[styles.caption, { color: theme.muted }]}>{CONFLICT_TEXTS.explain}</Text>

          <Card>
            {SIDES.map((side) => (
              <View key={side} style={styles.sideRow}>
                <Text style={[styles.caption, { color: theme.text }]}>
                  {deviceOf(conflict, side)} · {versionTimeText(conflict[side].at)}
                </Text>
                {cmp.newer === side && (
                  <Text
                    style={[styles.badge, { backgroundColor: theme.selected, color: theme.purple }]}
                  >
                    {CONFLICT_TEXTS.newer}
                  </Text>
                )}
                {(conflict[side].deleted || !conflict[side].payload) && (
                  <Text style={[styles.caption, { color: theme.red }]}>
                    {CONFLICT_TEXTS.deleted}
                  </Text>
                )}
              </View>
            ))}
          </Card>

          {cmp.differing.map((row) => (
            <View key={row.field} style={styles.field}>
              <Text style={[styles.label, { color: theme.text }]}>{row.label}</Text>
              {SIDES.map((side) => {
                const other: Side = side === 'local' ? 'remote' : 'local'
                const only = row[side].present && !row[other].present
                const body = (
                  <>
                    <Text style={[styles.caption, { color: theme.muted }]}>
                      {deviceOf(conflict, side)}
                      {only ? (
                        <Text style={{ color: theme.attention }}>
                          {'  '}
                          {CONFLICT_TEXTS.onlyIn(deviceOf(conflict, side))}
                        </Text>
                      ) : null}
                    </Text>
                    <Value value={row[side]} theme={theme} />
                  </>
                )
                if (!cmp.choosable)
                  return (
                    <View key={side} style={[styles.option, { borderColor: theme.border }]}>
                      {body}
                    </View>
                  )
                const checked = picked[row.field] === side
                return (
                  <Pressable
                    key={side}
                    accessibilityRole="radio"
                    accessibilityLabel={radioLabel(row, conflict, side)}
                    accessibilityHint={hintOf(row[side])}
                    accessibilityState={{ checked, disabled: busy }}
                    disabled={busy}
                    onPress={() => setPick({ signature, fields: { ...picked, [row.field]: side } })}
                    style={[
                      styles.option,
                      {
                        borderColor: checked ? theme.primary : theme.border,
                        backgroundColor: checked ? theme.selected : theme.surface
                      }
                    ]}
                  >
                    {body}
                  </Pressable>
                )
              })}
              {row.field === 'timeSpent' && cmp.timeNote && (
                <Text style={[styles.caption, { color: theme.attention }]}>
                  {CONFLICT_TEXTS.timeNote}
                </Text>
              )}
            </View>
          ))}

          {cmp.equal.length > 0 && (
            <View style={styles.field}>
              <Button
                variant="ghost"
                label={CONFLICT_TEXTS.equalSection(cmp.equal.length)}
                onPress={() => setShowEqual((v) => !v)}
              />
              {showEqual &&
                cmp.equal.map((row) => (
                  <View key={row.field} style={styles.equalRow}>
                    <Text style={[styles.caption, { color: theme.muted }]}>{row.label}</Text>
                    <Text style={[styles.body, { color: theme.text }]}>{row.local.text}</Text>
                  </View>
                ))}
            </View>
          )}

          {cmp.choosable && (
            <View style={styles.field}>
              {cmp.newer && (
                <Button
                  variant="secondary"
                  label={CONFLICT_TEXTS.keepNewer}
                  onPress={() => resolve(allFrom(cmp.newer as Side))}
                  disabled={busy}
                />
              )}
              {cmp.newer !== 'local' && (
                <Button
                  variant="secondary"
                  label={CONFLICT_TEXTS.keepThis}
                  onPress={() => resolve(allFrom('local'))}
                  disabled={busy}
                />
              )}
              {cmp.newer !== 'remote' && (
                <Button
                  variant="secondary"
                  label={CONFLICT_TEXTS.keepOther(conflict.remote.deviceName)}
                  onPress={() => resolve(allFrom('remote'))}
                  disabled={busy}
                />
              )}
            </View>
          )}
        </Screen>
      </ScrollView>

      <View style={styles.snack}>
        <Snackbar visible={snack !== null} message={snack} />
      </View>
      <View
        testID="conflict-footer"
        style={[
          styles.footer,
          {
            borderColor: theme.border,
            backgroundColor: theme.bg,
            paddingBottom: SPACE.lg + insets.bottom
          }
        ]}
      >
        {cmp.choosable ? (
          <Button
            label={CONFLICT_TEXTS.save}
            onPress={() => resolve({ fields: picked, expectedHlc: currentHlcOf(conflict) })}
            disabled={busy}
          />
        ) : (
          <>
            <Button
              variant="secondary"
              label={CONFLICT_TEXTS.pickThis}
              onPress={() => resolve('local')}
              disabled={busy}
            />
            <Button
              variant="secondary"
              label={CONFLICT_TEXTS.pickOther(conflict.remote.deviceName)}
              onPress={() => resolve('remote')}
              disabled={busy}
            />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  title: { fontSize: FONT.bodyLg, fontWeight: '600' },
  label: { fontSize: FONT.body, fontWeight: '600' },
  caption: { fontSize: FONT.caption },
  body: { fontSize: FONT.body },
  badge: {
    fontSize: FONT.caption,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2
  },
  sideRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm },
  field: { gap: SPACE.sm },
  option: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    padding: SPACE.md,
    gap: SPACE.xs
  },
  equalRow: { gap: 2 },
  footer: { padding: SPACE.lg, gap: SPACE.sm, borderTopWidth: 1 },
  snack: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }
})
