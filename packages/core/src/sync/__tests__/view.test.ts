import { describe, expect, it } from 'vitest'
import { versionTimeText } from '../view'

describe('versionTimeText', () => {
  it('says the time is unknown when the version has none', () => {
    expect(versionTimeText(null)).toBe('hora desconhecida')
  })

  it('formats a known time as pt-BR, like the desktop did', () => {
    const at = Date.UTC(2026, 10, 2, 12, 30)
    expect(versionTimeText(at)).toBe(new Date(at).toLocaleString('pt-BR'))
  })
})
