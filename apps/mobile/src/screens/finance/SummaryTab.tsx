import { formatCurrency, tableBalance } from '@sagyou/core/finance'
import { categoryBreakdown, monthBounds } from '@sagyou/core/finance-views'
import { D } from '@sagyou/core/money'
import type { FinancialTable } from '@sagyou/core/types'
import { Wallet } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { monthSummary } from '../../store/finance'
import { FONT, RADIUS, SPACE, useTheme } from '../../theme'
import { ConsolidatedCards } from './ConsolidatedCards'
import { Metric } from './Metric'

export const NO_EXPENSES_TEXT = 'Nenhum gasto neste mês.'
export const NO_CATEGORY_TEXT = 'Sem categoria'

const BAR_HEIGHT = 8

/**
 * Resumo: for one table, the balance now and the projected one of the chosen month (the desktop's
 * cut: the current month stops at today, a past one at its end, the projected one counts the future
 * days already registered up to the end of the month), the month's income and expense, and the
 * expense per category, biggest first. With no `table` (the Consolidado) it is one card per currency.
 * ⚠️ The bars only draw what the text beside them already says: each row's value is written out.
 */
export function SummaryTab({
  table,
  tables,
  month,
  today
}: {
  table: FinancialTable | undefined
  /** The tables of the profile: where the Consolidado reads from. */
  tables: FinancialTable[]
  month: string
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  if (!table) return <ConsolidatedCards tables={tables} month={month} today={today} />

  const { currentCutoff, monthEnd } = monthBounds(month, today)
  const current = tableBalance(table.transactions, currentCutoff)
  const projected = tableBalance(table.transactions, monthEnd)
  const totals = monthSummary(table.transactions, `${month}-01`)
  const categories = categoryBreakdown(table.transactions, month)
  const biggest = categories.length > 0 ? D(categories[0].amount) : D(0)

  return (
    <>
      <Card>
        <View style={styles.row}>
          <Metric
            testID="saldo"
            label="Saldo atual"
            value={formatCurrency(current, table.currency)}
            color={current.gte(0) ? theme.text : theme.red}
          />
          <Metric
            testID="projetado"
            label="Saldo projetado"
            value={formatCurrency(projected, table.currency)}
            color={projected.gte(0) ? theme.purple : theme.red}
          />
        </View>
        <View style={styles.row}>
          <Metric
            testID="entradas"
            label="Entradas do mês"
            value={formatCurrency(totals.income, table.currency)}
            color={theme.green}
          />
          <Metric
            testID="saidas"
            label="Saídas do mês"
            value={formatCurrency(totals.expense, table.currency)}
            color={theme.red}
          />
        </View>
      </Card>

      <Card>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Gastos por categoria
        </Text>
        {categories.length === 0 ? (
          <EmptyState icon={Wallet} text={NO_EXPENSES_TEXT} />
        ) : (
          categories.map(({ category, amount }) => {
            const name = category || NO_CATEGORY_TEXT
            const value = formatCurrency(amount, table.currency)
            // Geometry only: the share of the biggest category, never a stored or shown amount.
            const share = biggest.gt(0) ? D(amount).div(biggest).times(100).toNumber() : 0
            return (
              <View
                key={category}
                testID="category-row"
                accessible
                accessibilityLabel={`${name}: ${value}`}
                style={styles.category}
              >
                <View style={styles.categoryText}>
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
                    {name}
                  </Text>
                  <Text style={[styles.amount, { color: theme.text }]}>{value}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: theme.selected }]}>
                  <View
                    testID="category-bar"
                    style={[
                      styles.bar,
                      { width: `${Math.max(share, 2)}%`, backgroundColor: theme.primary }
                    ]}
                  />
                </View>
              </View>
            )
          })
        )}
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACE.md },
  title: { fontSize: FONT.bodyLg, fontWeight: '600' },
  category: { gap: SPACE.xs },
  categoryText: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.md },
  name: { fontSize: FONT.body, flexShrink: 1 },
  amount: { fontSize: FONT.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: BAR_HEIGHT, borderRadius: RADIUS.pill, overflow: 'hidden' },
  bar: { height: BAR_HEIGHT, borderRadius: RADIUS.pill }
})
