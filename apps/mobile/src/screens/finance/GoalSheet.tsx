import { formatAmountInput } from '@sagyou/core/finance'
import { addGoal, completeGoal, updateGoal, type GoalUpdates } from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialGoal, FinancialTable } from '@sagyou/core/types'
import { MONTH_NAMES } from '@sagyou/core/yieldSummary'
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
  type FinanceOutcome
} from '../../store/finance'
import { FONT, useTheme } from '../../theme'

export const INVALID_YEAR_TEXT = 'Informe um ano válido.'

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({ id: String(index + 1), label }))

export interface GoalSheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  /** Editing this goal; without it the sheet creates one. */
  goal?: FinancialGoal
  /** The local calendar day (`yyyy-MM-dd`): a new goal's deadline starts at its month. */
  today: string
}

/** Nova meta or Editar meta: name, target amount (table currency) and the deadline month and year. */
export function GoalSheet(props: GoalSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <GoalForm {...props} /> : null
}

function GoalForm({ onClose, table, goal, today }: GoalSheetProps): React.JSX.Element {
  const readOnly = useApp((s) => s.readOnly)
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(
    goal ? formatAmountInput(goal.targetAmount, table.currency) : ''
  )
  const [month, setMonth] = useState(goal?.targetMonth ?? Number(today.slice(5, 7)))
  const [year, setYear] = useState(String(goal?.targetYear ?? Number(today.slice(0, 4))))
  const [amountError, setAmountError] = useState<string | null>(null)
  const [yearError, setYearError] = useState<string | null>(null)

  const dirty = goal
    ? name.trim() !== goal.name ||
      target !== formatAmountInput(goal.targetAmount, table.currency) ||
      month !== goal.targetMonth ||
      year !== String(goal.targetYear)
    : !!name.trim() || !!target.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  const save = (): void => {
    const value = parseAmount(target, table.currency)
    if (!value) return setAmountError(INVALID_AMOUNT_TEXT)
    // A deadline in a past year is only accepted when it is the goal's own (an overdue goal
    // must stay editable); a new one starts this year at the earliest, as on the desktop.
    const floor = Math.min(Number(today.slice(0, 4)), goal?.targetYear ?? Infinity)
    const deadlineYear = Number(year)
    if (!/^\d{4}$/.test(year.trim()) || deadlineYear < floor) return setYearError(INVALID_YEAR_TEXT)
    const clean = name.trim()
    if (!clean) return

    let outcome: FinanceOutcome
    if (goal) {
      // Only what changed goes to the core, so a legacy target is never rounded by an unchanged save.
      const updates: GoalUpdates = {}
      if (clean !== goal.name) updates.name = clean
      if (!D(value).eq(D(goal.targetAmount))) updates.targetAmount = value
      if (month !== goal.targetMonth) updates.targetMonth = month
      if (deadlineYear !== goal.targetYear) updates.targetYear = deadlineYear
      if (Object.keys(updates).length === 0) return onClose()
      outcome = applyFinance(
        (tables, now) => updateGoal(tables, table.id, goal.id, updates, now),
        setAmountError
      )
    } else {
      outcome = applyFinance(
        (tables, now) =>
          addGoal(
            tables,
            table.id,
            { name: clean, targetAmount: value, targetMonth: month, targetYear: deadlineYear },
            now
          ),
        setAmountError
      )
    }
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={goal ? 'Editar meta' : 'Nova meta'}>
      <Field label="Nome da meta" value={name} onChangeText={setName} autoFocus={!goal} />
      <Field
        label={`Valor necessário (${table.currency})`}
        value={target}
        onChangeText={(text) => {
          setTarget(text)
          setAmountError(null)
        }}
        keyboardType="decimal-pad"
        error={amountError}
      />
      <Picker
        label="Mês do prazo"
        value={String(month)}
        options={MONTH_OPTIONS}
        onChange={(id) => setMonth(Number(id))}
      />
      <Field
        label="Ano do prazo"
        value={year}
        onChangeText={(text) => {
          setYear(text)
          setYearError(null)
        }}
        keyboardType="number-pad"
        maxLength={4}
        error={yearError}
      />
      <Button
        variant="primary"
        label={goal ? 'Salvar' : 'Criar meta'}
        onPress={save}
        disabled={readOnly || !name.trim()}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}

export interface CompleteGoalSheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  goal: FinancialGoal
  today: string
}

/** Concluir meta: the day it was done (a calendar choice, never typed) and an optional note. */
export function CompleteGoalSheet(props: CompleteGoalSheetProps): React.JSX.Element | null {
  return props.visible ? <CompleteForm {...props} /> : null
}

function CompleteForm({ onClose, table, goal, today }: CompleteGoalSheetProps): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const close = (): void => closeOrConfirm(!!note.trim(), onClose)

  const save = (): void => {
    const outcome = applyFinance(
      (tables, now) => completeGoal(tables, table.id, goal.id, date, note.trim() || undefined, now),
      setError
    )
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title="Concluir meta">
      <Text style={{ color: theme.muted, fontSize: FONT.body }} numberOfLines={2}>
        {goal.name}
      </Text>
      <DateField
        label="Data de conclusão"
        value={date}
        onChange={(d) => d && setDate(d)}
        today={new Date(`${today}T12:00:00`)}
      />
      <Field
        label="Descrição (opcional)"
        value={note}
        onChangeText={setNote}
        multiline
        error={error}
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />
      <Button variant="primary" label="Concluir meta" onPress={save} disabled={readOnly} />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}
