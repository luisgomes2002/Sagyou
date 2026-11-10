import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SyncUserError } from '@sagyou/core/sync/engine'
import { CONFLICT_STATUS, lww, orphan, withEngine } from '../../__tests__/conflicts'
import { useApp } from '../../store/app'
import { ConflictsScreen, EMPTY_TEXT, EMPTY_TITLE, ORPHAN_TEXT } from '../ConflictsScreen'

describe('ConflictsScreen (lista)', () => {
  it('cada conflito mostra o item e o resumo, e tocar abre a comparação', async () => {
    withEngine([lww()])
    const navigate = jest.fn()
    await render(<ConflictsScreen navigation={{ navigate }} />)
    expect(screen.getByText('Task: Comprar pão')).toBeTruthy()
    expect(screen.getByText('3 campos diferentes · mais recente: PC de casa')).toBeTruthy()
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Task: Comprar pão, 3 campos diferentes · mais recente: PC de casa'
      })
    )
    expect(navigate).toHaveBeenCalledWith('Conflito', { id: 'c1' })
  })

  it('só leitura: o cartão não abre', async () => {
    withEngine([lww()])
    useApp.setState({ readOnly: true })
    const navigate = jest.fn()
    await render(<ConflictsScreen navigation={{ navigate }} />)
    expect(screen.getByText('Task: Comprar pão')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Task: Comprar pão/ })).toBeNull()
  })

  it('órfão mostra o aviso e Dispensar na própria lista', async () => {
    const { resolve } = withEngine([orphan()])
    await render(<ConflictsScreen navigation={{ navigate: jest.fn() }} />)
    expect(screen.getByText(ORPHAN_TEXT)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Dispensar' }))
    expect(resolve).toHaveBeenCalledWith('c-orfao', 'local')
    expect(screen.getByText('Conflito dispensado.')).toBeTruthy()
  })

  it('erro ao dispensar mostra a mensagem e mantém o conflito', async () => {
    withEngine(
      [orphan()],
      jest.fn(() => {
        throw new SyncUserError('Não foi possível usar esta versão.')
      })
    )
    await render(<ConflictsScreen navigation={{ navigate: jest.fn() }} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Dispensar' }))
    expect(screen.getByText('Não foi possível usar esta versão.')).toBeTruthy()
    expect(screen.getByText(ORPHAN_TEXT)).toBeTruthy()
  })

  it('mostra o aviso que a comparação deixou ao voltar', async () => {
    withEngine([])
    await render(
      <ConflictsScreen
        navigation={{ navigate: jest.fn() }}
        route={{ params: { notice: 'Versão escolhida.', at: 1 } }}
      />
    )
    expect(screen.getByText('Versão escolhida.')).toBeTruthy()
  })

  it('sem conflitos mostra o estado vazio', async () => {
    withEngine([])
    await render(<ConflictsScreen navigation={{ navigate: jest.fn() }} />)
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy()
  })

  it('recarrega quando o status muda (conflito fechado sozinho em outro aparelho)', async () => {
    const list = [lww()]
    const { conflicts } = withEngine(list)
    await render(<ConflictsScreen navigation={{ navigate: jest.fn() }} />)
    expect(screen.getByText('Task: Comprar pão')).toBeTruthy()
    list.length = 0
    await act(async () => {
      useApp.setState({ status: { ...CONFLICT_STATUS, conflictCount: 0 } })
    })
    expect(conflicts.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
  })
})
