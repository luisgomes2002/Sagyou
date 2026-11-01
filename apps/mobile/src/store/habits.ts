import type { MobileState } from '../data/state'

/** Same rule as the desktop's toggleHabit: a day is in the list once, or not at all. */
export function toggleHabit(
  state: MobileState,
  id: string,
  isoDate: string,
  now: Date
): MobileState {
  return {
    ...state,
    habits: state.habits.map((h) => {
      if (h.id !== id) return h
      const completions = h.completions.includes(isoDate)
        ? h.completions.filter((d) => d !== isoDate)
        : [...h.completions, isoDate]
      return { ...h, completions, updatedAt: now.toISOString() }
    })
  }
}

/** The streak next to the flame icon: "1 dia", "5 dias". */
export function streakDaysText(streak: number): string {
  return streak === 1 ? '1 dia' : `${streak} dias`
}

export function todayDoneText(done: number, total: number): string {
  return `${done} de ${total} hoje`
}

export function habitUndoText(marked: boolean): string {
  return marked ? 'Hábito marcado' : 'Hábito desmarcado'
}
