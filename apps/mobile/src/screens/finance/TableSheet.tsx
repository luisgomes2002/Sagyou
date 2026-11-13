import { createTable, renameTable } from '@sagyou/core/finance-actions'
import { CURRENCY_CONFIG, type Currency, type FinancialTable } from '@sagyou/core/types'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { Field } from '../../components/Field'
import { closeOrConfirm } from '../../components/discard'
import { useApp } from '../../store/app'
import { applyFinance } from '../../store/finance'
import { FONT, SPACE, useTheme } from '../../theme'

export interface TableSheetProps {
  visible: boolean
  onClose: () => void
  /** Renaming this table; without it the sheet creates one in the active profile. */
  table?: FinancialTable
  /** Called with the id of the table just created, before the sheet closes. */
  onCreated?: (id: string) => void
}

const CURRENCIES: Currency[] = ['BRL', 'USD', 'JPY']

/** Nova tabela (name + currency) or Renomear (name only: the currency stays, changing it is PC-only). */
export function TableSheet(props: TableSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <TableForm {...props} /> : null
}

function TableForm({ onClose, table, onCreated }: TableSheetProps): React.JSX.Element {
  const theme = useTheme()
  const profileId = useApp((s) => s.profileId)
  const readOnly = useApp((s) => s.readOnly)
  const [name, setName] = useState(table?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(table?.currency ?? 'BRL')
  const [error, setError] = useState<string | null>(null)
  const title = table ? 'Renomear tabela' : 'Nova tabela'
  const dirty = table ? name.trim() !== table.name : !!name.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  const save = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (table && trimmed === table.name) return onClose()
    const outcome = applyFinance(
      (tables, now) =>
        table
          ? renameTable(tables, table.id, trimmed, now)
          : createTable(tables, trimmed, currency, profileId, now),
      setError
    )
    if (!outcome.ok) return
    if (!table && outcome.id) onCreated?.(outcome.id)
    onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={title}>
      <Field
        label="Nome da tabela"
        value={name}
        onChangeText={(text) => {
          setName(text)
          setError(null)
        }}
        autoFocus={!table}
        error={error}
      />
      {table ? (
        <Text style={{ color: theme.muted, fontSize: FONT.caption }}>
          Moeda: {CURRENCY_CONFIG[table.currency].label} ({table.currency}). Para mudar a moeda, use
          o Sagyou do PC.
        </Text>
      ) : (
        <>
          <Text style={{ color: theme.muted, fontSize: FONT.caption }}>Moeda</Text>
          <View style={styles.chips}>
            {CURRENCIES.map((c) => (
              <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
            ))}
          </View>
        </>
      )}
      <Button
        variant="primary"
        label={table ? 'Salvar' : 'Criar tabela'}
        onPress={save}
        disabled={readOnly || !name.trim()}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }
})
