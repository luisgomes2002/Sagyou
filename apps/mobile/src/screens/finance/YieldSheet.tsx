import { formatAmountInput } from '@sagyou/core/finance'
import {
  addYieldEntry,
  addYieldSource,
  updateYieldEntry,
  updateYieldSource,
  type YieldEntryUpdates
} from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialTable, YieldEntry, YieldSource } from '@sagyou/core/types'
import { useState } from 'react'
import { Text } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { DateField } from '../../components/DateField'
import { Field } from '../../components/Field'
import { Picker } from '../../components/Picker'
import { closeOrConfirm } from '../../components/discard'
import { useApp } from '../../store/app'
import {
  INVALID_AMOUNT_TEXT,
  applyFinance,
  parseAmount,
  withYieldSummaries,
  type FinanceOutcome
} from '../../store/finance'
import { FONT, useTheme } from '../../theme'

export const DUPLICATE_ENTRY_TEXT = 'Já existe um rendimento desta fonte nesta data.'

export interface SourceSheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  /** Renaming this source; without it the sheet creates one. */
  source?: YieldSource
}

/** Nova fonte or Renomear fonte: just a name. */
export function SourceSheet(props: SourceSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <SourceForm {...props} /> : null
}

function SourceForm({ onClose, table, source }: SourceSheetProps): React.JSX.Element {
  const readOnly = useApp((s) => s.readOnly)
  const [name, setName] = useState(source?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const dirty = source ? name.trim() !== source.name : !!name.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  const save = (): void => {
    const clean = name.trim()
    if (!clean) return
    if (source && clean === source.name) return onClose()
    const outcome = applyFinance(
      (tables, now) =>
        source
          ? updateYieldSource(tables, table.id, source.id, clean, now)
          : addYieldSource(tables, table.id, clean, now),
      setError
    )
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={source ? 'Renomear fonte' : 'Nova fonte'}>
      <Field
        label="Nome da fonte"
        value={name}
        onChangeText={(text) => {
          setName(text)
          setError(null)
        }}
        autoFocus
        error={error}
      />
      <Button
        variant="primary"
        label={source ? 'Salvar' : 'Criar fonte'}
        onPress={save}
        disabled={readOnly || !name.trim()}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}

export interface EntrySheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  /** The month on screen (`yyyy-MM`): a new entry starts today when it is in it, else on its day 1. */
  month: string
  /** The local calendar day (`yyyy-MM-dd`). */
  today: string
  /** Editing this entry (date and amount); without it the sheet records a new one. */
  entry?: YieldEntry
}

/** Lançar rendimento or Editar rendimento: source (new only), the day and the amount. */
export function EntrySheet(props: EntrySheetProps): React.JSX.Element | null {
  return props.visible ? <EntryForm {...props} /> : null
}

function EntryForm({ onClose, table, month, today, entry }: EntrySheetProps): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const sources = table.yieldSources ?? []
  const initialAmount = entry ? formatAmountInput(entry.amount, table.currency) : ''
  const initialDate = entry?.date ?? (today.startsWith(month) ? today : `${month}-01`)
  const [sourceId, setSourceId] = useState(entry?.sourceId ?? sources[0]?.id ?? '')
  const [date, setDate] = useState(initialDate)
  const [amount, setAmount] = useState(initialAmount)
  const [error, setError] = useState<string | null>(null)
  const sourceName = sources.find((s) => s.id === sourceId)?.name ?? ''

  const dirty = entry ? amount !== initialAmount || date !== entry.date : !!amount.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  // A source has one entry per day (the desktop's grid): the other entry on that day, if any.
  const sameDayIn = (tables: FinancialTable[]): YieldEntry | undefined =>
    tables
      .find((t) => t.id === table.id)
      ?.yieldEntries?.find(
        (e) => e.sourceId === (entry?.sourceId ?? sourceId) && e.date === date && e.id !== entry?.id
      )

  const save = (): void => {
    const amountChanged = !entry || amount !== initialAmount
    let canonical = ''
    if (amountChanged) {
      const value = parseAmount(amount, table.currency)
      // As the desktop: two decimals, and what rounds to nothing is no entry.
      const rounded = value ? D(value).toDecimalPlaces(2) : null
      if (!rounded || rounded.lte(0)) return setError(INVALID_AMOUNT_TEXT)
      canonical = rounded.toString()
    }
    if (entry) {
      if (!amountChanged && date === entry.date) return onClose()
      if (date !== entry.date && sameDayIn(useApp.getState().state.lists))
        return setError(DUPLICATE_ENTRY_TEXT)
    }

    // One call, one commit: the entry and the month's summary are saved together or not at all.
    const outcome: FinanceOutcome = applyFinance((tables, now) => {
      if (entry) {
        const updates: YieldEntryUpdates = {}
        if (amountChanged) updates.amount = canonical
        if (date !== entry.date) updates.date = date
        return withYieldSummaries(
          updateYieldEntry(tables, table.id, entry.id, updates, now),
          table.id,
          [entry.date, date],
          now
        )
      }
      const sameDay = sameDayIn(tables)
      const result = sameDay
        ? updateYieldEntry(tables, table.id, sameDay.id, { amount: canonical }, now)
        : addYieldEntry(tables, table.id, { sourceId, date, amount: canonical }, now)
      return withYieldSummaries(result, table.id, [date], now)
    }, setError)
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={entry ? 'Editar rendimento' : 'Lançar rendimento'}>
      {entry ? (
        <Text style={{ color: theme.muted, fontSize: FONT.body }} numberOfLines={2}>
          {sourceName}
        </Text>
      ) : (
        <Picker
          label="Fonte"
          value={sourceId}
          options={sources.map((s) => ({ id: s.id, label: s.name }))}
          onChange={setSourceId}
        />
      )}
      <DateField
        label="Data do rendimento"
        value={date}
        onChange={(d) => d && setDate(d)}
        today={new Date(`${today}T12:00:00`)}
      />
      <Field
        label={`Valor (${table.currency})`}
        value={amount}
        onChangeText={(text) => {
          setAmount(text)
          setError(null)
        }}
        keyboardType="decimal-pad"
        autoFocus
        error={error}
      />
      <Button
        variant="primary"
        label={entry ? 'Salvar' : 'Lançar'}
        onPress={save}
        disabled={readOnly || !sourceId}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}
