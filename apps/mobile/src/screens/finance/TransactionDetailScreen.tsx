import { formatCurrency } from '@sagyou/core/finance'
import { deleteTransaction } from '@sagyou/core/finance-actions'
import type { Currency, FinancialTransactionAudit } from '@sagyou/core/types'
import { format, parseISO } from 'date-fns'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Snackbar } from '../../components/Snackbar'
import { TransactionSheet } from '../../components/TransactionSheet'
import { confirmDelete, deleteTitle } from '../../components/confirm'
import { Screen } from '../../components/ui'
import { useApp } from '../../store/app'
import { toBRDate } from '../../store/dates'
import { applyFinance, deleteLock, editLock, isYieldSummary } from '../../store/finance'
import { FONT, SPACE, useTheme } from '../../theme'

export const DETAIL_TITLE = 'Lançamento'

const SNACK_MS = 4000
/** How many entries of the history are listed; the rest is only counted. */
const HISTORY_SHOWN = 20

const FIELD_NAMES: Record<string, string> = {
  description: 'Descrição',
  amount: 'Valor',
  date: 'Data',
  type: 'Tipo',
  category: 'Categoria',
  source: 'Origem',
  counterparty: 'Pessoa',
  bankReference: 'Referência',
  receiptFileIds: 'Comprovantes',
  reconciledAt: 'Conferido em',
  currencyTransferId: 'Vínculo de câmbio',
  currencyTransferFee: 'Tarifa',
  currencyTransferFeeCurrency: 'Moeda da tarifa',
  details: 'Itens da fatura'
}

/** "31/10/2026 12:30" for a timestamp, "31/10/2026" for a plain day. */
function whenText(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return toBRDate(value)
  const date = parseISO(value)
  return Number.isNaN(date.getTime()) ? value : format(date, 'dd/MM/yyyy HH:mm')
}

function valueText(field: string, value: unknown, currency: Currency): string {
  if (value === undefined || value === null || value === '') return 'vazio'
  if (field === 'amount') return formatCurrency(String(value), currency)
  if (field === 'date') return toBRDate(String(value))
  if (field === 'reconciledAt') return whenText(String(value))
  if (field === 'type') return value === 'income' ? 'Receita' : 'Gasto'
  return String(value)
}

/** One line of the history: "Valor: R$ 30,00 → R$ 50,00". */
function auditChangeText(
  change: FinancialTransactionAudit['changes'][number],
  currency: Currency
): string {
  const name = FIELD_NAMES[change.field] ?? change.field
  const isList = (value: unknown): boolean => typeof value === 'object' && value !== null
  if (isList(change.before) || isList(change.after)) return `${name} alterados`
  return `${name}: ${valueText(change.field, change.before, currency)} → ${valueText(
    change.field,
    change.after,
    currency
  )}`
}

/**
 * One transaction in full (stack route `Lancamento`): its fields, the items of an invoice, who and
 * where it came from, when it was created and checked, and the history of edits. **Editar** opens
 * the same form as before; **Excluir** asks first. A transaction the phone cannot change says so
 * instead of offering Editar (the Rendimentos summaries, which the Rendimentos tab owns, offer
 * neither). Opening and leaving writes nothing.
 */
export function TransactionDetailScreen({
  route,
  navigation
}: {
  route: { params: { tableId: string; txId: string } }
  navigation?: { goBack(): void }
}): React.JSX.Element | null {
  const theme = useTheme()
  const lists = useApp((s) => s.state.lists)
  const readOnly = useApp((s) => s.readOnly)
  const { tableId, txId } = route.params
  const [editing, setEditing] = useState(false)
  const [snack, setSnack] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const left = useRef(false)

  const table = lists.find((t) => t.id === tableId)
  const tx = table?.transactions.find((t) => t.id === txId)

  const leave = (): void => {
    if (left.current) return
    left.current = true
    navigation?.goBack()
  }
  // Deleted (here or on another device meanwhile): there is nothing left to show.
  useEffect(() => {
    if (!tx) leave()
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  if (!table || !tx) return null

  const show = (message: string): void => {
    setSnack(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSnack(null), SNACK_MS)
  }
  const yieldSummary = isYieldSummary(tx)
  const lockedEdit = editLock(lists, tx)
  const lockedDelete = deleteLock(lists, tx)
  const income = tx.type === 'income'
  const name = tx.description || tx.category || 'Lançamento'

  const remove = (): void => {
    if (lockedDelete) return show(lockedDelete)
    confirmDelete(deleteTitle(name), () => {
      const outcome = applyFinance((all, now) => deleteTransaction(all, table.id, tx.id, now), show)
      if (outcome.ok) leave()
    })
  }

  const audit = [...(tx.audit ?? [])].reverse()
  const rows: [string, string | undefined][] = [
    ['Tabela', table.name],
    ['Tipo', income ? 'Receita' : 'Gasto'],
    ['Data', toBRDate(tx.date)],
    ['Categoria', tx.category || undefined],
    ['Origem', tx.source || undefined],
    ['Pessoa', tx.counterparty || undefined],
    ['Referência', tx.bankReference || undefined],
    ['Criado em', tx.createdAt ? whenText(tx.createdAt) : undefined],
    ['Conferido em', tx.reconciledAt ? whenText(tx.reconciledAt) : undefined]
  ]

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Screen>
          <Card>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.text }]}
              numberOfLines={3}
            >
              {name}
            </Text>
            <Text
              testID="valor"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[styles.amount, { color: income ? theme.green : theme.red }]}
            >
              {income ? '+' : '−'}
              {formatCurrency(tx.amount, table.currency)}
            </Text>
          </Card>

          {yieldSummary ? (
            <Text style={[styles.body, { color: theme.muted }]}>{lockedEdit}</Text>
          ) : (
            <View style={styles.actions}>
              {lockedEdit ? (
                <Text style={[styles.body, { color: theme.muted }]}>{lockedEdit}</Text>
              ) : (
                <Button
                  variant="primary"
                  label="Editar"
                  onPress={() => setEditing(true)}
                  disabled={readOnly}
                />
              )}
              <Button variant="danger" label="Excluir" onPress={remove} disabled={readOnly} />
            </View>
          )}

          <Card>
            {rows.map(([label, value]) =>
              value ? (
                <View key={label} style={styles.row}>
                  <Text style={[styles.caption, { color: theme.muted }]}>{label}</Text>
                  <Text style={[styles.body, { color: theme.text }]}>{value}</Text>
                </View>
              ) : null
            )}
          </Card>

          {tx.details?.length ? (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
                Itens da fatura
              </Text>
              <Card>
                {tx.details.map((item) => (
                  <View key={item.id} style={styles.item}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.body, { color: theme.text }]}>{item.description}</Text>
                      {item.category || item.date ? (
                        <Text style={[styles.caption, { color: theme.muted }]}>
                          {[item.category, item.date ? toBRDate(item.date) : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.body, styles.number, { color: theme.text }]}>
                      {formatCurrency(item.amount, table.currency)}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {audit.length > 0 ? (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
                Histórico de alterações
              </Text>
              <Card>
                {audit.slice(0, HISTORY_SHOWN).map((entry, index) => (
                  <View key={`${entry.at}-${index}`} style={styles.row}>
                    <Text style={[styles.caption, { color: theme.muted }]}>
                      {whenText(entry.at)}
                    </Text>
                    <Text style={[styles.body, { color: theme.text }]}>
                      {entry.changes.map((c) => auditChangeText(c, table.currency)).join('; ')}
                    </Text>
                  </View>
                ))}
                {audit.length > HISTORY_SHOWN ? (
                  <Text style={[styles.caption, { color: theme.muted }]}>
                    e mais {audit.length - HISTORY_SHOWN} alterações antigas
                  </Text>
                ) : null}
              </Card>
            </View>
          ) : null}
        </Screen>
      </ScrollView>

      <View style={styles.snack}>
        <Snackbar visible={snack !== null} message={snack} />
      </View>
      <TransactionSheet
        visible={editing}
        type={tx.type}
        tx={tx}
        tableId={table.id}
        onClose={() => setEditing(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  title: { fontSize: FONT.title, fontWeight: '600' },
  amount: { fontSize: FONT.display, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heading: { fontSize: FONT.bodyLg, fontWeight: '600' },
  body: { fontSize: FONT.body },
  caption: { fontSize: FONT.caption },
  number: { fontVariant: ['tabular-nums'] },
  actions: { gap: SPACE.sm },
  section: { gap: SPACE.sm },
  row: { gap: 2, paddingVertical: SPACE.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs },
  snack: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }
})
