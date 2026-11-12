import { formatCurrency } from '@sagyou/core/finance'
import { deleteDebt } from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialDebt, FinancialTable } from '@sagyou/core/types'
import { format } from 'date-fns'
import { Wallet } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { confirmDelete, deleteTitle } from '../../components/confirm'
import { ACTION_ICONS } from '../../components/icons'
import { useApp } from '../../store/app'
import { toBRDate } from '../../store/dates'
import { applyFinance } from '../../store/finance'
import { FONT, SPACE, useTheme } from '../../theme'
import { DebtSheet } from './DebtSheet'
import { Metric } from './Metric'
import { ProgressBar } from './ProgressBar'

export const NO_DEBTS_TEXT = 'Nenhuma dívida nesta tabela.'

/** A debt with nothing left to pay (the desktop's rule: the remaining amount is zero). */
function isSettled(debt: FinancialDebt): boolean {
  return D(debt.remainingAmount).isZero()
}

/** The share already paid, 0..100: geometry for the bar, never a stored amount. */
function paidShare(debt: FinancialDebt): number {
  const original = D(debt.originalAmount)
  if (original.isZero()) return 0
  return Math.min(
    100,
    Math.max(0, original.minus(D(debt.remainingAmount)).div(original).times(100).toNumber())
  )
}

/** "Quitada em 20/10/2026": the day (local) the last payment settled it; old debts fall back to the last edit. */
function settledText(debt: FinancialDebt): string {
  const at = new Date(debt.completedAt ?? debt.updatedAt)
  return Number.isNaN(at.getTime()) ? 'Quitada' : `Quitada em ${toBRDate(format(at, 'yyyy-MM-dd'))}`
}

/**
 * Dívidas of one table: "Nova dívida", then the open ones (remaining, original, a bar, Pagar and
 * Excluir dívida) and, at the end, the settled ones with "Quitada em <data>". Paying and creating
 * go through the core in a single commit; deleting a debt keeps its payments as plain expenses.
 */
export function DebtsTab({
  table,
  today
}: {
  table: FinancialTable
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [creating, setCreating] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  const debts = table.debts ?? []
  const ordered = [...debts.filter((d) => !isSettled(d)), ...debts.filter(isSettled)]
  const paying = debts.find((d) => d.id === payingId)

  const remove = (debt: FinancialDebt): void =>
    confirmDelete(deleteTitle(debt.name), () => {
      applyFinance((tables, now) => deleteDebt(tables, table.id, debt.id, now))
    })

  return (
    <>
      <Button
        variant="secondary"
        icon={ACTION_ICONS.add}
        label="Nova dívida"
        onPress={() => setCreating(true)}
        disabled={readOnly}
      />

      {debts.length === 0 ? <EmptyState icon={Wallet} text={NO_DEBTS_TEXT} /> : null}

      {ordered.map((debt) => {
        const settled = isSettled(debt)
        return (
          <Card key={debt.id}>
            <View style={styles.head}>
              <Text
                accessibilityRole="header"
                numberOfLines={2}
                style={[styles.name, { color: theme.text }]}
              >
                {debt.name}
              </Text>
              {settled ? <Badge tone="green" text={settledText(debt)} /> : null}
            </View>
            <View style={styles.row}>
              {settled ? null : (
                <Metric
                  testID={`restante-${debt.id}`}
                  label="Restante"
                  value={formatCurrency(debt.remainingAmount, table.currency)}
                  color={theme.text}
                />
              )}
              <Metric
                testID={`original-${debt.id}`}
                label="Valor original"
                value={formatCurrency(debt.originalAmount, table.currency)}
                color={theme.text}
              />
            </View>
            <ProgressBar
              percent={paidShare(debt)}
              color={settled ? theme.green : theme.primary}
              label={`${debt.name}: ${Math.round(paidShare(debt))}% pago`}
            />
            <Text style={[styles.caption, { color: theme.muted }]}>
              Pago:{' '}
              {formatCurrency(
                D(debt.originalAmount).minus(D(debt.remainingAmount)),
                table.currency
              )}
            </Text>
            <View testID={`acoes-${debt.id}`} style={styles.actions}>
              {settled ? null : (
                <View testID="acao" style={styles.action}>
                  <Button
                    variant="primary"
                    label="Pagar"
                    a11yLabel={`Pagar ${debt.name}`}
                    onPress={() => setPayingId(debt.id)}
                    disabled={readOnly}
                  />
                </View>
              )}
              <View testID="acao" style={styles.action}>
                <Button
                  variant="danger"
                  label="Excluir dívida"
                  a11yLabel={`Excluir dívida ${debt.name}`}
                  onPress={() => remove(debt)}
                  disabled={readOnly}
                />
              </View>
            </View>
          </Card>
        )
      })}

      <DebtSheet
        visible={creating}
        onClose={() => setCreating(false)}
        table={table}
        today={today}
      />
      <DebtSheet
        visible={!!paying && !isSettled(paying)}
        debt={paying}
        onClose={() => setPayingId(null)}
        table={table}
        today={today}
      />
    </>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm
  },
  name: { fontSize: FONT.bodyLg, fontWeight: '600', flexShrink: 1 },
  row: { flexDirection: 'row', gap: SPACE.md },
  caption: { fontSize: FONT.caption },
  // Wraps on a 360 dp phone: two or three buttons of 112 dp+ no longer squeeze their labels.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  action: { flexGrow: 1, minWidth: 112 }
})
