import { fireEvent, render, screen } from '@testing-library/react-native'
import { emptyState } from '../../data/state'
import { type AppServices, useApp } from '../../store/app'
import { toggleHabit } from '../../store/habits'
import { HabitsScreen } from '../HabitsScreen'

const T = '2026-10-01T00:00:00.000Z'
// Noon local time (TZ pinned to America/Sao_Paulo in jest.config.js).
const TODAY = new Date(2026, 9, 31, 12)

function seed(completions: string[]): void {
  const state = emptyState()
  state.habits = [
    { id: 'h1', name: 'Água', color: '#46d478', completions, createdAt: T, updatedAt: T }
  ]
  useApp.setState({
    state,
    readOnly: false,
    services: {
      repo: { save: jest.fn() },
      runtime: { engine: { notifySaved: jest.fn() } }
    } as unknown as AppServices
  })
}

describe('hábitos no celular', () => {
  it('marca e desmarca o dia sem duplicar a data', () => {
    const base = emptyState()
    base.habits = [
      { id: 'h1', name: 'Água', color: '#000', completions: [], createdAt: T, updatedAt: T }
    ]
    const on = toggleHabit(base, 'h1', '2026-10-31', TODAY)
    expect(on.habits[0].completions).toEqual(['2026-10-31'])
    const off = toggleHabit(on, 'h1', '2026-10-31', TODAY)
    expect(off.habits[0].completions).toEqual([])
    const again = toggleHabit(
      toggleHabit(off, 'h1', '2026-10-31', TODAY),
      'h1',
      '2026-10-30',
      TODAY
    )
    expect(again.habits[0].completions).toEqual(['2026-10-31', '2026-10-30'])
  })

  it('mostra a sequência de 3 para três dias seguidos até hoje', async () => {
    seed(['2026-10-29', '2026-10-30', '2026-10-31'])
    await render(<HabitsScreen today={TODAY} />)
    expect(screen.getByText('3 dias seguidos')).toBeTruthy()
  })

  it('só os últimos 7 dias podem ser marcados, e tocar marca o dia', async () => {
    seed([])
    await render(<HabitsScreen today={TODAY} />)
    const days = screen.getAllByRole('checkbox')
    expect(days.map((d) => d.props.accessibilityLabel)).toEqual([
      'Água 2026-10-25',
      'Água 2026-10-26',
      'Água 2026-10-27',
      'Água 2026-10-28',
      'Água 2026-10-29',
      'Água 2026-10-30',
      'Água 2026-10-31'
    ])
    await fireEvent.press(screen.getByLabelText('Água 2026-10-31'))
    expect(useApp.getState().state.habits[0].completions).toEqual(['2026-10-31'])
  })
})
