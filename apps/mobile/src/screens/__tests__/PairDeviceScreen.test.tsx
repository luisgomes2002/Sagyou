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
  FACTOR_HINT,
  FACTOR_LABEL,
  GENERATE_LABEL,
  NEW_CODE_LABEL,
  PAIR_DEVICE_TITLE,
  PAIR_HINT,
  PairDeviceScreen,
  QR_LABEL
} from '../PairDeviceScreen'
import { UNEXPECTED_ERROR_TEXT, countdownText } from '../../sync/invite'
import { SettingsScreen } from '../SettingsScreen'

const CODE = 'sagyou-sync:1:aHR0cHM6Ly9leGVtcGxvLndvcmtlcnMuZGV2:QUJD:convite-de-teste-1234'
const START = Date.UTC(2026, 10, 3, 12)
const TEN_MIN = 10 * 60 * 1000

let clock: number
// Stable across renders, like Date.now: the screen's effects depend on it.
const NOW = (): number => clock
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

/** Types the authenticator code and asks for the invite. */
const pair = async (totp = '123456'): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText(FACTOR_LABEL), totp)
  await fireEvent.press(screen.getByRole('button', { name: GENERATE_LABEL }))
}

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    clock += ms
    jest.advanceTimersByTime(ms)
  })
}

describe('PairDeviceScreen', () => {
  it('pede o código do autenticador antes de gerar; o QR só vem depois', async () => {
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    expect(createInvite).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
    expect(screen.getByText(FACTOR_HINT)).toBeTruthy()
    expect(FACTOR_LABEL).toBe('Código do autenticador')
    expect(FACTOR_HINT).toBe('Ou um código reserva.')
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeDisabled()
    await pair(' 123456 ')
    expect(createInvite).toHaveBeenCalledWith({ totp: '123456' })
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
    // The field went away with its code: a TOTP code is good once.
    expect(screen.queryByLabelText(FACTOR_LABEL)).toBeNull()
  })

  it('gera o convite e mostra QR, instrução e contagem', async () => {
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair()
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

  it('expirado: some o QR e "Gerar outro" pede um código novo do autenticador', async () => {
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await advance(TEN_MIN)
    expect(screen.getByText(EXPIRED_TEXT)).toBeTruthy()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: NEW_CODE_LABEL }))
    expect(screen.getByLabelText(FACTOR_LABEL).props.value).toBe('')
    await pair('654321')
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
  })

  it('Copiar código copia o texto do convite e avisa', async () => {
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODE)
    expect(await screen.findByText(COPIED_TEXT)).toBeTruthy()
  })

  it('erro do engine aparece como está no campo, que volta vazio para tentar de novo', async () => {
    createInvite.mockRejectedValueOnce(new SyncUserError('Código do autenticador inválido.'))
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair('000000')
    expect(await screen.findByText('Código do autenticador inválido.')).toBeTruthy()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
    expect(screen.getByLabelText(FACTOR_LABEL).props.value).toBe('')
    await pair('123456')
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText(QR_LABEL)).toBeTruthy()
  })

  it('um erro inesperado mostra a mensagem genérica', async () => {
    createInvite.mockRejectedValueOnce(new Error('x'))
    withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair()
    expect(await screen.findByText(UNEXPECTED_ERROR_TEXT)).toBeTruthy()
    expect(screen.queryByText('x')).toBeNull()
  })

  it('bloquear ou ir para o fundo fecha a tela e apaga o código', async () => {
    withEngine()
    const goBack = jest.fn()
    await render(<PairDeviceScreen navigation={{ goBack }} now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await act(async () => useLockState.setState({ hidden: true }))
    expect(goBack).toHaveBeenCalled()
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull()
  })

  // Security review: the copied code (it carries the sync key) stayed in the
  // Android clipboard, and the keyboard history, after the screen closed.
  it('bloquear apaga do clipboard o código copiado', async () => {
    withEngine()
    await render(<PairDeviceScreen navigation={{ goBack: jest.fn() }} now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    expect(await Clipboard.getStringAsync()).toBe(CODE)
    await act(async () => useLockState.setState({ hidden: true }))
    expect(await Clipboard.getStringAsync()).toBe('')
  })

  it('expirar e fechar a tela também apagam o código do clipboard', async () => {
    withEngine()
    const first = await render(<PairDeviceScreen now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    await advance(TEN_MIN)
    expect(await Clipboard.getStringAsync()).toBe('')
    await first.unmount()
    const second = await render(<PairDeviceScreen now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    await second.unmount()
    await act(async () => undefined)
    expect(await Clipboard.getStringAsync()).toBe('')
  })

  it('não apaga o que o usuário copiou depois', async () => {
    withEngine()
    await render(<PairDeviceScreen navigation={{ goBack: jest.fn() }} now={NOW} />)
    await pair()
    await screen.findByLabelText(QR_LABEL)
    await fireEvent.press(screen.getByRole('button', { name: COPY_LABEL }))
    await Clipboard.setStringAsync('lista de compras')
    await act(async () => useLockState.setState({ hidden: true }))
    expect(await Clipboard.getStringAsync()).toBe('lista de compras')
  })

  it('o código nunca vai para as prefs nem para o banco', async () => {
    const { writePref, save } = withEngine()
    await render(<PairDeviceScreen now={NOW} />)
    await pair()
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
