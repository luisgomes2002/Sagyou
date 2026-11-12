import { todayLocalISO } from '@sagyou/core/dates'
import { formatCurrency, tableBalance } from '@sagyou/core/finance'
import { monthBounds } from '@sagyou/core/finance-views'
import type { FinancialTable, FinancialTransaction } from '@sagyou/core/types'
import { Wallet } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Skeleton } from '../components/Skeleton'
import { TransactionSheet } from '../components/TransactionSheet'
import { categoryIcon } from '../components/icons'
import { Button, Card, EmptyState, Screen } from '../components/ui'
import { awaitingFirstSync, useApp } from '../store/app'
import { toBRDate } from '../store/dates'
import {
  editLock,
  groupByDay,
  lastTablePref,
  monthSummary,
  tablesOfProfile
} from '../store/finance'
import { useUndo } from '../store/undo'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'
import { FinanceTabs } from './finance/FinanceTabs'
import { FinanceTop } from './finance/FinanceTop'
import { TableSheet } from './finance/TableSheet'
import type { FinanceTab } from './finance/tabs'

export const NO_TABLE_TEXT = 'Nenhuma tabela neste perfil.'
export const PICK_TABLE_TEXT = 'Escolha uma tabela para ver esta área.'

/**
 * Finanças: the top (table, month), the six areas as tabs and the chosen one. The table is
 * remembered per profile (`finance.lastTable.<perfil>`, which also accepts `'all'`, the
 * Consolidado); the month starts at the current one and the tab at Lançamentos, neither remembered.
 */
export function FinanceScreen({
  today = todayLocalISO(),
  initialTab = 'lancamentos'
}: {
  today?: string
  /** Only tests start elsewhere: in the app the tab always opens on Lançamentos. */
  initialTab?: FinanceTab
}): React.JSX.Element {
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const services = useApp((s) => s.services)
  const readOnly = useApp((s) => s.readOnly)
  const waiting = useApp((s) => awaitingFirstSync(s.status))
  const tables = tablesOfProfile(app, profileId)
  const [chosen, setChosen] = useState<string | null>(
    () => services?.repo.readPref(lastTablePref(profileId)) ?? null
  )
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [tab, setTab] = useState<FinanceTab>(initialTab)
  const [creating, setCreating] = useState(false)

  const choose = (id: string): void => {
    setChosen(id)
    services?.repo.writePref(lastTablePref(profileId), id)
  }

  if (tables.length === 0)
    return (
      <Screen>
        {waiting ? (
          <Skeleton />
        ) : (
          <>
            <EmptyState icon={Wallet} text={NO_TABLE_TEXT} />
            <Button
              variant="primary"
              label="Nova tabela"
              onPress={() => setCreating(true)}
              disabled={readOnly}
            />
            <TableSheet visible={creating} onClose={() => setCreating(false)} onCreated={choose} />
          </>
        )}
      </Screen>
    )

  const all = chosen === 'all'
  const table = all ? undefined : (tables.find((t) => t.id === chosen) ?? tables[0])

  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <FinanceTop
          tableId={table?.id ?? 'all'}
          onTable={choose}
          month={month}
          onMonth={setMonth}
          today={today}
        />
        <FinanceTabs value={tab} onChange={setTab} />
        <TabContent table={table} tab={tab} month={month} today={today} />
      </Screen>
    </ScrollView>
  )
}

/** Where each tab's own screen goes; the later ones replace these stand-ins. */
function TabContent({
  table,
  tab,
  month,
  today
}: {
  table: FinancialTable | undefined
  tab: FinanceTab
  month: string
  today: string
}): React.JSX.Element {
  if (!table) {
    // The Consolidado is read-only and has no table areas; its own views arrive in later tasks.
    const note =
      tab === 'lancamentos' || tab === 'resumo'
        ? 'O consolidado chega em breve ao celular.'
        : PICK_TABLE_TEXT
    return <EmptyState icon={Wallet} text={note} />
  }
  if (tab === 'lancamentos') return <TransactionsList table={table} month={month} today={today} />
  return <EmptyState icon={Wallet} text="Esta área chega em breve ao celular." />
}

/** The month of one table: the balance and totals at a glance, then its days. */
function TransactionsList({
  table,
  month,
  today
}: {
  table: FinancialTable
  month: string
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  const [editing, setEditing] = useState<FinancialTransaction | null>(null)
  const balance = tableBalance(table.transactions, monthBounds(month, today).currentCutoff)
  const monthTxs = table.transactions
    .filter((t) => t.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date))
  const totals = monthSummary(table.transactions, `${month}-01`)

  return (
    <>
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
                  const locked = editLock(table, tx)
                  if (locked) return useUndo.getState().show(locked)
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
                  <Text style={{ color: theme.text, fontSize: FONT.bodyLg }} numberOfLines={2}>
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
      <TransactionSheet
        visible={!!editing}
        type={editing?.type ?? 'expense'}
        tx={editing ?? undefined}
        tableId={table.id}
        onClose={() => setEditing(null)}
      />
    </>
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
