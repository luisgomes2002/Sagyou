import { fireEvent, render, screen } from '@testing-library/react-native'
import * as Haptics from 'expo-haptics'
import { emptyState, type MobileState } from '../../data/state'
import { T, seedApp } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { toggleHabit } from '../../store/habits'
import { useUndo } from '../../store/undo'
import { HabitsScreen } from '../HabitsScreen'

// Noon local time (TZ pinned to America/Sao_Paulo in jest.config.js).
const TODAY = new Date(2026, 9, 31, 12)

type Habit = MobileState['habits'][number]
const habit = (id: string, name: string, completions: string[] = []): Habit => ({
  id,
  name,
  color: '#46d478',
  completions,
  createdAt: T,
  updatedAt: T
})

function seed(habits: Habit[], readOnly = false): ReturnType<typeof seedApp> {
  return seedApp({ habits }, { readOnly })
}

describe('hábitos no celular', () => {
  beforeEach(() => {
    useUndo.getState().dismiss()
    jest.clearAllMocks()
  })

  it('marca e desmarca o dia sem duplicar a data', () => {
    const base = emptyState()
    base.habits = [habit('h1', 'Água')]
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

  it('mostra quantos foram feitos hoje e a sequência em dias', async () => {
    seed([
      habit('h1', 'Água', ['2026-10-29', '2026-10-30', '2026-10-31']),
      habit('h2', 'Ler'),
      habit('h3', 'Correr', ['2026-10-31'])
    ])
    await render(<HabitsScreen today={TODAY} />)
    expect(screen.getByText('2 de 3 hoje')).toBeTruthy()
    expect(screen.getByText('3 dias')).toBeTruthy()
  })

  it('o botão Hoje marca com um toque, vibra e oferece Desfazer', async () => {
    seed([habit('h1', 'Ler')])
    await render(<HabitsScreen today={TODAY} />)
    const hoje = screen.getByRole('checkbox', { name: 'Ler, hoje' })
    expect(hoje).not.toBeChecked()
    await fireEvent.press(hoje)
    expect(useApp.getState().state.habits[0].completions).toEqual(['2026-10-31'])
    expect(Haptics.impactAsync).toHaveBeenCalled()
    expect(useUndo.getState()).toMatchObject({ message: 'Hábito marcado', canUndo: true })
    useUndo.getState().run()
    expect(useApp.getState().state.habits[0].completions).toEqual([])
  })

  it('desmarcar também oferece Desfazer', async () => {
    seed([habit('h1', 'Ler', ['2026-10-31'])])
    await render(<HabitsScreen today={TODAY} />)
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Ler, hoje' }))
    expect(useUndo.getState().message).toBe('Hábito desmarcado')
    useUndo.getState().run()
    expect(useApp.getState().state.habits[0].completions).toEqual(['2026-10-31'])
  })

  it('a mini-semana continua tocável nos últimos 7 dias', async () => {
    seed([habit('h1', 'Água')])
    await render(<HabitsScreen today={TODAY} />)
    const days = screen
      .getAllByRole('checkbox')
      .map((d) => d.props.accessibilityLabel as string)
      .filter((l) => !l.endsWith(', hoje'))
    expect(days).toEqual([
      'Água, domingo, 25/10',
      'Água, segunda, 26/10',
      'Água, terça, 27/10',
      'Água, quarta, 28/10',
      'Água, quinta, 29/10',
      'Água, sexta, 30/10',
      'Água, sábado, 31/10'
    ])
    await fireEvent.press(screen.getByLabelText('Água, quinta, 29/10'))
    expect(useApp.getState().state.habits[0].completions).toEqual(['2026-10-29'])
  })

  it('somente leitura: nada muda', async () => {
    const { save } = seed([habit('h1', 'Ler')], true)
    await render(<HabitsScreen today={TODAY} />)
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Ler, hoje' }))
    expect(useApp.getState().state.habits[0].completions).toEqual([])
    expect(save).not.toHaveBeenCalled()
    expect(useUndo.getState().message).toBeNull()
  })
})
