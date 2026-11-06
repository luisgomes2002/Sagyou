import type { ApprovalCardBody } from '@sagyou/core/control/bodies'
import type { PcStatus } from '@sagyou/core/control/messages'
import type { PcState, PcView } from '@sagyou/core/control/state'
import { CONTROL_TEXT, PC_STATE_TEXT } from '@sagyou/core/control/texts'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { useRemote } from '../../remote/store'
import { cardCountdown } from '../../remote/texts'
import { CARDS_TITLE, LOADING_TEXT, LOCKED_TEXT, PcScreen, UNLOCKED_TEXT } from '../PcScreen'

const NOW = 1_800_000_000_000

const actions = {
  startPolling: jest.fn(),
  stopPolling: jest.fn(),
  wake: jest.fn(async () => undefined),
  shutdown: jest.fn(async () => undefined),
  forceShutdown: jest.fn(async () => undefined),
  abortShutdown: jest.fn(async () => undefined),
  unlock: jest.fn(async () => undefined),
  lock: jest.fn(async () => undefined),
  installUpdate: jest.fn(async () => undefined),
  answer: jest.fn(async () => undefined)
}

function status(over: Partial<PcStatus> = {}): PcStatus {
  return {
    v: 1,
    at: NOW,
    locked: false,
    servers: [],
    pendingCards: 0,
    shutdownAt: null,
    suspendedUntil: null,
    updateVersion: null,
    ...over
  }
}

function view(state: PcState, over: Partial<PcView> = {}): PcView {
  return { state, esp32Offline: false, missing: [], ...over }
}

function seed(over: Record<string, unknown>): void {
  useRemote.setState({
    authorized: 'yes',
    view: null,
    status: null,
    cards: [],
    error: null,
    connection: null,
    busy: false,
    ...actions,
    ...over
  })
}

const ACTION_LABELS = [
  'Ligar',
  'Desligar',
  'Desbloquear',
  'Bloquear agora',
  'Forçar pelo ESP32',
  'Cancelar',
  'Instalar atualização'
]

/** The action buttons on screen, in the order of ACTION_LABELS. */
function shownActions(): string[] {
  return ACTION_LABELS.filter((name) => screen.queryByRole('button', { name }) !== null)
}

const clock = (): number => NOW

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
})

describe('PcScreen', () => {
  it('sem estado ainda: mostra que está buscando e começa a consultar', async () => {
    seed({})
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy()
    expect(actions.startPolling).toHaveBeenCalledTimes(1)
    expect(shownActions()).toEqual([])
  })

  it('sem conexão e sem estado: mostra o erro de conexão', async () => {
    seed({ connection: CONTROL_TEXT.notDeployed })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.notDeployed)).toBeTruthy()
  })

  const CASES: [string, Record<string, unknown>, string, string[]][] = [
    ['desligado', { view: view('off') }, PC_STATE_TEXT.off, ['Ligar']],
    ['ligando', { view: view('booting') }, PC_STATE_TEXT.booting, []],
    [
      'pronto e desbloqueado',
      { view: view('ready'), status: status() },
      PC_STATE_TEXT.ready,
      ['Desligar', 'Bloquear agora']
    ],
    [
      'pronto e bloqueado',
      { view: view('ready'), status: status({ locked: true }) },
      PC_STATE_TEXT.ready,
      ['Desligar', 'Desbloquear']
    ],
    [
      'Remote Control fora do ar',
      {
        view: view('rc-down', { missing: ['Sagyou', 'Murasaki'] }),
        status: status({ locked: true })
      },
      'PC ligado, Remote Control fora do ar: Sagyou, Murasaki.',
      ['Desligar', 'Desbloquear']
    ],
    [
      'aguardando o Sagyou',
      { view: view('waiting-sagyou') },
      PC_STATE_TEXT['waiting-sagyou'],
      ['Forçar pelo ESP32']
    ],
    [
      'desligando',
      { view: view('shutting-down'), status: status({ shutdownAt: NOW + 58_000 }) },
      'Desligando em 0:58',
      ['Cancelar']
    ]
  ]

  it.each(CASES)('%s: mostra o estado e só os botões dele', async (_, over, text, buttons) => {
    seed(over)
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(text)).toBeTruthy()
    expect(shownActions()).toEqual(buttons)
  })

  it('o estado é lido pelo TalkBack quando muda', async () => {
    seed({ view: view('ready'), status: status() })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(PC_STATE_TEXT.ready).props.accessibilityLiveRegion).toBe('polite')
  })

  it('bloqueado ou desbloqueado só aparece com o PC ligado', async () => {
    seed({ view: view('ready'), status: status({ locked: true }) })
    const ready = await render(<PcScreen now={clock} />)
    expect(screen.getByText(LOCKED_TEXT)).toBeTruthy()
    await ready.unmount()

    seed({ view: view('ready'), status: status() })
    const unlocked = await render(<PcScreen now={clock} />)
    expect(screen.getByText(UNLOCKED_TEXT)).toBeTruthy()
    await unlocked.unmount()

    // An old heartbeat of a PC that is now off says nothing about the lock.
    seed({ view: view('off'), status: status({ locked: true }) })
    await render(<PcScreen now={clock} />)
    expect(screen.queryByText(LOCKED_TEXT)).toBeNull()
    expect(screen.queryByText(UNLOCKED_TEXT)).toBeNull()
  })

  it('ESP32 sem contato aparece junto do estado', async () => {
    seed({ view: view('ready', { esp32Offline: true }), status: status() })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.esp32Offline)).toBeTruthy()
  })

  it('cada botão chama a ação certa', async () => {
    seed({ view: view('off') })
    const off = await render(<PcScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ligar' }))
    expect(actions.wake).toHaveBeenCalledTimes(1)
    await off.unmount()

    seed({ view: view('ready'), status: status({ locked: true }) })
    const locked = await render(<PcScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Desbloquear' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Desligar' }))
    expect(actions.unlock).toHaveBeenCalledTimes(1)
    expect(actions.shutdown).toHaveBeenCalledTimes(1)
    await locked.unmount()

    seed({ view: view('ready'), status: status() })
    const unlocked = await render(<PcScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Bloquear agora' }))
    expect(actions.lock).toHaveBeenCalledTimes(1)
    await unlocked.unmount()

    seed({ view: view('shutting-down'), status: status({ shutdownAt: NOW + 30_000 }) })
    await render(<PcScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
    expect(actions.abortShutdown).toHaveBeenCalledTimes(1)
  })

  it('forçar pelo ESP32 pede a confirmação exata e só força ao confirmar', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    seed({ view: view('waiting-sagyou') })
    await render(<PcScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Forçar pelo ESP32' }))
    expect(actions.forceShutdown).not.toHaveBeenCalled()
    const [title, message, buttons] = alert.mock.calls[0]
    expect(title).toBe('Forçar pelo ESP32')
    expect(message).toBe(
      'O Sagyou não está respondendo. Forçar o desligamento pelo ESP32? O que não foi salvo no Sagyou pode se perder.'
    )
    const cancel = buttons?.find((b) => b.text === 'Cancelar')
    cancel?.onPress?.()
    expect(actions.forceShutdown).not.toHaveBeenCalled()
    const force = buttons?.find((b) => b.text === 'Forçar')
    await act(async () => force?.onPress?.())
    expect(actions.forceShutdown).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('atualização pronta: mostra a versão e instala só depois de confirmar', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    seed({ view: view('ready'), status: status({ updateVersion: '1.6.0' }) })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText('Atualização 1.6.0 pronta')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Instalar atualização' }))
    expect(actions.installUpdate).not.toHaveBeenCalled()
    const [, message, buttons] = alert.mock.calls[0]
    expect(message).toBe(CONTROL_TEXT.installConfirm)
    await act(async () => buttons?.find((b) => b.text === 'Instalar')?.onPress?.())
    expect(actions.installUpdate).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('a falha ao instalar aparece como erro', async () => {
    seed({
      view: view('ready'),
      status: status({ updateVersion: '1.6.0' }),
      error: CONTROL_TEXT.installFailed
    })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.installFailed)).toBeTruthy()
  })

  it('sem atualização ou com o PC desligado, não oferece instalar', async () => {
    seed({ view: view('off'), status: status({ updateVersion: '1.6.0' }) })
    await render(<PcScreen now={clock} />)
    expect(screen.queryByRole('button', { name: 'Instalar atualização' })).toBeNull()
  })

  describe('cartões de aprovação', () => {
    const card = (over: Partial<ApprovalCardBody> = {}): ApprovalCardBody => ({
      id: 'c1',
      session: 'claude',
      tool: 'delete_task',
      resumo: 'Excluir tarefa "Velha"',
      expiresAt: NOW + 299_000,
      ...over
    })

    it('lista com contagem regressiva; Aprovar e Recusar respondem pelo id', async () => {
      seed({ view: view('ready'), status: status(), cards: [card()] })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText(CARDS_TITLE)).toBeTruthy()
      expect(screen.getByText('claude · delete_task · 4:59')).toBeTruthy()
      await fireEvent.press(screen.getByRole('button', { name: 'Aprovar: Excluir tarefa "Velha"' }))
      await fireEvent.press(screen.getByRole('button', { name: 'Recusar: Excluir tarefa "Velha"' }))
      expect(actions.answer).toHaveBeenNthCalledWith(1, 'c1', true)
      expect(actions.answer).toHaveBeenNthCalledWith(2, 'c1', false)
    })

    it('cartão vencido desabilita os botões e diz que expirou', async () => {
      seed({ view: view('ready'), status: status(), cards: [card({ expiresAt: NOW - 1 })] })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText(`claude · delete_task · ${CONTROL_TEXT.cardGone}`)).toBeTruthy()
      for (const name of ['Aprovar: Excluir tarefa "Velha"', 'Recusar: Excluir tarefa "Velha"']) {
        const button = screen.getByRole('button', { name })
        expect(button.props.accessibilityState?.disabled).toBe(true)
        await fireEvent.press(button)
      }
      expect(actions.answer).not.toHaveBeenCalled()
    })

    it('a contagem anda a cada segundo e vence o cartão', async () => {
      jest.useFakeTimers()
      let t = NOW
      seed({ view: view('ready'), status: status(), cards: [card({ expiresAt: NOW + 2_000 })] })
      await render(<PcScreen now={() => t} />)
      expect(screen.getByText('claude · delete_task · 0:02')).toBeTruthy()
      t = NOW + 1_000
      await act(async () => jest.advanceTimersByTime(1_000))
      expect(screen.getByText('claude · delete_task · 0:01')).toBeTruthy()
      t = NOW + 2_000
      await act(async () => jest.advanceTimersByTime(1_000))
      expect(screen.getByText(`claude · delete_task · ${CONTROL_TEXT.cardGone}`)).toBeTruthy()
    })
  })

  it('ocupado: nenhum botão de ação responde', async () => {
    seed({ view: view('ready'), status: status({ locked: true }), busy: true })
    await render(<PcScreen now={clock} />)
    for (const name of ['Desbloquear', 'Desligar']) {
      expect(screen.getByRole('button', { name }).props.accessibilityState?.disabled).toBe(true)
    }
  })

  it('consulta só com a aba em foco e para ao sair dela', async () => {
    seed({ view: view('ready'), status: status() })
    const page = await render(<PcScreen now={clock} focused={false} />)
    expect(actions.startPolling).not.toHaveBeenCalled()
    await page.rerender(<PcScreen now={clock} focused />)
    expect(actions.startPolling).toHaveBeenCalledTimes(1)
    await page.rerender(<PcScreen now={clock} focused={false} />)
    expect(actions.stopPolling).toHaveBeenCalledTimes(1)
    await page.rerender(<PcScreen now={clock} focused />)
    await page.unmount()
    expect(actions.stopPolling).toHaveBeenCalledTimes(2)
  })
})

describe('cardCountdown', () => {
  it('formata minutos e segundos e nunca fica negativo', () => {
    expect(cardCountdown(299_000)).toBe('4:59')
    expect(cardCountdown(1_001)).toBe('0:02')
    expect(cardCountdown(-5_000)).toBe('0:00')
  })
})
