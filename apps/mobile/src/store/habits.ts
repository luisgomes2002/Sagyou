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

export function streakText(streak: number): string {
  return streak === 1 ? '1 dia seguido' : `${streak} dias seguidos`
}
