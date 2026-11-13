const two = (n: number): string => String(n).padStart(2, '0')

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "hoje 14:32", "ontem 09:10" or "12/11 14:32", in the phone's local time. */
export function historyTime(at: number, now: number): string {
  const d = new Date(at)
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  if (sameDay(d, today)) return `hoje ${time}`
  if (sameDay(d, yesterday)) return `ontem ${time}`
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${time}`
}
