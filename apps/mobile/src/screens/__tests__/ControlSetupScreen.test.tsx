import { CONTROL_TEXT } from '@sagyou/core/control/texts'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { useLockState } from '../../lock/lockState'
import { useRemote } from '../../remote/store'
import {
  ASK_LABEL,
  AUTHORIZED_TEXT,
  AWAY_LABEL,
  ControlSetupScreen,
  REMOVE_LABEL,
  WAITING_TEXT
} from '../ControlSetupScreen'

const actions = {
  requestAuthorization: jest.fn(async () => undefined),
  requestRemote: jest.fn(async () => undefined),
  startPolling: jest.fn(),
  stopPolling: jest.fn(),
  removeThisPhone: jest.fn(async () => undefined),
  clearError: jest.fn()
}

function state(over: Record<string, unknown>): void {
  useRemote.setState({
    authorized: 'none',
    pairingCode: null,
    error: null,
    notice: null,
    busy: false,
    ...actions,
    ...over
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  useLockState.setState({ hidden: false })
})

describe('ControlSetupScreen', () => {
  it('sem autorização: pedir autorização e estou longe do PC', async () => {
    state({})
    await render(<ControlSetupScreen />)
    await fireEvent.press(screen.getByRole('button', { name: ASK_LABEL }))
    expect(actions.requestAuthorization).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: AWAY_LABEL })).toBeTruthy()
  })

  it('pendente: mostra o código para comparar, aguardando o PC, e lê as respostas', async () => {
    state({ authorized: 'pending', pairingCode: '482913' })
    await render(<ControlSetupScreen />)
    expect(screen.getByText('Compare este código com o do PC: 482 913')).toBeTruthy()
    expect(screen.getByText(WAITING_TEXT)).toBeTruthy()
    expect(actions.startPolling).toHaveBeenCalled()
  })

  it('longe do PC: envia senha e código, e a senha some do estado ao sair', async () => {
    state({})
    const view = await render(<ControlSetupScreen />)
    await fireEvent.press(screen.getByRole('button', { name: AWAY_LABEL }))
    expect(screen.getByText(CONTROL_TEXT.secondFactorAgain)).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Senha do Sagyou'), 'senha')
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador ou reserva'), '123456')
    await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }))
    await fireEvent.press(screen.getByRole('button', { name: AWAY_LABEL }))
    expect(screen.getByLabelText('Senha do Sagyou').props.value).toBe('')
    await fireEvent.changeText(screen.getByLabelText('Senha do Sagyou'), 'senha')
    await fireEvent.changeText(screen.getByLabelText('Código do autenticador ou reserva'), '123456')
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar' }))
    expect(actions.requestRemote).toHaveBeenCalledWith('senha', '123456')
    view.unmount()
  })

  it('aguardando o PC concluir: texto e aviso dos celulares anteriores', async () => {
    state({ authorized: 'waiting-pc', notice: CONTROL_TEXT.previousRevoked })
    await render(<ControlSetupScreen />)
    expect(screen.getByText(CONTROL_TEXT.waitingPc)).toBeTruthy()
    expect(screen.getByText(CONTROL_TEXT.previousRevoked)).toBeTruthy()
  })

  it('autorizado: Remover este celular confirma e chama removeThisPhone', async () => {
    state({ authorized: 'yes' })
    const alert = jest.spyOn(Alert, 'alert')
    await render(<ControlSetupScreen />)
    expect(screen.getByText(AUTHORIZED_TEXT)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: REMOVE_LABEL }))
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]
    buttons.find((b) => b.text === 'Remover')?.onPress?.()
    expect(actions.removeThisPhone).toHaveBeenCalled()
    alert.mockRestore()
  })

  it('erro aparece como alerta', async () => {
    state({ error: CONTROL_TEXT.biometricsChanged })
    await render(<ControlSetupScreen />)
    expect(screen.getByRole('alert')).toHaveTextContent(CONTROL_TEXT.biometricsChanged)
  })

  it('bloqueado ou em segundo plano: limpa os campos e volta', async () => {
    state({})
    const goBack = jest.fn()
    await render(<ControlSetupScreen navigation={{ goBack }} />)
    await fireEvent.press(screen.getByRole('button', { name: AWAY_LABEL }))
    await fireEvent.changeText(screen.getByLabelText('Senha do Sagyou'), 'senha')
    await act(async () => useLockState.setState({ hidden: true }))
    expect(goBack).toHaveBeenCalled()
    expect(screen.queryByLabelText('Senha do Sagyou')).toBeNull()
  })
})
