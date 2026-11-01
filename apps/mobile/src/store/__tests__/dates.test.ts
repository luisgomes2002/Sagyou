import { parseBRDate, toBRDate } from '../dates'

describe('datas no formato brasileiro', () => {
  it('converte DD/MM/AAAA para o formato gravado e volta', () => {
    expect(parseBRDate('28/10/2026')).toBe('2026-10-28')
    expect(toBRDate('2026-10-28')).toBe('28/10/2026')
    expect(toBRDate(undefined)).toBe('')
  })

  it('recusa dia que não existe e formato errado', () => {
    expect(parseBRDate('31/02/2026')).toBeNull()
    expect(parseBRDate('45/13/2026')).toBeNull()
    expect(parseBRDate('2026-10-28')).toBeNull()
    expect(parseBRDate('')).toBeNull()
  })
})
