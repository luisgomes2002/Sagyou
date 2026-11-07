import type { PcState, PcView } from '@sagyou/core/control/state'
import { CONTROL_TEXT, PC_STATE_TEXT } from '@sagyou/core/control/texts'
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
  cancelRequest: jest.fn(async () => undefined),
  wake: jest.fn(async () => undefined),
  clearError: jest.fn()
}

function pc(state: PcState): PcView {
  return {
    state,
    esp32Offline: false,
    esp32NoAnswer: false,
    forcedShutdownUntil: null,
    missing: []
  }
}

function state(over: Record<string, unknown>): void {
  useRemote.setState({
    authorized: 'none',
    pairingCode: null,
    error: null,
    notice: null,
    view: null,
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

  it('trocando de celular à distância: mostra o PC desligado e Ligar chama wake', async () => {
    state({ authorized: 'waiting-pc', view: pc('off') })
    await render(<ControlSetupScreen />)
    expect(actions.startPolling).toHaveBeenCalled()
    expect(screen.getByText(PC_STATE_TEXT.off)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Ligar' }))
    expect(actions.wake).toHaveBeenCalledTimes(1)
    // Unlock, shutdown and cards stay in the PC tab.
    for (const name of ['Desligar', 'Desbloquear', 'Bloquear agora']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('autorizado: também mostra o estado e Ligar com o PC desligado', async () => {
    state({ authorized: 'yes', view: pc('off') })
    await render(<ControlSetupScreen />)
    expect(actions.startPolling).toHaveBeenCalled()
    expect(screen.getByText(PC_STATE_TEXT.off)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeTruthy()
  })

  it('PC ligado: mostra o estado, sem Ligar', async () => {
    state({ authorized: 'waiting-pc', view: pc('waiting-sagyou') })
    await render(<ControlSetupScreen />)
    expect(screen.getByText(PC_STATE_TEXT['waiting-sagyou'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ligar' })).toBeNull()
  })

  it('pedido preso: Cancelar pedido em pendente e aguardando o PC', async () => {
    for (const authorized of ['pending', 'waiting-pc'] as const) {
      jest.clearAllMocks()
      state({ authorized })
      const page = await render(<ControlSetupScreen />)
      await fireEvent.press(screen.getByRole('button', { name: CONTROL_TEXT.cancelRequest }))
      expect(actions.cancelRequest).toHaveBeenCalledTimes(1)
      await page.unmount()
    }
    state({ authorized: 'yes' })
    await render(<ControlSetupScreen />)
    expect(screen.queryByRole('button', { name: CONTROL_TEXT.cancelRequest })).toBeNull()
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
