import { computeHabitSummary } from '@sagyou/core/habits'
import { addDays, format } from 'date-fns'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Card, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { streakText, toggleHabit } from '../store/habits'
import { useTheme } from '../theme'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** The last 7 local days, oldest first, ending today. */
function lastWeek(today: Date): { iso: string; label: string; day: string; spoken: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return {
      iso: format(day, 'yyyy-MM-dd'),
      label: WEEKDAYS[day.getDay()],
      day: format(day, 'd'),
      spoken: `${WEEKDAY_NAMES[day.getDay()]}, ${format(day, 'dd/MM')}`
    }
  })
}

/** Mark or unmark today and the 6 days before it; older days stay as they are. */
export function HabitsScreen({ today: todayProp }: { today?: Date }): React.JSX.Element {
  const theme = useTheme()
  const habits = useApp((s) => s.state.habits)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const [today] = useState(() => todayProp ?? new Date())
  const week = lastWeek(today)
  const summary = computeHabitSummary(habits, today)
  return (
    <ScrollView>
      <Screen>
        {summary.length === 0 ? (
          <Text style={{ color: theme.muted }}>Nenhum hábito ainda. Crie um no Sagyou do PC.</Text>
        ) : null}
        {summary.map(({ habit, streak }) => (
          <Card key={habit.id}>
            <View style={styles.header}>
              <View style={[styles.dot, { backgroundColor: habit.color }]} />
              <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{habit.name}</Text>
              <Text style={{ color: streak ? theme.green : theme.muted }}>
                {streakText(streak)}
              </Text>
            </View>
            <View style={styles.week}>
              {week.map((day) => {
                const done = habit.completions.includes(day.iso)
                return (
                  <Pressable
                    key={day.iso}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${habit.name}, ${day.spoken}`}
                    accessibilityState={{ checked: done, disabled: readOnly }}
                    disabled={readOnly}
                    onPress={() =>
                      commit(toggleHabit(useApp.getState().state, habit.id, day.iso, new Date()))
                    }
                    style={[
                      styles.day,
                      {
                        backgroundColor: done ? theme.selected : theme.field,
                        borderColor: done ? habit.color : theme.border
                      }
                    ]}
                  >
                    <Text style={{ color: done ? theme.text : theme.muted, fontSize: 11 }}>
                      {day.label}
                    </Text>
                    <Text style={{ color: done ? theme.text : theme.muted, fontSize: 13 }}>
                      {day.day}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </Card>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
