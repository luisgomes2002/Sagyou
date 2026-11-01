import { habitUndoText, streakDaysText, todayDoneText } from '../habits'

describe('textos de hábitos', () => {
  it('resumo de hoje', () => {
    expect(todayDoneText(0, 0)).toBe('0 de 0 hoje')
    expect(todayDoneText(1, 1)).toBe('1 de 1 hoje')
    expect(todayDoneText(3, 5)).toBe('3 de 5 hoje')
  })

  it('aviso do desfazer', () => {
    expect(habitUndoText(true)).toBe('Hábito marcado')
    expect(habitUndoText(false)).toBe('Hábito desmarcado')
  })

  it('sequência em dias', () => {
    expect(streakDaysText(0)).toBe('0 dias')
    expect(streakDaysText(1)).toBe('1 dia')
    expect(streakDaysText(5)).toBe('5 dias')
  })
})
