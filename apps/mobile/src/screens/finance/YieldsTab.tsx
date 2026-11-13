import { formatCurrency } from '@sagyou/core/finance'
import { deleteYieldEntry, deleteYieldSource } from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialTable, YieldEntry, YieldSource } from '@sagyou/core/types'
import { TrendingUp } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { confirmDelete, deleteTitle } from '../../components/confirm'
import { ACTION_ICONS } from '../../components/icons'
import { useApp } from '../../store/app'
import { toBRDate } from '../../store/dates'
import { applyFinance, withYieldSummaries } from '../../store/finance'
import { FONT, SPACE, useTheme } from '../../theme'
import { Metric } from './Metric'
import { EntrySheet, SourceSheet } from './YieldSheet'

export const NO_SOURCES_TEXT =
  'Nenhuma fonte cadastrada. Adicione fontes de rendimento para começar.'
export const NO_YIELDS_TEXT = 'Nenhum rendimento neste mês.'
export const DELETE_SOURCE_NOTE = 'Os rendimentos registrados desta fonte também serão apagados.'

/** The entry's own words for a screen reader and the confirmation: "Dividendos em 05/11/2026". */
const entryName = (source: YieldSource | undefined, entry: YieldEntry): string =>
  `${source?.name ?? 'Rendimento'} em ${toBRDate(entry.date)}`

/**
 * Rendimentos of one table, for the month on screen: the sources with what each earned and its
 * entries of the month, "Lançar rendimento" and the source's rename/delete. Every write to an entry
 * also rebuilds that month's summary (`Rendimentos <Mês> <ano>`, day 1) in the same `commit`; deleting
 * a source takes its entries with it, as on the desktop. The summary transaction is read-only on the
 * phone (it lives in Lançamentos, locked): it is edited only through the entries.
 */
export function YieldsTab({
  table,
  month,
  today
}: {
  table: FinancialTable
  month: string
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [creatingSource, setCreatingSource] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const sources = table.yieldSources ?? []
  const entries = table.yieldEntries ?? []
  const monthEntries = entries.filter((e) => e.date.startsWith(month))
  const total = monthEntries.reduce((sum, e) => sum.plus(D(e.amount)), D(0))
  const renaming = sources.find((s) => s.id === renamingId)
  const editing = entries.find((e) => e.id === editingId)

  const removeEntry = (entry: YieldEntry, source: YieldSource | undefined): void =>
    confirmDelete(deleteTitle(`rendimento de ${entryName(source, entry)}`), () => {
      applyFinance((tables, now) =>
        withYieldSummaries(
          deleteYieldEntry(tables, table.id, entry.id, now),
          table.id,
          [entry.date],
          now
        )
      )
    })

  const removeSource = (source: YieldSource): void =>
    confirmDelete(
      deleteTitle(source.name),
      () => {
        applyFinance((tables, now) => {
          // The entries go with the source, in every month: each month they were in is summed again.
          const days = (tables.find((t) => t.id === table.id)?.yieldEntries ?? [])
            .filter((e) => e.sourceId === source.id)
            .map((e) => e.date)
          return withYieldSummaries(
            deleteYieldSource(tables, table.id, source.id, now),
            table.id,
            days,
            now
          )
        })
      },
      entries.some((e) => e.sourceId === source.id) ? DELETE_SOURCE_NOTE : undefined
    )

  return (
    <>
      <View testID="acoes-topo" style={styles.row}>
        <View testID="acao" style={styles.action}>
          <Button
            variant="secondary"
            icon={ACTION_ICONS.add}
            label="Nova fonte"
            onPress={() => setCreatingSource(true)}
            disabled={readOnly}
          />
        </View>
        <View testID="acao" style={styles.action}>
          <Button
            variant="primary"
            label="Lançar rendimento"
            onPress={() => setRecording(true)}
            disabled={readOnly || sources.length === 0}
          />
        </View>
      </View>

      {sources.length === 0 ? <EmptyState icon={TrendingUp} text={NO_SOURCES_TEXT} /> : null}

      {sources.length > 0 ? (
        <Card>
          <Metric
            testID="rendimentos-total"
            label="Total do mês"
            value={formatCurrency(total, table.currency)}
            color={theme.green}
          />
        </Card>
      ) : null}

      {sources.map((source) => {
        const own = monthEntries
          .filter((e) => e.sourceId === source.id)
          .sort((a, b) => b.date.localeCompare(a.date))
        const earned = own.reduce((sum, e) => sum.plus(D(e.amount)), D(0))
        return (
          <Card key={source.id}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[styles.name, { color: theme.text }]}
            >
              {source.name}
            </Text>
            <Metric
              testID={`fonte-${source.id}`}
              label="No mês"
              value={own.length > 0 ? formatCurrency(earned, table.currency) : '-'}
              color={own.length > 0 ? theme.green : theme.muted}
            />
            {own.length === 0 ? (
              <Text style={[styles.caption, { color: theme.muted }]}>{NO_YIELDS_TEXT}</Text>
            ) : null}
            {own.map((entry) => (
              <View key={entry.id} style={styles.entry}>
                <Text
                  testID={`entrada-${entry.id}`}
                  style={[styles.entryText, { color: theme.text }]}
                >
                  {toBRDate(entry.date)} · {formatCurrency(entry.amount, table.currency)}
                </Text>
                <View testID={`acoes-entrada-${entry.id}`} style={styles.row}>
                  <View testID="acao" style={styles.action}>
                    <Button
                      label="Editar"
                      a11yLabel={`Editar rendimento de ${entryName(source, entry)}`}
                      onPress={() => setEditingId(entry.id)}
                      disabled={readOnly}
                    />
                  </View>
                  <View testID="acao" style={styles.action}>
                    <Button
                      variant="danger"
                      label="Excluir"
                      a11yLabel={`Excluir rendimento de ${entryName(source, entry)}`}
                      onPress={() => removeEntry(entry, source)}
                      disabled={readOnly}
                    />
                  </View>
                </View>
              </View>
            ))}
            <View testID={`acoes-fonte-${source.id}`} style={styles.row}>
              <View testID="acao" style={styles.action}>
                <Button
                  label="Renomear"
                  a11yLabel={`Renomear ${source.name}`}
                  onPress={() => setRenamingId(source.id)}
                  disabled={readOnly}
                />
              </View>
              <View testID="acao" style={styles.action}>
                <Button
                  variant="danger"
                  label="Excluir fonte"
                  a11yLabel={`Excluir fonte ${source.name}`}
                  onPress={() => removeSource(source)}
                  disabled={readOnly}
                />
              </View>
            </View>
          </Card>
        )
      })}

      <SourceSheet
        visible={creatingSource}
        onClose={() => setCreatingSource(false)}
        table={table}
      />
      <SourceSheet
        visible={!!renaming}
        source={renaming}
        onClose={() => setRenamingId(null)}
        table={table}
      />
      <EntrySheet
        visible={recording}
        onClose={() => setRecording(false)}
        table={table}
        month={month}
        today={today}
      />
      <EntrySheet
        visible={!!editing}
        entry={editing}
        onClose={() => setEditingId(null)}
        table={table}
        month={month}
        today={today}
      />
    </>
  )
}

const styles = StyleSheet.create({
  // Wraps on a 360 dp phone: buttons of 112 dp+ no longer squeeze their labels.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  action: { flexGrow: 1, minWidth: 112 },
  name: { fontSize: FONT.bodyLg, fontWeight: '600' },
  caption: { fontSize: FONT.caption },
  entry: { gap: SPACE.xs },
  entryText: { fontSize: FONT.body, fontVariant: ['tabular-nums'] }
})
