import { formatCurrency } from '@sagyou/core/finance'
import { addDebt, payDebt } from '@sagyou/core/finance-actions'
import type { FinancialDebt, FinancialTable } from '@sagyou/core/types'
import { useState } from 'react'
import { Text } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { DateField } from '../../components/DateField'
import { Field } from '../../components/Field'
import { closeOrConfirm } from '../../components/discard'
import { useApp } from '../../store/app'
import { INVALID_AMOUNT_TEXT, applyFinance, parseAmount } from '../../store/finance'
import { FONT, useTheme } from '../../theme'

export interface DebtSheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  /** Paying this debt; without it the sheet creates one. */
  debt?: FinancialDebt
  /** The local calendar day (`yyyy-MM-dd`): the payment's date starts here. */
  today: string
}

/** Nova dívida (name + total) or Pagar (amount up to what is left + date). */
export function DebtSheet(props: DebtSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <DebtForm {...props} /> : null
}

function DebtForm({ onClose, table, debt, today }: DebtSheetProps): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const dirty = !!amount.trim() || (!debt && !!name.trim())
  const close = (): void => closeOrConfirm(dirty, onClose)

  const save = (): void => {
    const value = parseAmount(amount, table.currency)
    if (!value) return setError(INVALID_AMOUNT_TEXT)
    // One core call, one commit: the debt and its payment are saved together or not at all.
    const outcome = applyFinance(
      (tables, now) =>
        debt
          ? payDebt(tables, table.id, debt.id, value, date, now)
          : addDebt(tables, table.id, name, value, now),
      setError
    )
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={debt ? `Pagar ${debt.name}` : 'Nova dívida'}>
      {debt ? (
        <Text style={{ color: theme.muted, fontSize: FONT.body }}>
          Restante: {formatCurrency(debt.remainingAmount, table.currency)}. Será criado um gasto na
          data escolhida.
        </Text>
      ) : (
        <Field
          label="Nome da dívida"
          value={name}
          onChangeText={setName}
          autoFocus
          autoCapitalize="sentences"
        />
      )}
      <Field
        label={debt ? `Valor pago (${table.currency})` : `Valor total (${table.currency})`}
        value={amount}
        onChangeText={(text) => {
          setAmount(text)
          setError(null)
        }}
        keyboardType="decimal-pad"
        autoFocus={!!debt}
        error={error}
      />
      {debt ? (
        <DateField
          label="Data do pagamento"
          value={date}
          onChange={(d) => d && setDate(d)}
          today={new Date(`${today}T12:00:00`)}
        />
      ) : null}
      <Button
        variant="primary"
        label={debt ? 'Pagar' : 'Criar dívida'}
        onPress={save}
        disabled={readOnly || (!debt && !name.trim())}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}
