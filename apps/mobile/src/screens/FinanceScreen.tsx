import { todayLocalISO } from '@sagyou/core/dates'
import { formatCurrency, tableBalance } from '@sagyou/core/finance'
import type { FinancialTransaction } from '@sagyou/core/types'
import { Wallet } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Picker } from '../components/Picker'
import { TransactionSheet } from '../components/TransactionSheet'
import { categoryIcon } from '../components/icons'
import { Card, EmptyState, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { toBRDate } from '../store/dates'
import {
  LOCKED_TEXT,
  groupByDay,
  isLockedTransaction,
  lastTablePref,
  monthSummary,
  tablesOfProfile
} from '../store/finance'
import { useUndo } from '../store/undo'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

/** One table of the phone's profile at a time: the month at a glance, then its days. */
export function FinanceScreen({ today = todayLocalISO() }: { today?: string }): React.JSX.Element {
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const services = useApp((s) => s.services)
  const tables = tablesOfProfile(app, profileId)
  const [chosen, setChosen] = useState<string | null>(
    () => services?.repo.readPref(lastTablePref(profileId)) ?? null
  )
  const [editing, setEditing] = useState<FinancialTransaction | null>(null)
  const table = tables.find((t) => t.id === chosen) ?? tables[0]

  if (!table)
    return (
      <Screen>
        <EmptyState icon={Wallet} text="Nenhuma tabela neste perfil. Crie uma no Sagyou do PC." />
      </Screen>
    )

  const choose = (id: string): void => {
    setChosen(id)
    services?.repo.writePref(lastTablePref(profileId), id)
  }
  const balance = tableBalance(table.transactions, today)
  const month = today.slice(0, 7)
  const monthTxs = table.transactions
    .filter((t) => t.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date))
  const totals = monthSummary(table.transactions, today)

  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <Picker
          label="Tabela"
          value={table.id}
          options={tables.map((t) => ({ id: t.id, label: t.name }))}
          onChange={choose}
        />
        <Card>
          <Text style={[styles.caption, { color: theme.muted }]}>Saldo atual</Text>
          <Text
            testID="saldo"
            style={[styles.balance, { color: balance.gte(0) ? theme.text : theme.red }]}
          >
            {formatCurrency(balance, table.currency)}
          </Text>
          <View style={styles.totals}>
            <View style={styles.total}>
              <Text style={[styles.caption, { color: theme.muted }]}>Entradas do mês</Text>
              <Text testID="entradas" style={[styles.value, { color: theme.green }]}>
                {formatCurrency(totals.income, table.currency)}
              </Text>
            </View>
            <View style={styles.total}>
              <Text style={[styles.caption, { color: theme.muted }]}>Saídas do mês</Text>
              <Text testID="saidas" style={[styles.value, { color: theme.red }]}>
                {formatCurrency(totals.expense, table.currency)}
              </Text>
            </View>
          </View>
        </Card>
        {monthTxs.length === 0 ? (
          <EmptyState icon={Wallet} text="Nenhum lançamento neste mês." />
        ) : null}
        {groupByDay(monthTxs, today).map((group) => (
          <View key={group.day} style={styles.group}>
            <Text accessibilityRole="header" style={[styles.dayTitle, { color: theme.muted }]}>
              {group.label}
            </Text>
            {group.txs.map((tx) => {
              const Icon = categoryIcon(tx.category)
              const income = tx.type === 'income'
              return (
                <Pressable
                  key={tx.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${tx.description || tx.category || 'Lançamento'}, ${
                    income ? 'receita' : 'gasto'
                  } de ${formatCurrency(tx.amount, table.currency)}, ${toBRDate(tx.date)}`}
                  onPress={() => {
                    if (isLockedTransaction(table, tx)) return useUndo.getState().show(LOCKED_TEXT)
                    setEditing(tx)
                  }}
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
                    <Text style={{ color: theme.text, fontSize: FONT.bodyLg }} numberOfLines={1}>
                      {tx.description || tx.category || '—'}
                    </Text>
                    {tx.category && tx.description ? (
                      <Text style={[styles.caption, { color: theme.muted }]}>{tx.category}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.value, { color: income ? theme.green : theme.red }]}>
                    {income ? '+' : '−'}
                    {formatCurrency(tx.amount, table.currency)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ))}
      </Screen>
      <TransactionSheet
        visible={!!editing}
        type={editing?.type ?? 'expense'}
        tx={editing ?? undefined}
        tableId={table.id}
        onClose={() => setEditing(null)}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bottomRoom: { paddingBottom: 96 },
  caption: { fontSize: FONT.caption },
  balance: { fontSize: FONT.display, fontWeight: '700', fontVariant: ['tabular-nums'] },
  totals: { flexDirection: 'row', gap: SPACE.md },
  total: { flex: 1, gap: 2 },
  value: { fontSize: FONT.bodyLg, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
  }
})
