import { financialCategories, formatAmountInput } from '@sagyou/core/finance'
import { D } from '@sagyou/core/money'
import type { FinancialTransaction } from '@sagyou/core/types'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { useApp } from '../store/app'
import { dueChoice, quickTable } from '../store/quick'
import {
  INVALID_AMOUNT_TEXT,
  NOT_FOUND_TEXT,
  addTransaction,
  lastTablePref,
  parseAmount,
  tablesOfProfile,
  updateTransaction,
  type TransactionPatch
} from '../store/finance'
import { FONT, SPACE, useTheme } from '../theme'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Chip } from './Chip'
import { DateField } from './DateField'
import { Field } from './Field'
import { Picker } from './Picker'
import { categoryIcon } from './icons'
import { closeOrConfirm } from './discard'

export interface TransactionSheetProps {
  visible: boolean
  onClose: () => void
  type: 'income' | 'expense'
  /** Editing: the transaction and its (fixed) table. */
  tx?: FinancialTransaction
  tableId?: string
  today?: Date
}

/**
 * Gasto / Receita in a sheet: the amount first (numeric keyboard, the table's
 * currency), then optional category, date and description. New ones go to the
 * last table used in this profile; editing keeps the transaction's table.
 */
export function TransactionSheet(props: TransactionSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <TransactionForm {...props} /> : null
}

function TransactionForm({
  onClose,
  type,
  tx,
  tableId,
  today: todayProp
}: TransactionSheetProps): React.JSX.Element {
  const title = tx ? 'Editar lançamento' : type === 'expense' ? 'Novo gasto' : 'Nova receita'
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const services = useApp((s) => s.services)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const [today] = useState(() => todayProp ?? new Date())
  const [chosen, setChosen] = useState<string | undefined>(
    () =>
      tableId ??
      quickTable(app, profileId, services?.repo.readPref(lastTablePref(profileId)) ?? null)?.id
  )
  const tables = tablesOfProfile(app, profileId)
  const table = app.lists.find((t) => t.id === chosen)
  const [amount, setAmount] = useState(
    tx && table ? formatAmountInput(tx.amount, table.currency) : ''
  )
  const [date, setDate] = useState<string>(tx?.date ?? dueChoice('today', today))
  const [category, setCategory] = useState(tx?.category ?? '')
  const [description, setDescription] = useState(tx?.description ?? '')
  const [source, setSource] = useState(tx?.source ?? '')
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? '')
  const [bankReference, setBankReference] = useState(tx?.bankReference ?? '')
  const [error, setError] = useState<string | null>(null)

  if (!table)
    return (
      <BottomSheet visible onClose={onClose} title={title}>
        <Text style={{ color: theme.muted, fontSize: FONT.body }}>
          Nenhuma tabela neste perfil. Crie uma na aba Finanças.
        </Text>
      </BottomSheet>
    )

  const categories = financialCategories(
    app.financialProfiles.find((p) => p.id === profileId),
    tables
  )
  const dirty = tx
    ? amount !== formatAmountInput(tx.amount, table.currency) ||
      category !== (tx.category ?? '') ||
      description !== (tx.description ?? '') ||
      date !== tx.date ||
      source.trim() !== (tx.source ?? '') ||
      counterparty.trim() !== (tx.counterparty ?? '') ||
      bankReference.trim() !== (tx.bankReference ?? '')
    : !!amount.trim() || !!description.trim()

  const save = (): void => {
    const value = parseAmount(amount, table.currency)
    if (!value) return setError(INVALID_AMOUNT_TEXT)
    const current = useApp.getState().state
    const now = new Date()
    let next = current
    if (tx) {
      // Only what changed goes to the core, so an untouched field adds nothing to the history
      // and a field the phone does not show is never rewritten.
      const patch: TransactionPatch = {}
      if (!sameAmount(value, tx.amount)) patch.amount = value
      if (date !== tx.date) patch.date = date
      if (category !== (tx.category ?? '')) patch.category = category
      if (description.trim() !== tx.description) patch.description = description.trim()
      if (source.trim() !== (tx.source ?? '')) patch.source = source.trim() || undefined
      if (counterparty.trim() !== (tx.counterparty ?? ''))
        patch.counterparty = counterparty.trim() || undefined
      if (bankReference.trim() !== (tx.bankReference ?? ''))
        patch.bankReference = bankReference.trim() || undefined
      if (Object.keys(patch).length === 0) return onClose()
      const result = updateTransaction(current, table.id, tx.id, patch, now)
      if ('error' in result) return setError(result.error)
      next = result.state
    } else {
      const added = addTransaction(
        current,
        table.id,
        { type, amount: value, date, category, description: description.trim() },
        now
      )
      if (!added.id) return setError(NOT_FOUND_TEXT)
      next = added.state
    }
    if (!commit(next)) return
    // "Last table used" means the last table a transaction was saved in, too — except for someone
    // looking at the Consolidado, who must not be taken out of it by saving a gasto.
    const pref = lastTablePref(profileId)
    if (services?.repo.readPref(pref) !== 'all') services?.repo.writePref(pref, table.id)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onClose()
  }

  const close = (): void => closeOrConfirm(dirty, onClose)
  return (
    <BottomSheet visible onClose={close} full title={title}>
      {tx ? (
        <Text style={{ color: theme.muted, fontSize: FONT.caption }}>Tabela ▸ {table.name}</Text>
      ) : (
        <Picker
          label="Tabela"
          value={table.id}
          options={tables.map((t) => ({ id: t.id, label: t.name }))}
          onChange={setChosen}
        />
      )}
      <Field
        label={`Valor (${table.currency})`}
        value={amount}
        onChangeText={(text) => {
          setAmount(text)
          setError(null)
        }}
        keyboardType="decimal-pad"
        autoFocus={!tx}
        error={error}
        style={styles.amount}
      />
      <Text style={{ color: theme.muted, fontSize: FONT.caption }}>Categoria</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {categories.map((c) => (
          <Chip
            key={c}
            label={c}
            icon={categoryIcon(c)}
            selected={category === c}
            onPress={() => setCategory(category === c ? '' : c)}
          />
        ))}
      </ScrollView>
      <DateField label="Data" value={date} onChange={(d) => d && setDate(d)} today={today} />
      <Field label="Descrição" value={description} onChangeText={setDescription} />
      {tx ? (
        <>
          <Field label="Origem" value={source} onChangeText={setSource} />
          <Field label="Pessoa" value={counterparty} onChangeText={setCounterparty} />
          <Field label="Referência" value={bankReference} onChangeText={setBankReference} />
        </>
      ) : null}
      <Button variant="primary" label="Salvar" onPress={save} disabled={readOnly} />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}

/** The same number, whatever its spelling ("30" and "30.00"). */
function sameAmount(a: string, b: string): boolean {
  try {
    return D(a).eq(D(b))
  } catch {
    return false
  }
}

const styles = StyleSheet.create({
  amount: { fontSize: FONT.display, fontVariant: ['tabular-nums'] },
  chips: { gap: SPACE.sm }
})
