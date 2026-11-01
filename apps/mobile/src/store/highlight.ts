/** One character without accents or case, so "á" and "A" both compare as "a". */
function fold(char: string): string {
  return char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Splits a title into plain and matched pieces for every word of the query
 * (2+ letters), ignoring case and accents. The comparison folds character by
 * character, so the pieces are slices of the ORIGINAL title ("Hábito", never
 * "habito") and joining them gives the title back.
 */
export function highlightParts(title: string, query: string): { text: string; match: boolean }[] {
  const words = query
    .split(/\s+/)
    .map((w) => [...w].map(fold).join(''))
    .filter((w) => w.length >= 2)
  if (!words.length) return [{ text: title, match: false }]
  const chars = [...title]
  const folded = chars.map(fold)
  const marked = new Array<boolean>(chars.length).fill(false)
  for (const word of words) {
    const letters = [...word]
    for (let i = 0; i + letters.length <= folded.length; i++)
      if (letters.every((l, j) => folded[i + j] === l))
        for (let j = 0; j < letters.length; j++) marked[i + j] = true
  }
  const parts: { text: string; match: boolean }[] = []
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1]
    if (last && last.match === marked[i]) last.text += c
    else parts.push({ text: c, match: marked[i] })
  })
  return parts
}
