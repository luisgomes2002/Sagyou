import { SyncUserError } from '@sagyou/core/sync/engine'
import * as Clipboard from 'expo-clipboard'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { seedApp } from '../../__tests__/seed'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import type { AppServices } from '../../store/app'
import {
  COPIED_TEXT,
  COPY_LABEL,
  EXPIRED_TEXT,
  NEW_CODE_LABEL,
  PAIR_DEVICE_TITLE,
  PAIR_HINT,
  PairDeviceScreen,
  QR_LABEL,
  RETRY_LABEL,
  UNEXPECTED_ERROR_TEXT,
  countdownText
} from '../PairDeviceScreen'
import { SettingsScreen } from '../SettingsScreen'

const CODE = 'sagyou-sync:1:aHR0cHM6Ly9leGVtcGxvLndvcmtlcnMuZGV2:QUJD:convite-de-teste-1234'
const START = Date.UTC(2026, 10, 3, 12)
const TEN_MIN = 10 * 60 * 1000

let clock: number
let createInvite: jest.Mock

function withEngine(): { writePref: jest.Mock; save: jest.Mock } {
  const seeded = seedApp()
  const services = useApp.getState().services as AppServices
  useApp.setState({
    services: {
      ...services,
      runtime: { ...services.runtime, engine: { ...services.runtime.engine, createInvite } }
    } as unknown as AppServices
  })
  return seeded
}

beforeEach(() => {
  jest.useFakeTimers()
  clock = START
  createInvite = jest.fn(async () => ({ code: CODE, expiresAt: START + TEN_MIN }))
  useLockState.setState({ hidden: false })
})

afterEach(() => {
  jest.useRealTimers()
})

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    clock += ms
    jest.advanceTimersByTime(ms)
  })
}

describe('PairDeviceScreen', () => {
  it('gera o convite ao abrir e mostra QR, instrução e contagem', async () => {
    withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    expect(createInvite).toHaveBeenCalledTimes(1)
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
    expect(screen.getByText(PAIR_HINT)).toBeTruthy()
    expect(PAIR_HINT).toBe(
      'Escaneie no outro aparelho, ou cole o código em Configurações → Sincronização → Entrar com código.'
    )
    expect(screen.getByText('Vale uma vez só e expira em 10:00')).toBeTruthy()
    await advance(1000)
    expect(screen.getByText('Vale uma vez só e expira em 9:59')).toBeTruthy()
  })

  it('expirado: some o QR e "Gerar outro" pede um convite novo', async () => {
    withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    await screen.findByLabelText(QR_LABEL)
    await advance(TEN_MIN)
    expect(screen.getByText(EXPIRED_TEXT)).toBeTruthy()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: NEW_CODE_LABEL }))
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
  })

  it('Copiar código copia o texto do convite e avisa', async () => {
    withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODE)
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy()
  })

  it('offline: mostra a mensagem do engine e "Tentar de novo"', async () => {
    createInvite.mockRejectedValueOnce(
      new SyncUserError('Sem conexão com o servidor de sincronização.')
    )
    withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    expect(await screen.findByText('Sem conexão com o servidor de sincronização.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: RETRY_LABEL }))
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
  })

  it('um erro inesperado mostra a mensagem genérica', async () => {
    createInvite.mockRejectedValueOnce(new Error('x'))
    withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    expect(await screen.findByText(UNEXPECTED_ERROR_TEXT)).toBeTruthy()
    expect(screen.queryByText('x')).toBeNull()
  })

  it('bloquear ou ir para o fundo fecha a tela e apaga o código', async () => {
    withEngine()
    const goBack = jest.fn()
    await render(<PairDeviceScreen navigation={{ goBack }} now={() => clock} />)
    await screen.findByLabelText(QR_LABEL)
    await act(async () => useLockState.setState({ hidden: true }))
    expect(goBack).toHaveBeenCalled()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
  })

  it('o código nunca vai para as prefs nem para o banco', async () => {
    const { writePref, save } = withEngine()
    await render(<PairDeviceScreen now={() => clock} />)
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    expect(JSON.stringify(writePref.mock.calls)).not.toContain('sagyou-sync:')
    expect(JSON.stringify(save.mock.calls)).not.toContain('sagyou-sync:')
  })

  it('countdownText', () => {
    expect(countdownText(START + TEN_MIN, START)).toBe('10:00')
    expect(countdownText(START + 61_000, START)).toBe('1:01')
    expect(countdownText(START, START + 5000)).toBe('0:00')
  })
})

describe('Ajustes → Parear outro aparelho', () => {
  const STATUS = {
    state: 'ok' as const,
    lastSyncAt: Date.now(),
    pendingCount: 0,
    paused: null,
    deviceName: 'Pixel',
    conflictCount: 0
  }

  it('abre a tela de pareamento', async () => {
    withEngine()
    useApp.setState({ status: STATUS })
    const navigate = jest.fn()
    await render(<SettingsScreen navigation={{ navigate }} />)
    await fireEvent.press(screen.getByText(PAIR_DEVICE_TITLE))
    expect(navigate).toHaveBeenCalledWith('ParearAparelho')
  })

  it('some quando a sessão foi perdida (só leitura)', async () => {
    seedApp({}, { readOnly: true })
    useApp.setState({ status: STATUS })
    await render(<SettingsScreen />)
    expect(screen.queryByText(PAIR_DEVICE_TITLE)).toBeNull()
  })
})
