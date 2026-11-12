import { formatCurrency } from '@sagyou/core/finance'
import { consolidatedByCurrency } from '@sagyou/core/finance-views'
import { D } from '@sagyou/core/money'
import { CURRENCY_CONFIG, type FinancialTable } from '@sagyou/core/types'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '../../components/Card'
import { FONT, SPACE, useTheme } from '../../theme'
import { Metric } from './Metric'

/**
 * The Consolidado: one card per currency of the profile's tables (balance now, projected balance,
 * income and expense of the month). ⚠️ Currencies are never added together or converted: the
 * numbers of BRL and JPY sit in their own cards. Linked mirrors stay out of every total (core).
 */
export function ConsolidatedCards({
  tables,
  month,
  today
}: {
  tables: FinancialTable[]
  month: string
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <>
      {consolidatedByCurrency(tables, month, today).map((summary) => {
        const { currency } = summary
        const tone = (value: string, positive: string): string =>
          D(value).gte(0) ? positive : theme.red
        return (
          <Card key={currency}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {`${CURRENCY_CONFIG[currency].label} (${currency})`}
            </Text>
            <View style={styles.row}>
              <Metric
                testID={`saldo-${currency}`}
                label="Saldo atual"
                value={formatCurrency(summary.current, currency)}
                color={tone(summary.current, theme.text)}
              />
              <Metric
                testID={`projetado-${currency}`}
                label="Saldo projetado"
                value={formatCurrency(summary.projected, currency)}
                color={tone(summary.projected, theme.purple)}
              />
            </View>
            <View style={styles.row}>
              <Metric
                testID={`entradas-${currency}`}
                label="Entradas do mês"
                value={formatCurrency(summary.income, currency)}
                color={theme.green}
              />
              <Metric
                testID={`saidas-${currency}`}
                label="Saídas do mês"
                value={formatCurrency(summary.expense, currency)}
                color={theme.red}
              />
            </View>
          </Card>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: FONT.bodyLg, fontWeight: '600' },
  row: { flexDirection: 'row', gap: SPACE.md }
})
