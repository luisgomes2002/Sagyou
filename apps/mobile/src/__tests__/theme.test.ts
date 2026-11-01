import { contrastRatio, darkTheme, lightTheme, type Theme } from '../theme'

const THEMES: [string, Theme][] = [
  ['escuro', darkTheme],
  ['claro', lightTheme]
]

describe('tokens de cor', () => {
  it('contrastRatio segue a fórmula WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it.each(THEMES)('todo par texto/fundo passa 4,5:1 (tema %s)', (_, t) => {
    for (const fg of [t.text, t.muted])
      for (const bg of [t.bg, t.surface, t.field])
        expect([fg, bg, contrastRatio(fg, bg) >= 4.5]).toEqual([fg, bg, true])
    expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEMES)('cores semânticas passam 3:1 sobre a superfície (tema %s)', (_, t) => {
    for (const c of [t.green, t.red, t.purple, t.attention])
      expect([c, contrastRatio(c, t.surface) >= 3]).toEqual([c, true])
  })
})
