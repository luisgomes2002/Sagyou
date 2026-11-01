import { computeHabitSummary } from '@sagyou/core/habits'
import { addDays, format } from 'date-fns'
import * as Haptics from 'expo-haptics'
import { Repeat } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Skeleton } from '../components/Skeleton'
import { ACTION_ICONS } from '../components/icons'
import { Card, EmptyState, Screen } from '../components/ui'
import { awaitingFirstSync, useApp } from '../store/app'
import { habitUndoText, streakDaysText, todayDoneText, toggleHabit } from '../store/habits'
import { useUndo } from '../store/undo'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

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

/** Marks or unmarks one day, with a light tap and "Desfazer" (the same toggle again). */
function toggle(habitId: string, iso: string): void {
  const { state, commit } = useApp.getState()
  const habit = state.habits.find((h) => h.id === habitId)
  if (!habit) return
  const marking = !habit.completions.includes(iso)
  if (!commit(toggleHabit(state, habitId, iso, new Date()))) return
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  useUndo.getState().show(habitUndoText(marking), () => {
    const app = useApp.getState()
    const now = app.state.habits.find((h) => h.id === habitId)
    // Only undo if the day is still as this tap left it.
    if (now && now.completions.includes(iso) === marking)
      app.commit(toggleHabit(app.state, habitId, iso, new Date()))
  })
}

/** "Hoje" in one big tap; the 6 days before it in the mini-week; older days stay as they are. */
export function HabitsScreen({ today: todayProp }: { today?: Date }): React.JSX.Element {
  const theme = useTheme()
  const habits = useApp((s) => s.state.habits)
  const readOnly = useApp((s) => s.readOnly)
  const waiting = useApp((s) => awaitingFirstSync(s.status))
  // The tab stays mounted for days: "Hoje" is read from the clock on every
  // render, and coming back to the app re-renders.
  const [, setWoke] = useState(0)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setWoke((n) => n + 1)
    })
    return () => sub.remove()
  }, [])
  const today = todayProp ?? new Date()
  const week = lastWeek(today)
  const todayIso = week[6].iso
  const summary = computeHabitSummary(habits, today)
  const doneToday = summary.filter(({ habit }) => habit.completions.includes(todayIso)).length
  const Check = ACTION_ICONS.check
  const Flame = ACTION_ICONS.flame
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        {summary.length === 0 ? (
          waiting ? (
            <Skeleton />
          ) : (
            <EmptyState icon={Repeat} text="Nenhum hábito ainda. Crie um no Sagyou do PC." />
          )
        ) : (
          <Text style={[styles.summary, { color: theme.muted }]}>
            {todayDoneText(doneToday, summary.length)}
          </Text>
        )}
        {summary.map(({ habit, streak }) => {
          const doneNow = habit.completions.includes(todayIso)
          return (
            <Card key={habit.id}>
              <View style={styles.header}>
                <View style={[styles.dot, { backgroundColor: habit.color }]} />
                <Text style={[styles.name, { color: theme.text }]}>{habit.name}</Text>
                <View style={styles.streak}>
                  <Flame size={16} color={streak ? theme.attention : theme.onSurfaceIcon} />
                  <Text style={{ color: streak ? theme.text : theme.muted, fontSize: FONT.body }}>
                    {streakDaysText(streak)}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${habit.name}, hoje`}
                accessibilityState={{ checked: doneNow, disabled: readOnly }}
                disabled={readOnly}
                onPress={() => toggle(habit.id, todayIso)}
                style={[
                  styles.today,
                  {
                    backgroundColor: doneNow ? theme.selected : theme.field,
                    borderColor: doneNow ? habit.color : theme.border,
                    opacity: readOnly ? 0.5 : 1
                  }
                ]}
              >
                {doneNow ? <Check size={20} color={habit.color} /> : null}
                <Text style={{ color: theme.text, fontSize: FONT.bodyLg, fontWeight: '600' }}>
                  {doneNow ? 'Feito hoje' : 'Hoje'}
                </Text>
              </Pressable>
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
                      // 7 days must fit a 360 dp phone: 44 dp drawn, 48 dp touchable.
                      hitSlop={{ left: 2, right: 2 }}
                      onPress={() => toggle(habit.id, day.iso)}
                      style={[
                        styles.day,
                        {
                          backgroundColor: done ? theme.selected : theme.field,
                          borderColor: done ? habit.color : theme.border
                        }
                      ]}
                    >
                      <Text
                        style={{ color: done ? theme.text : theme.muted, fontSize: FONT.caption }}
                      >
                        {day.label}
                      </Text>
                      <Text style={{ color: done ? theme.text : theme.muted, fontSize: FONT.body }}>
                        {day.day}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </Card>
          )
        })}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bottomRoom: { paddingBottom: 96 },
  summary: { fontSize: FONT.body },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { fontSize: FONT.bodyLg, flex: 1 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: RADIUS.control
  },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: MIN_TOUCH - 4,
    height: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
