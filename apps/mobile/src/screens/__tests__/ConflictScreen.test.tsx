import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { SyncUserError } from '@sagyou/core/sync/engine'
import { versionTimeText } from '@sagyou/core/sync/view'
import { AT_LOCAL, AT_REMOTE, NEW_HLC, lww, withEngine } from '../../__tests__/conflicts'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import { ConflictScreen } from '../ConflictScreen'

function nav(): { goBack: jest.Mock; navigate: jest.Mock } {
  return { goBack: jest.fn(), navigate: jest.fn() }
}

async function open(navigation = nav()): Promise<ReturnType<typeof nav>> {
  await render(<ConflictScreen route={{ params: { id: 'c1' } }} navigation={navigation} />)
  return navigation
}

describe('ConflictScreen (comparação)', () => {
  beforeEach(() => useLockState.setState({ hidden: false }))

  it('mostra a explicação, as duas versões e só os campos diferentes', async () => {
    withEngine([lww()])
    await open()
    expect(
      screen.getByText(
        'O mesmo item mudou em dois aparelhos antes de um receber a mudança do outro. Escolha o que fica; a escolha vai para todos os aparelhos.'
      )
    ).toBeTruthy()
    expect(screen.getByText(`Este aparelho · ${versionTimeText(AT_LOCAL)}`)).toBeTruthy()
    expect(screen.getByText(`PC de casa · ${versionTimeText(AT_REMOTE)}`)).toBeTruthy()
    expect(screen.getByText('Mais recente')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Descrição: usar a de PC de casa' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Descrição: usar a deste aparelho' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Prioridade: usar a de PC de casa' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Título/ })).toBeNull()
    expect(screen.getAllByLabelText(/Trecho diferente destacado/).length).toBeGreaterThan(0)
  })

  it('o leitor de tela ouve o valor de cada opção, com o aviso do trecho destacado', async () => {
    withEngine([lww()])
    await open()
    const remote = screen.getByRole('radio', { name: 'Descrição: usar a de PC de casa' })
    expect(remote.props.accessibilityHint).toMatch(/^Trecho diferente destacado: palavra/)
    expect(remote.props.accessibilityHint).toContain('segunda versão')
    const priority = screen.getByRole('radio', { name: 'Prioridade: usar a de PC de casa' })
    expect(priority.props.accessibilityHint).toBe('Alta')
  })

  it('só "Salvar escolha" fica fixo; os atalhos ficam no fim da comparação', async () => {
    withEngine([lww()])
    await open()
    const footer = screen.getByTestId('conflict-footer')
    expect(within(footer).getByRole('button', { name: 'Salvar escolha' })).toBeTruthy()
    expect(within(footer).queryByRole('button', { name: 'Ficar com a mais recente' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ficar com a mais recente' })).toBeTruthy()
  })

  it('pré-seleção e o aviso do tempo', async () => {
    withEngine([lww()])
    await open()
    expect(
      screen.getByRole('radio', { name: 'Descrição: usar a de PC de casa' }).props
        .accessibilityState.checked
    ).toBe(true)
    expect(
      screen.getByRole('radio', { name: 'Tempo gasto: usar a deste aparelho' }).props
        .accessibilityState.checked
    ).toBe(true)
    expect(
      screen.getByText('Marcamos o maior tempo para não perder tempo do cronômetro.')
    ).toBeTruthy()
  })

  it('"Igual nos dois" abre com toque', async () => {
    withEngine([lww()])
    await open()
    expect(screen.queryByText('Comprar pão')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: /Igual nos dois \(\d+\)/ }))
    expect(screen.getByText('Comprar pão')).toBeTruthy()
  })

  it('"Salvar escolha" grava os campos marcados e volta com o aviso', async () => {
    const { resolve } = withEngine([lww()])
    const navigation = await open()
    await fireEvent.press(screen.getByRole('radio', { name: 'Descrição: usar a deste aparelho' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar escolha' }))
    expect(resolve).toHaveBeenCalledWith('c1', {
      fields: { description: 'local', timeSpent: 'local', priority: 'remote' },
      expectedHlc: NEW_HLC
    })
    expect(navigation.navigate).toHaveBeenCalledWith('Conflitos', {
      notice: 'Versão escolhida.',
      at: expect.any(Number)
    })
  })

  it('atalhos de versão inteira', async () => {
    const { resolve } = withEngine([lww()])
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Ficar com a mais recente' }))
    expect(resolve).toHaveBeenLastCalledWith('c1', {
      fields: { description: 'remote', timeSpent: 'remote', priority: 'remote' },
      expectedHlc: NEW_HLC
    })
  })

  it('o segundo atalho é o deste aparelho quando o outro é o mais recente', async () => {
    const { resolve } = withEngine([lww()])
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Ficar com a deste aparelho' }))
    expect(resolve).toHaveBeenLastCalledWith('c1', {
      fields: { description: 'local', timeSpent: 'local', priority: 'local' },
      expectedHlc: NEW_HLC
    })
  })

  it('erro: a tela fica e mostra a mensagem', async () => {
    withEngine(
      [lww()],
      jest.fn(() => {
        throw new SyncUserError('Não foi possível usar esta versão.')
      })
    )
    const navigation = await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar escolha' }))
    expect(screen.getByText('Não foi possível usar esta versão.')).toBeTruthy()
    expect(navigation.navigate).not.toHaveBeenCalled()
  })

  it('o item mudou: relê o conflito e avisa', async () => {
    const list = [lww()]
    const { conflicts } = withEngine(
      list,
      jest.fn(() => {
        throw new SyncUserError('O item mudou enquanto você comparava. Confira de novo.')
      })
    )
    await open()
    const before = conflicts.mock.calls.length
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar escolha' }))
    expect(screen.getByText('O item mudou enquanto você comparava. Confira de novo.')).toBeTruthy()
    expect(conflicts.mock.calls.length).toBeGreaterThan(before)
  })

  it('o conflito fechou sozinho com a tela aberta: volta para a lista com o aviso', async () => {
    const list = [lww()]
    withEngine(list)
    const navigation = await open()
    list.length = 0
    await act(async () => {
      useApp.setState({ status: { ...useApp.getState().status!, conflictCount: 0 } })
    })
    expect(navigation.navigate).toHaveBeenCalledWith('Conflitos', {
      notice: 'Este conflito já foi resolvido em outro aparelho.',
      at: expect.any(Number)
    })
  })

  it('fecha ao bloquear ou ir para segundo plano', async () => {
    withEngine([lww()])
    const navigation = await open()
    await act(async () => {
      useLockState.setState({ hidden: true })
    })
    expect(navigation.goBack).toHaveBeenCalled()
  })

  it('fecha em modo só leitura', async () => {
    withEngine([lww()])
    useApp.setState({ readOnly: true })
    const navigation = await open()
    expect(navigation.goBack).toHaveBeenCalled()
  })
})
