import { todayLocalISO } from '@sagyou/core/dates'
import {
  financialCategories,
  formatAmountInput,
  formatCurrency,
  tableBalance
} from '@sagyou/core/finance'
import type { FinancialTable, FinancialTransaction } from '@sagyou/core/types'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Chip, Field, Row, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { DATE_FORMAT_ERROR, parseBRDate, toBRDate } from '../store/dates'
import {
  INVALID_AMOUNT_TEXT,
  LOCKED_TEXT,
  addTransaction,
  isLockedTransaction,
  lastTablePref,
  parseAmount,
  tablesOfProfile,
  updateTransaction
} from '../store/finance'
import { useTheme } from '../theme'

type Form = { type: 'income' | 'expense'; tx?: FinancialTransaction } | null

function TransactionForm({
  table,
  form,
  onDone
}: {
  table: FinancialTable
  form: NonNullable<Form>
  onDone: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const { tx } = form
  const [amount, setAmount] = useState(tx ? formatAmountInput(tx.amount, table.currency) : '')
  const [date, setDate] = useState(toBRDate(tx?.date ?? todayLocalISO()))
  const [category, setCategory] = useState(tx?.category ?? '')
  const [description, setDescription] = useState(tx?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const categories = financialCategories(
    app.financialProfiles.find((p) => p.id === profileId),
    tablesOfProfile(app, profileId)
  )

  const save = (): void => {
    const value = parseAmount(amount, table.currency)
    if (!value) return setError(INVALID_AMOUNT_TEXT)
    const iso = parseBRDate(date)
    if (!iso) return setError(DATE_FORMAT_ERROR)
    const current = useApp.getState().state
    const now = new Date()
    // "Last table used" means last table a transaction was saved in, too.
    const done = (): void => {
      useApp.getState().services?.repo.writePref(lastTablePref(profileId), table.id)
      onDone()
    }
    if (tx) {
      const result = updateTransaction(
        current,
        table.id,
        tx.id,
        { amount: value, date: iso, category, description: description.trim() },
        now
      )
      if ('error' in result) return setError(result.error)
      if (commit(result.state)) done()
      return
    }
    const next = addTransaction(
      current,
      table.id,
      { type: form.type, amount: value, date: iso, category, description },
      now
    ).state
    if (commit(next)) done()
  }

  return (
    <ScrollView>
      <Screen>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {tx ? 'Editar lançamento' : form.type === 'expense' ? 'Novo gasto' : 'Nova receita'} ·{' '}
          {table.name}
        </Text>
        <Field
          label={`Valor (${table.currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <Field label="Data (DD/MM/AAAA)" value={date} onChangeText={setDate} />
        <Field label="Descrição" value={description} onChangeText={setDescription} />
        <Text style={{ color: theme.muted, fontSize: 12 }}>Categoria</Text>
        <Row>
          {categories.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </Row>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red }}>
            {error}
          </Text>
        ) : null}
        <Button primary label="Salvar" onPress={save} disabled={readOnly} />
        <Button label="Cancelar" onPress={onDone} />
      </Screen>
    </ScrollView>
  )
}

/** One table of the phone's profile at a time: its balance, this month, and quick entry. */
export function FinanceScreen({ today = todayLocalISO() }: { today?: string }): React.JSX.Element {
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const services = useApp((s) => s.services)
  const readOnly = useApp((s) => s.readOnly)
  const tables = tablesOfProfile(app, profileId)
  const [chosen, setChosen] = useState<string | null>(
    () => services?.repo.readPref(lastTablePref(profileId)) ?? null
  )
  const [form, setForm] = useState<Form>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const table = tables.find((t) => t.id === chosen) ?? tables[0]

  if (!table)
    return (
      <Screen>
        <Text style={{ color: theme.muted }}>
          Nenhuma tabela neste perfil. Crie uma no Sagyou do PC.
        </Text>
      </Screen>
    )
  if (form) return <TransactionForm table={table} form={form} onDone={() => setForm(null)} />

  const choose = (id: string): void => {
    setChosen(id)
    services?.repo.writePref(lastTablePref(profileId), id)
  }
  const balance = tableBalance(table.transactions, today)
  const month = today.slice(0, 7)
  const monthTxs = table.transactions
    .filter((t) => t.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date))

  return (
    <ScrollView>
      <Screen>
        <Row>
          {tables.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={t.id === table.id}
              onPress={() => choose(t.id)}
            />
          ))}
        </Row>
        <Card>
          <Text style={{ color: theme.muted, fontSize: 12 }}>Saldo atual</Text>
          <Text
            testID="saldo"
            style={[styles.balance, { color: balance.gte(0) ? theme.purple : theme.red }]}
          >
            {formatCurrency(balance, table.currency)}
          </Text>
        </Card>
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button
              label="Novo gasto"
              onPress={() => setForm({ type: 'expense' })}
              disabled={readOnly}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Nova receita"
              onPress={() => setForm({ type: 'income' })}
              disabled={readOnly}
            />
          </View>
        </View>
        {notice ? <Text style={{ color: theme.attention }}>{notice}</Text> : null}
        {monthTxs.map((tx) => (
          <Pressable
            key={tx.id}
            accessibilityRole="button"
            accessibilityLabel={`${tx.description || tx.category || 'Lançamento'}, ${
              tx.type === 'income' ? 'receita' : 'gasto'
            } de ${formatCurrency(tx.amount, table.currency)}, ${toBRDate(tx.date)}`}
            onPress={() => {
              if (isLockedTransaction(table, tx)) return setNotice(LOCKED_TEXT)
              setNotice(null)
              setForm({ type: tx.type, tx })
            }}
            style={[styles.tx, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text }}>{tx.description || tx.category || '—'}</Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {tx.date.split('-').reverse().join('/')}
                {tx.category ? ` · ${tx.category}` : ''}
              </Text>
            </View>
            <Text style={{ color: tx.type === 'income' ? theme.green : theme.red }}>
              {tx.type === 'income' ? '+' : '−'}
              {formatCurrency(tx.amount, table.currency)}
            </Text>
          </Pressable>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600' },
  balance: { fontSize: 22, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  tx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  }
})
