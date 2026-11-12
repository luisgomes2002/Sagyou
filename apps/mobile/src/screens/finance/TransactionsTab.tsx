import { formatCurrency, tableBalance } from '@sagyou/core/finance'
import { monthBounds } from '@sagyou/core/finance-views'
import type { FinancialTable, FinancialTransaction } from '@sagyou/core/types'
import { Wallet } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { Field } from '../../components/Field'
import { categoryIcon } from '../../components/icons'
import { toBRDate } from '../../store/dates'
import { groupByDay, monthSummary } from '../../store/finance'
import {
  NO_TRANSACTION_FILTER,
  TRANSACTION_FILTER_TEXTS,
  TYPE_OPTIONS,
  filterTransactions,
  isFiltering,
  monthCategories,
  type TransactionFilter
} from '../../store/transactionFilters'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'

type Open = 'type' | 'category' | null

/**
 * Lançamentos: the month of one table (its balance and totals at a glance) or, with no `table`, of
 * every table of the profile (the Consolidado, which has no balance here and names each row's
 * table), then the search and the Tipo/Categoria chips, then the days. A row opens its details;
 * nothing is written from the list.
 */
export function TransactionsTab({
  table,
  tables,
  month,
  today,
  onOpen
}: {
  table: FinancialTable | undefined
  /** The tables of the profile: where the Consolidado reads from. */
  tables: FinancialTable[]
  month: string
  today: string
  onOpen: (tableId: string, txId: string) => void
}): React.JSX.Element {
  const theme = useTheme()
  const [filter, setFilter] = useState<TransactionFilter>(NO_TRANSACTION_FILTER)
  const [open, setOpen] = useState<Open>(null)

  const scope = table ? [table] : tables
  const owner = new Map<FinancialTransaction, FinancialTable>()
  for (const t of scope) for (const tx of t.transactions) owner.set(tx, t)
  const monthTxs = [...owner.keys()].filter((tx) => tx.date.startsWith(month))
  const shown = filterTransactions(monthTxs, filter).sort((a, b) => b.date.localeCompare(a.date))
  const categories = monthCategories(monthTxs)
  const categoryOptions = [
    TRANSACTION_FILTER_TEXTS.allCategories,
    ...(filter.category !== 'all' && !categories.includes(filter.category)
      ? [filter.category]
      : []),
    ...categories
  ]

  const balance = table
    ? tableBalance(table.transactions, monthBounds(month, today).currentCutoff)
    : null
  const totals = table ? monthSummary(table.transactions, `${month}-01`) : null
  const typeLabel = TYPE_OPTIONS.find((o) => o.value === filter.type)?.label ?? ''
  const categoryLabel =
    filter.category === 'all' ? TRANSACTION_FILTER_TEXTS.allCategories : filter.category

  return (
    <>
      {table && balance && totals ? (
        <Card>
          <Text style={[styles.caption, { color: theme.muted }]}>Saldo atual</Text>
          <Text
            testID="saldo"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            style={[styles.balance, { color: balance.gte(0) ? theme.text : theme.red }]}
          >
            {formatCurrency(balance, table.currency)}
          </Text>
          <View style={styles.totals}>
            <View style={styles.total}>
              <Text style={[styles.caption, { color: theme.muted }]}>Entradas do mês</Text>
              <Text
                testID="entradas"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.value, { color: theme.green }]}
              >
                {formatCurrency(totals.income, table.currency)}
              </Text>
            </View>
            <View style={styles.total}>
              <Text style={[styles.caption, { color: theme.muted }]}>Saídas do mês</Text>
              <Text
                testID="saidas"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.value, { color: theme.red }]}
              >
                {formatCurrency(totals.expense, table.currency)}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <Field
        label={TRANSACTION_FILTER_TEXTS.search}
        value={filter.query}
        onChangeText={(query) => setFilter({ ...filter, query })}
        returnKeyType="search"
        autoCorrect={false}
      />
      <View style={styles.chips}>
        <Chip
          label={`Tipo: ${typeLabel}`}
          selected={filter.type !== 'all'}
          onPress={() => setOpen('type')}
        />
        <Chip
          label={`Categoria: ${categoryLabel}`}
          selected={filter.category !== 'all'}
          onPress={() => setOpen('category')}
        />
      </View>

      {monthTxs.length === 0 ? (
        <EmptyState icon={Wallet} text={TRANSACTION_FILTER_TEXTS.emptyMonth} />
      ) : shown.length === 0 ? (
        <>
          <EmptyState icon={Wallet} text={TRANSACTION_FILTER_TEXTS.noMatch} />
          {isFiltering(filter) ? (
            <Button
              variant="secondary"
              label={TRANSACTION_FILTER_TEXTS.clear}
              onPress={() => setFilter(NO_TRANSACTION_FILTER)}
            />
          ) : null}
        </>
      ) : null}

      {groupByDay(shown, today).map((group) => (
        <View key={group.day} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.dayTitle, { color: theme.muted }]}>
            {group.label}
          </Text>
          {group.txs.map((tx) => {
            const home = owner.get(tx) as FinancialTable
            const Icon = categoryIcon(tx.category)
            const income = tx.type === 'income'
            const name = tx.description || tx.category || 'Lançamento'
            return (
              <Pressable
                key={`${home.id}:${tx.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${income ? 'receita' : 'gasto'} de ${formatCurrency(
                  tx.amount,
                  home.currency
                )}, ${toBRDate(tx.date)}${table ? '' : `, ${home.name}`}`}
                onPress={() => onOpen(home.id, tx.id)}
                style={({ pressed }) => [
                  styles.tx,
                  {
                    backgroundColor: pressed ? theme.selected : theme.surface,
                    borderColor: theme.border
                  }
                ]}
              >
                <View
                  testID={`cat-${tx.category || 'none'}`}
                  style={[styles.icon, { backgroundColor: theme.selected }]}
                >
                  <Icon size={18} color={theme.onSurfaceIcon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: FONT.bodyLg }} numberOfLines={2}>
                    {tx.description || tx.category || '—'}
                  </Text>
                  {!table ? (
                    <Text testID="tx-table" style={[styles.caption, { color: theme.muted }]}>
                      {home.name}
                    </Text>
                  ) : null}
                  {tx.category && tx.description ? (
                    <Text style={[styles.caption, { color: theme.muted }]}>{tx.category}</Text>
                  ) : null}
                </View>
                <Text style={[styles.value, { color: income ? theme.green : theme.red }]}>
                  {income ? '+' : '−'}
                  {formatCurrency(tx.amount, home.currency)}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ))}

      <BottomSheet
        visible={open !== null}
        onClose={() => setOpen(null)}
        title={open === 'type' ? 'Tipo' : 'Categoria'}
      >
        {open === 'type'
          ? TYPE_OPTIONS.map((option) => (
              <RadioOption
                key={option.value}
                label={option.label}
                checked={filter.type === option.value}
                onPress={() => {
                  setFilter({ ...filter, type: option.value })
                  setOpen(null)
                }}
              />
            ))
          : open === 'category'
            ? categoryOptions.map((label, index) => {
                const value = index === 0 ? 'all' : label
                return (
                  <RadioOption
                    key={`${index}:${label}`}
                    label={label}
                    checked={filter.category === value}
                    onPress={() => {
                      setFilter({ ...filter, category: value })
                      setOpen(null)
                    }}
                  />
                )
              })
            : null}
      </BottomSheet>
    </>
  )
}

/** One option of a filter sheet: a radio whose pick shows by shape too, not only by colour. */
function RadioOption({
  label,
  checked,
  onPress
}: {
  label: string
  checked: boolean
  onPress: () => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[
        styles.option,
        {
          backgroundColor: checked ? theme.selected : theme.surface,
          borderColor: checked ? theme.primary : theme.border
        }
      ]}
    >
      <View
        testID={checked ? 'radio-on' : 'radio-off'}
        style={[styles.ring, { borderColor: checked ? theme.primary : theme.muted }]}
      >
        {checked ? <View style={[styles.dot, { backgroundColor: theme.primary }]} /> : null}
      </View>
      <Text style={[styles.optionText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  caption: { fontSize: FONT.caption },
  balance: { fontSize: FONT.display, fontWeight: '700', fontVariant: ['tabular-nums'] },
  totals: { flexDirection: 'row', gap: SPACE.md },
  total: { flex: 1, gap: 2 },
  value: { fontSize: FONT.bodyLg, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  group: { gap: SPACE.sm },
  dayTitle: { fontSize: FONT.caption, fontWeight: '600', textTransform: 'uppercase' },
  tx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    minHeight: MIN_TOUCH
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  option: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    marginBottom: SPACE.sm
  },
  optionText: { fontSize: FONT.body, flexShrink: 1 },
  ring: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dot: { width: 10, height: 10, borderRadius: 5 }
})
