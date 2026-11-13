import type { ApprovalCardBody } from '@sagyou/core/control/bodies'
import type { PcStatus } from '@sagyou/core/control/messages'
import type { PcState, PcView } from '@sagyou/core/control/state'
import { CONTROL_TEXT, PC_STATE_TEXT } from '@sagyou/core/control/texts'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { AccessibilityInfo, Alert } from 'react-native'
import { useRemote } from '../../remote/store'
import { REMOTE_TEXT, SERVER_STATE_TEXT, accessCutText, cardCountdown } from '../../remote/texts'
import { useApp } from '../../store/app'
import { LOADING_TEXT, LOCKED_TEXT, PcScreen, SERVERS_TITLE, UNLOCKED_TEXT } from '../PcScreen'

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
  answer: jest.fn(async () => undefined),
  cutAccess: jest.fn(async () => undefined),
  restoreAccess: jest.fn((factor: string) => Promise.resolve(void factor)),
  startServer: jest.fn((projectId: string) => Promise.resolve(void projectId)),
  stopServer: jest.fn((projectId: string) => Promise.resolve(void projectId))
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
  return {
    state,
    esp32Offline: false,
    esp32NoAnswer: false,
    forcedShutdownUntil: null,
    missing: [],
    ...over
  }
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
    cutUnanswered: false,
    action: null,
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

  it('a contagem do desligamento fica fora da live region (o TalkBack não lê a cada segundo)', async () => {
    seed({ view: view('shutting-down'), status: status({ shutdownAt: NOW + 58_000 }) })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(PC_STATE_TEXT['shutting-down']).props.accessibilityLiveRegion).toBe(
      'polite'
    )
    expect(screen.getByText('Desligando em 0:58').props.accessibilityLiveRegion).toBeUndefined()
  })

  it('desligamento forçado pelo ESP32: contagem e Cancelar manda abort-shutdown', async () => {
    seed({ view: view('off', { forcedShutdownUntil: NOW + 42_000 }) })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText('Desligando em 0:42')).toBeTruthy()
    expect(shownActions()).toEqual(['Cancelar'])
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
    expect(actions.abortShutdown).toHaveBeenCalledTimes(1)
  })

  it('janela do desligamento forçado vencida: volta aos botões do estado', async () => {
    seed({ view: view('off', { forcedShutdownUntil: NOW - 1 }) })
    await render(<PcScreen now={clock} />)
    expect(screen.queryByText(/Desligando em/)).toBeNull()
    expect(shownActions()).toEqual(['Ligar'])
  })

  it('o ESP32 não buscou o comando: mostra que não respondeu', async () => {
    seed({ view: view('off', { esp32NoAnswer: true }) })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.esp32NoAnswer)).toBeTruthy()
  })

  it('sem conexão, o erro da última ação não aparece junto', async () => {
    seed({
      view: view('ready'),
      status: status(),
      connection: CONTROL_TEXT.offline,
      error: CONTROL_TEXT.refused
    })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.offline)).toBeTruthy()
    expect(screen.queryByText(CONTROL_TEXT.refused)).toBeNull()
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

  describe('aviso de aprovações (os cartões moraram para a tela Notificações)', () => {
    const card = (id: string, over: Partial<ApprovalCardBody> = {}): ApprovalCardBody => ({
      id,
      session: 'claude',
      tool: 'delete_task',
      resumo: `Cartão ${id}`,
      expiresAt: NOW + 299_000,
      ...over
    })

    it('a aba PC não desenha os cartões nem Aprovar/Recusar', async () => {
      seed({ view: view('ready'), status: status(), cards: [card('c1')] })
      await render(<PcScreen now={clock} />)
      expect(screen.queryByText('Cartão c1')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Aprovar/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Recusar/ })).toBeNull()
    })

    it('mostra "N aprovações pendentes" (singular com 1) e o botão Ver abre as Notificações', async () => {
      const open = jest.fn()
      seed({ view: view('ready'), status: status(), cards: [card('c1')] })
      await render(<PcScreen now={clock} onOpenNotifications={open} />)
      expect(screen.getByText('1 aprovação pendente')).toBeTruthy()
      seed({ view: view('ready'), status: status(), cards: [card('c1'), card('c2')] })
      await act(async () => undefined)
      expect(screen.getByText('2 aprovações pendentes')).toBeTruthy()
      await fireEvent.press(screen.getByRole('button', { name: 'Ver: 2 aprovações pendentes' }))
      expect(open).toHaveBeenCalledTimes(1)
    })

    it('sem cartões não há aviso', async () => {
      seed({ view: view('ready'), status: status(), cards: [] })
      await render(<PcScreen now={clock} />)
      expect(screen.queryByText(/aprovaç(ão|ões) pendente/)).toBeNull()
      expect(screen.queryByRole('button', { name: /^Ver/ })).toBeNull()
    })
  })

  it('ocupado: nenhum botão de ação responde', async () => {
    seed({ view: view('ready'), status: status({ locked: true }), busy: true })
    await render(<PcScreen now={clock} />)
    for (const name of ['Desbloquear', 'Desligar']) {
      expect(screen.getByRole('button', { name }).props.accessibilityState?.disabled).toBe(true)
    }
  })

  // Spec docs/specs/2026-11-09-servidores-remote-control.md.
  describe('servidores', () => {
    const SERVERS: PcStatus['servers'] = [
      { name: 'Sagyou', up: false, projectId: 'p1', state: 'stopped', autostart: true },
      { name: 'Murasaki', up: true, projectId: 'p2', state: 'running', autostart: true },
      { name: 'Fora', up: true, projectId: 'p3', state: 'external' },
      { name: 'Novo', up: true, projectId: 'p4', state: 'needs-confirm' },
      { name: 'Subindo', up: false, projectId: 'p5', state: 'starting' },
      // A PC before 1.10: only observed, no button.
      { name: 'Antigo', up: true }
    ]
    const button = (
      verb: 'Ligar' | 'Desligar',
      name: string
    ): ReturnType<typeof screen.queryByRole> =>
      screen.queryByRole('button', { name: `${verb} o servidor ${name}` })

    afterEach(() => useApp.setState({ readOnly: false }))

    it('lista cada servidor com o estado e o botão dele', async () => {
      seed({ view: view('ready'), status: status({ servers: SERVERS }) })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText(SERVERS_TITLE)).toBeTruthy()
      for (const name of ['Sagyou', 'Murasaki', 'Fora', 'Novo', 'Subindo', 'Antigo'])
        expect(screen.getByText(name)).toBeTruthy()
      expect(screen.getByText(SERVER_STATE_TEXT.stopped)).toBeTruthy()
      // Murasaki and the old PC's Antigo.
      expect(screen.getAllByText(SERVER_STATE_TEXT.running)).toHaveLength(2)
      expect(screen.getByText(SERVER_STATE_TEXT.external)).toBeTruthy()
      expect(screen.getByText(SERVER_STATE_TEXT['needs-confirm'])).toBeTruthy()
      expect(screen.getByText(SERVER_STATE_TEXT.starting)).toBeTruthy()

      expect(button('Ligar', 'Sagyou')).toBeTruthy()
      expect(button('Desligar', 'Sagyou')).toBeNull()
      for (const name of ['Murasaki', 'Fora', 'Novo', 'Subindo']) {
        expect(button('Desligar', name)).toBeTruthy()
        expect(button('Ligar', name)).toBeNull()
      }
      expect(button('Ligar', 'Antigo')).toBeNull()
      expect(button('Desligar', 'Antigo')).toBeNull()
      // The PC's own buttons are still there and unique.
      expect(shownActions()).toEqual(['Desligar', 'Bloquear agora'])
    })

    it('os rótulos de estado são os combinados', () => {
      expect(SERVER_STATE_TEXT).toEqual({
        running: 'Rodando',
        stopped: 'Parado',
        starting: 'Iniciando…',
        'needs-confirm': 'Confirme no PC',
        external: 'Rodando (fora do Sagyou)'
      })
    })

    it('Ligar e Desligar mandam o projeto do servidor', async () => {
      seed({ view: view('ready'), status: status({ servers: SERVERS }) })
      await render(<PcScreen now={clock} />)
      await fireEvent.press(button('Ligar', 'Sagyou')!)
      expect(actions.startServer).toHaveBeenCalledWith('p1')
      await fireEvent.press(button('Desligar', 'Fora')!)
      expect(actions.stopServer).toHaveBeenCalledWith('p3')
      expect(actions.startServer).toHaveBeenCalledTimes(1)
      expect(actions.stopServer).toHaveBeenCalledTimes(1)
    })

    it('ocupado ou só leitura: os botões dos servidores não respondem', async () => {
      for (const [busy, readOnly] of [
        [true, false],
        [false, true]
      ]) {
        jest.clearAllMocks()
        useApp.setState({ readOnly })
        seed({ view: view('ready'), status: status({ servers: SERVERS }), busy })
        const page = await render(<PcScreen now={clock} />)
        for (const b of [button('Ligar', 'Sagyou')!, button('Desligar', 'Murasaki')!]) {
          expect(b.props.accessibilityState?.disabled).toBe(true)
          await fireEvent.press(b)
        }
        expect(actions.startServer).not.toHaveBeenCalled()
        expect(actions.stopServer).not.toHaveBeenCalled()
        await page.unmount()
      }
    })

    it('a recusa do PC aparece como erro', async () => {
      seed({
        view: view('ready'),
        status: status({ servers: SERVERS }),
        error: REMOTE_TEXT.serverNotConfirmed
      })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText('Confirme este projeto uma vez no PC.')).toBeTruthy()
    })

    it('sem servidores ou com o PC desligado, a seção não aparece', async () => {
      seed({ view: view('ready'), status: status() })
      const empty = await render(<PcScreen now={clock} />)
      expect(screen.queryByText(SERVERS_TITLE)).toBeNull()
      await empty.unmount()

      seed({ view: view('off'), status: status({ servers: SERVERS }) })
      await render(<PcScreen now={clock} />)
      expect(screen.queryByText(SERVERS_TITLE)).toBeNull()
    })
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

  // Spec docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 3.
  describe('cortar e restaurar acesso', () => {
    it('com sinal de vida mostra Cortar acesso, que confirma antes de enviar', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      seed({ view: view('ready'), status: status() })
      await render(<PcScreen now={clock} />)
      await fireEvent.press(screen.getByRole('button', { name: 'Cortar acesso' }))
      expect(actions.cutAccess).not.toHaveBeenCalled()
      const [title, message, buttons] = alert.mock.calls[0]
      expect(title).toBe('Cortar acesso')
      expect(message).toBe(REMOTE_TEXT.cutConfirm)
      expect(REMOTE_TEXT.cutConfirm).toBe(
        'Cortar o acesso remoto? O Claude externo para de funcionar, os servidores de Remote Control são encerrados e o Sagyou é bloqueado. O PC continua ligado.'
      )
      const cut = buttons?.find((b) => b.text === 'Cortar')
      await act(async () => cut?.onPress?.())
      expect(actions.cutAccess).toHaveBeenCalledTimes(1)
      alert.mockRestore()
    })

    // Review of PR #48: "O PC não respondeu. Forçar…?" used to come with no button.
    it('corte sem resposta: oferece Forçar pelo ESP32 mesmo com o PC "pronto"', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      seed({
        view: view('ready'),
        status: status(),
        cutUnanswered: true,
        error: REMOTE_TEXT.cutNoAnswer
      })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText(REMOTE_TEXT.cutNoAnswer)).toBeTruthy()
      await fireEvent.press(screen.getByRole('button', { name: 'Forçar pelo ESP32' }))
      const force = alert.mock.calls[0][2]?.find((b) => b.text === 'Forçar')
      await act(async () => force?.onPress?.())
      expect(actions.forceShutdown).toHaveBeenCalledTimes(1)
      alert.mockRestore()
    })

    it('sem sinal de vida não mostra Cortar acesso', async () => {
      seed({ view: view('off') })
      await render(<PcScreen now={clock} />)
      expect(screen.queryByRole('button', { name: 'Cortar acesso' })).toBeNull()
    })

    it('com o acesso cortado: faixa com a hora e Restaurar acesso com o código', async () => {
      const cutAt = NOW - 60_000
      seed({ view: view('ready'), status: status({ accessCutAt: cutAt }) })
      await render(<PcScreen now={clock} />)
      expect(screen.getByText(accessCutText(cutAt))).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Cortar acesso' })).toBeNull()
      const restore = screen.getByRole('button', { name: 'Restaurar acesso' })
      expect(restore.props.accessibilityState?.disabled).toBe(true)
      await fireEvent.changeText(
        screen.getByLabelText('Código do autenticador ou reserva'),
        '123456'
      )
      await fireEvent.press(screen.getByRole('button', { name: 'Restaurar acesso' }))
      expect(actions.restoreAccess).toHaveBeenCalledWith('123456')
      // The code is not kept on screen after it was sent.
      expect(screen.getByLabelText('Código do autenticador ou reserva').props.value).toBe('')
    })
  })
})

// Spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md: the steps of Ligar/Desligar.
describe('PcScreen: etapas das ações', () => {
  const progress = (over: Record<string, unknown>): Record<string, unknown> => ({
    kind: 'wake',
    step: 'waiting',
    startedAt: NOW,
    text: 'Pedido enviado. Aguardando o PC…',
    ...over
  })
  const disabled = (name: string): unknown =>
    screen.getByRole('button', { name }).props.accessibilityState?.disabled
  const SERVERS: PcStatus['servers'] = [
    { name: 'Sagyou', up: false, projectId: 'p1', state: 'starting', autostart: true },
    { name: 'Murasaki', up: true, projectId: 'p2', state: 'running', autostart: true }
  ]

  it('Ligar PC esperando: o botão continua na tela, desabilitado, com indicador e o texto', async () => {
    // The PC already says "Ligando": the button of the action must not vanish with it.
    seed({
      view: view('booting'),
      action: progress({ text: 'Ligando o PC… pode levar alguns minutos.' })
    })
    await render(<PcScreen now={clock} />)
    expect(disabled('Ligar')).toBe(true)
    expect(screen.getByRole('button', { name: 'Ligar' }).props.accessibilityState?.busy).toBe(true)
    expect(screen.getByTestId('spinner')).toBeTruthy()
    expect(screen.getAllByText('Ligando o PC… pode levar alguns minutos.')).toBeTruthy()
    expect(shownActions()).toEqual(['Ligar'])
  })

  it('Desligar PC esperando: Desligar fica desabilitado e os outros botões também', async () => {
    seed({
      view: view('ready'),
      status: status(),
      action: progress({ kind: 'shutdown', text: 'Enviando pedido…', step: 'sending' })
    })
    await render(<PcScreen now={clock} />)
    expect(shownActions()).toEqual(['Desligar', 'Bloquear agora'])
    expect(disabled('Desligar')).toBe(true)
    expect(disabled('Bloquear agora')).toBe(true)
    expect(screen.getByText('Enviando pedido…')).toBeTruthy()
    expect(disabled('Cortar acesso')).toBe(true)
  })

  it('Ligar servidor esperando: o botão do servidor fica com Ligar e indicador, mesmo já "Iniciando…"', async () => {
    seed({
      view: view('ready'),
      status: status({ servers: SERVERS }),
      action: progress({ kind: 'server-start', projectId: 'p1', name: 'Sagyou' })
    })
    await render(<PcScreen now={clock} />)
    const mine = screen.getByRole('button', { name: 'Ligar o servidor Sagyou' })
    expect(mine.props.accessibilityState?.disabled).toBe(true)
    expect(mine.props.accessibilityState?.busy).toBe(true)
    // The other server's button is disabled too, without an indicator of its own.
    const other = screen.getByRole('button', { name: 'Desligar o servidor Murasaki' })
    expect(other.props.accessibilityState?.disabled).toBe(true)
    expect(other.props.accessibilityState?.busy).toBe(false)
    expect(screen.getAllByText('Pedido enviado. Aguardando o PC…')).toHaveLength(1)
  })

  it('concluído mostra o texto e libera os botões; falhou também', async () => {
    seed({
      view: view('ready'),
      status: status({ servers: [{ ...SERVERS[0], state: 'running' }, SERVERS[1]] }),
      action: progress({
        kind: 'server-start',
        projectId: 'p1',
        name: 'Sagyou',
        step: 'done',
        text: 'Servidor Sagyou ligado.'
      })
    })
    await render(<PcScreen now={clock} />)
    expect(screen.getByText('Servidor Sagyou ligado.')).toBeTruthy()
    expect(screen.queryByTestId('spinner')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Desligar o servidor Sagyou' }).props.accessibilityState
        ?.disabled
    ).toBe(false)

    seed({
      view: view('off'),
      action: progress({ step: 'failed', text: 'O PC não respondeu. Tente de novo.' })
    })
    await act(async () => undefined)
    expect(screen.getByText('O PC não respondeu. Tente de novo.')).toBeTruthy()
    expect(disabled('Ligar')).toBe(false)
  })

  it('sem animações: o texto da etapa fica e o indicador não é desenhado', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    try {
      seed({
        view: view('booting'),
        action: progress({ text: 'Ligando o PC… pode levar alguns minutos.' })
      })
      await render(<PcScreen now={clock} />)
      await act(async () => undefined)
      expect(screen.queryByTestId('spinner')).toBeNull()
      expect(screen.getByText('Ligando o PC… pode levar alguns minutos.')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })

  it('a etapa é uma região viva para o leitor de tela', async () => {
    seed({ view: view('booting'), action: progress({}) })
    await render(<PcScreen now={clock} />)
    expect(screen.getByTestId('action-status').props.accessibilityLiveRegion).toBe('polite')
  })
})
