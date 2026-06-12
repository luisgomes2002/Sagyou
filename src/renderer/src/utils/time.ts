export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s'
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`
  if (m > 0) return `${m}m`
  return `${s}s`
}
