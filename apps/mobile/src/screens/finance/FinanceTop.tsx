import { todayLocalISO } from '@sagyou/core/dates'
import { deleteTable } from '@sagyou/core/finance-actions'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { Picker, type PickerOption } from '../../components/Picker'
import { confirmDelete, deleteTableTitle } from '../../components/confirm'
import { ACTION_ICONS } from '../../components/icons'
import { useApp } from '../../store/app'
import { applyFinance, monthLabel, shiftMonth, tablesOfProfile } from '../../store/finance'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'
import { TableSheet } from './TableSheet'

export interface FinanceTopProps {
  /** The table on screen, or `'all'` for the Consolidado. */
  tableId: string | 'all'
  onTable: (id: string | 'all') => void
  /** The month on screen, `yyyy-MM`. */
  month: string
  onMonth: (month: string) => void
  /** The local calendar day ("current month" is its month); defaults to today. */
  today?: string
}

const ALL = 'all'
const NEW = '__new-table__'

type Open = 'menu' | 'new' | 'rename' | null

/**
 * The top of Finanças: the table picker (Consolidado, the profile's tables, "Nova tabela…"), the ⋯
 * menu of the table (Renomear, Excluir) and the month with its arrows. Tapping the month's name
 * goes back to the current month.
 */
export function FinanceTop({
  tableId,
  onTable,
  month,
  onMonth,
  today = todayLocalISO()
}: FinanceTopProps): React.JSX.Element {
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const readOnly = useApp((s) => s.readOnly)
  const [open, setOpen] = useState<Open>(null)
  const tables = tablesOfProfile(app, profileId)
  const table = tables.find((t) => t.id === tableId)
  const More = ACTION_ICONS.more
  const options: PickerOption[] = [
    { id: ALL, label: 'Consolidado' },
    ...tables.map((t) => ({ id: t.id, label: t.name })),
    { id: NEW, label: 'Nova tabela…', disabled: readOnly }
  ]

  const remove = (): void => {
    setOpen(null)
    if (!table) return
    confirmDelete(deleteTableTitle(table.name), () => {
      applyFinance((all, now) => deleteTable(all, table.id, now))
    })
  }

  return (
    <View style={styles.top}>
      <View style={styles.pickerRow}>
        <View style={styles.picker}>
          <Picker
            label="Tabela"
            value={tableId}
            options={options}
            onChange={(id) => (id === NEW ? setOpen('new') : onTable(id))}
          />
        </View>
        {table ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ações da tabela"
            accessibilityState={{ disabled: readOnly }}
            disabled={readOnly}
            onPress={() => setOpen('menu')}
            style={({ pressed }) => [
              styles.more,
              {
                backgroundColor: pressed ? theme.selected : theme.field,
                borderColor: theme.border,
                opacity: readOnly ? 0.5 : 1
              }
            ]}
          >
            <More size={20} color={theme.onSurfaceIcon} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mês anterior"
          onPress={() => onMonth(shiftMonth(month, -1))}
          style={styles.arrow}
        >
          <Text style={[styles.arrowText, { color: theme.text }]}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={monthLabel(month)}
          accessibilityHint="Voltar ao mês atual"
          onPress={() => onMonth(today.slice(0, 7))}
          style={styles.month}
        >
          <Text style={[styles.monthText, { color: theme.text }]} numberOfLines={1}>
            {monthLabel(month)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Próximo mês"
          onPress={() => onMonth(shiftMonth(month, 1))}
          style={styles.arrow}
        >
          <Text style={[styles.arrowText, { color: theme.text }]}>›</Text>
        </Pressable>
      </View>
      <BottomSheet visible={open === 'menu'} onClose={() => setOpen(null)} title={table?.name}>
        <Button label="Renomear" onPress={() => setOpen('rename')} disabled={readOnly} />
        <Button variant="danger" label="Excluir" onPress={remove} disabled={readOnly} />
      </BottomSheet>
      <TableSheet
        visible={open === 'new'}
        onClose={() => setOpen(null)}
        onCreated={(id) => onTable(id)}
      />
      <TableSheet
        visible={open === 'rename' && !!table}
        table={table}
        onClose={() => setOpen(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  top: { gap: SPACE.sm },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  picker: { flex: 1 },
  more: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center'
  },
  monthRow: { flexDirection: 'row', alignItems: 'center' },
  arrow: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: FONT.display, lineHeight: FONT.display + 4 },
  month: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: FONT.bodyLg, fontWeight: '600' }
})
