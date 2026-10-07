/** Exact extrema and zero are anchors; intermediate ticks use a readable magnitude. */
export function balanceAxisTicks(values: number[], plotHeight = 135): number[] {
  if (values.length === 0) return [0]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const lower = Math.min(min, 0)
  const upper = Math.max(max, 0)
  const range = upper - lower
  if (range === 0) return [0]

  const anchors = [...new Set([min, max, 0])]
  const magnitude = 10 ** Math.ceil(Math.log10(Math.max(Math.abs(lower), Math.abs(upper)) / 2))
  const ticks = [...anchors]
  for (const factor of [0.5, 0.8, 0.1, 0.2, 1]) {
    for (const sign of [1, -1]) {
      const value = Number((sign * factor * magnitude).toPrecision(12))
      if (
        value > lower &&
        value < upper &&
        ticks.every((tick) => (Math.abs(tick - value) / range) * plotHeight >= 19)
      ) {
        ticks.push(value)
      }
    }
  }
  return ticks.sort((a, b) => b - a)
}

/** Move labels slightly when two required anchors lie close together. */
export function balanceAxisLabelY(
  ticks: number[],
  y: (value: number) => number,
  bottom: number
): number[] {
  const labels: number[] = []
  for (const tick of ticks) {
    labels.push(Math.max(y(tick) + 3, (labels.at(-1) ?? -Infinity) + 13))
  }
  if (labels.length && labels[labels.length - 1] > bottom) {
    labels[labels.length - 1] = bottom
    for (let index = labels.length - 2; index >= 0; index--) {
      labels[index] = Math.min(labels[index], labels[index + 1] - 13)
    }
  }
  return labels
}
