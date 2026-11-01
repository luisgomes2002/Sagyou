import { fireEvent, render, screen } from '@testing-library/react-native'
import { seedApp } from '../../__tests__/seed'
import type { SearchHit } from '../../data/search'
import { type AppServices, useApp } from '../../store/app'
import { SearchScreen } from '../SearchScreen'

const HITS: SearchHit[] = [
  { kind: 'note', id: 'n1', title: 'Conta de luz anotada', parentId: 'p1' },
  { kind: 'task', id: 't1', title: 'Pagar conta', parentId: 'p1' },
  { kind: 'task', id: 't2', title: 'Conferir conta', parentId: 'p1' }
]

function seed(hits: SearchHit[]): jest.Mock {
  seedApp()
  const search = jest.fn(() => hits)
  const services = useApp.getState().services as AppServices
  useApp.setState({ services: { ...services, search } })
  return search
}

describe('busca no celular', () => {
  it('sem texto explica o que dá para buscar', async () => {
    seed([])
    await render(<SearchScreen onOpen={jest.fn()} />)
    expect(screen.getByText('Busque tarefas, notas, hábitos e lançamentos')).toBeTruthy()
  })

  it('agrupa por tipo, na ordem fixa, com a contagem', async () => {
    seed(HITS)
    await render(<SearchScreen onOpen={jest.fn()} />)
    await fireEvent.changeText(screen.getByLabelText('Buscar'), 'conta')
    expect(screen.getAllByRole('header').map((h) => h.props.accessibilityLabel)).toEqual([
      'Tarefas · 2',
      'Notas · 1'
    ])
  })

  it('o termo aparece destacado no título', async () => {
    seed(HITS)
    await render(<SearchScreen onOpen={jest.fn()} />)
    await fireEvent.changeText(screen.getByLabelText('Buscar'), 'conta')
    expect(screen.getAllByTestId('match').map((m) => m.props.children)).toEqual([
      'conta',
      'conta',
      'Conta'
    ])
  })

  it('sem resultado diz o que foi buscado', async () => {
    seed([])
    await render(<SearchScreen onOpen={jest.fn()} />)
    await fireEvent.changeText(screen.getByLabelText('Buscar'), 'xyz')
    expect(screen.getByText('Nada encontrado para "xyz"')).toBeTruthy()
  })

  it('"Limpar busca" zera o campo e tocar num resultado abre', async () => {
    seed(HITS)
    const onOpen = jest.fn()
    await render(<SearchScreen onOpen={onOpen} />)
    await fireEvent.changeText(screen.getByLabelText('Buscar'), 'conta')
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar conta' }))
    expect(onOpen).toHaveBeenCalledWith(HITS[1])
    await fireEvent.press(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.getByLabelText('Buscar').props.value).toBe('')
  })
})
