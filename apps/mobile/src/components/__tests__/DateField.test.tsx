import { fireEvent, render, screen } from '@testing-library/react-native'
import { DateField } from '../DateField'

const TODAY = new Date(2026, 10, 1, 12)

describe('campo de data', () => {
  it('Hoje e Amanhã gravam a data local', async () => {
    const onChange = jest.fn()
    await render(<DateField label="Prazo" value={undefined} onChange={onChange} today={TODAY} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Amanhã' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-02')
    await fireEvent.press(screen.getByRole('button', { name: 'Hoje' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01')
  })

  it('"Escolher data…" abre o seletor nativo e grava o dia escolhido', async () => {
    const onChange = jest.fn()
    await render(<DateField label="Prazo" value={undefined} onChange={onChange} today={TODAY} />)
    expect(screen.queryByTestId('date-picker')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Escolher data…' }))
    const picker = screen.getByTestId('date-picker')
    await fireEvent(picker, 'onChange', { type: 'set' }, new Date(2026, 10, 15, 12))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-15')
    expect(screen.queryByTestId('date-picker')).toBeNull()
  })

  it('uma data fora de Hoje/Amanhã aparece no chip do seletor', async () => {
    await render(<DateField label="Prazo" value="2026-11-15" onChange={jest.fn()} today={TODAY} />)
    expect(screen.getByRole('button', { name: '15/11/2026' })).toBeSelected()
  })

  it('"Sem prazo" limpa quando o campo permite', async () => {
    const onChange = jest.fn()
    await render(
      <DateField label="Prazo" value="2026-11-02" onChange={onChange} today={TODAY} clearable />
    )
    expect(screen.getByRole('button', { name: 'Amanhã' })).toBeSelected()
    await fireEvent.press(screen.getByRole('button', { name: 'Sem prazo' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
