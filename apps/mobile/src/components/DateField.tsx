import DateTimePicker from '@react-native-community/datetimepicker'
import { formatDateBR } from '@sagyou/core/dates'
import { format } from 'date-fns'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLockState } from '../lock/lockState'
import { dueChoice } from '../store/quick'
import { FONT, SPACE, useTheme } from '../theme'
import { Chip } from './Chip'
import { ACTION_ICONS } from './icons'

export const PICK_DATE = 'Escolher data…'
export const NO_DATE = 'Sem prazo'

/**
 * A date picked by touch, never typed: "Hoje", "Amanhã", or the native
 * Android calendar. The value is a local day (YYYY-MM-DD), like everything stored.
 */
export function DateField({
  label,
  value,
  onChange,
  clearable,
  today: todayProp,
  disabled
}: {
  label: string
  value: string | undefined
  onChange: (iso: string | undefined) => void
  clearable?: boolean
  today?: Date
  disabled?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  const [today] = useState(() => todayProp ?? new Date())
  const [picking, setPicking] = useState(false)
  const locked = useLockState((st) => st.hidden)
  const todayIso = dueChoice('today', today)
  const tomorrowIso = dueChoice('tomorrow', today)
  const custom = value && value !== todayIso && value !== tomorrowIso ? value : null
  const pickerValue = value ? new Date(`${value}T12:00:00`) : today

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      <View style={styles.row}>
        <Chip
          label="Hoje"
          selected={value === todayIso}
          onPress={() => onChange(todayIso)}
          disabled={disabled}
        />
        <Chip
          label="Amanhã"
          selected={value === tomorrowIso}
          onPress={() => onChange(tomorrowIso)}
          disabled={disabled}
        />
        <Chip
          label={custom ? formatDateBR(custom) : PICK_DATE}
          icon={ACTION_ICONS.calendar}
          selected={!!custom}
          onPress={() => setPicking(true)}
          disabled={disabled}
        />
        {clearable ? (
          <Chip
            label={NO_DATE}
            selected={!value}
            onPress={() => onChange(undefined)}
            disabled={disabled}
          />
        ) : null}
      </View>
      {picking && !locked ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          onChange={(event: { type: string }, date?: Date) => {
            setPicking(false)
            if (event.type === 'set' && date) onChange(format(date, 'yyyy-MM-dd'))
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: SPACE.xs },
  label: { fontSize: FONT.caption },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }
})
