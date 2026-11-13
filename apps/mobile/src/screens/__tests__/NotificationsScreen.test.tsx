import type { ApprovalCardBody } from '@sagyou/core/control/bodies'
import { CONTROL_TEXT } from '@sagyou/core/control/texts'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import type { HistoryEntry } from '../../notifications/history'
import { useNotifications } from '../../notifications/store'
import { useRemote } from '../../remote/store'
import { NotificationsScreen } from '../NotificationsScreen'

const NOW = new Date(2026, 10, 13, 15, 0).getTime()
const clock = (): number => NOW

const answer = jest.fn(async () => undefined)
const startPolling = jest.fn()
const stopPolling = jest.fn()

const card = (id: string, over: Partial<ApprovalCardBody> = {}): ApprovalCardBody => ({
  id,
  session: 'claude',
  tool: 'delete_task',
  resumo: `Excluir ${id}`,
  expiresAt: NOW + 299_000,
  ...over
})

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'n1',
  code: 'ready',
  at: new Date(2026, 10, 13, 14, 32).getTime(),
  read: true,
  ...over
})

function seed(
  cards: ApprovalCardBody[],
  entries: HistoryEntry[],
  over: Record<string, unknown> = {}
): void {
  useRemote.setState({
    authorized: 'yes',
    cards,
    busy: false,
    error: null,
    connection: null,
    answer,
    startPolling,
    stopPolling,
    ...over
  })
  useNotifications.setState({ entries, unread: entries.filter((e) => !e.read).length })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
})

describe('NotificationsScreen', () => {
  it('cartões: título com a contagem, Aprovar e Recusar respondem pelo id', async () => {
    seed([card('c1'), card('c2')], [])
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText('Aprovações pendentes (2)')).toBeTruthy()
    expect(screen.getAllByText('claude · delete_task · 4:59')).toHaveLength(2)
    await fireEvent.press(screen.getByRole('button', { name: 'Aprovar: Excluir c1' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Recusar: Excluir c2' }))
    expect(answer).toHaveBeenNthCalledWith(1, 'c1', true)
    expect(answer).toHaveBeenNthCalledWith(2, 'c2', false)
  })

  it('cartão vencido desabilita os botões e diz que expirou', async () => {
    seed([card('c1', { expiresAt: NOW - 1 })], [])
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText(`claude · delete_task · ${CONTROL_TEXT.cardGone}`)).toBeTruthy()
    expect(screen.getByText('Aprovações pendentes (0)')).toBeTruthy()
    for (const name of ['Aprovar: Excluir c1', 'Recusar: Excluir c1']) {
      const button = screen.getByRole('button', { name })
      expect(button.props.accessibilityState?.disabled).toBe(true)
      await fireEvent.press(button)
    }
    expect(answer).not.toHaveBeenCalled()
  })

  it('ocupado: os botões dos cartões não respondem', async () => {
    seed([card('c1')], [], { busy: true })
    await render(<NotificationsScreen now={clock} />)
    expect(
      screen.getByRole('button', { name: 'Aprovar: Excluir c1' }).props.accessibilityState?.disabled
    ).toBe(true)
  })

  it('a contagem anda a cada segundo, vence o cartão e o título acompanha', async () => {
    jest.useFakeTimers()
    let t = NOW
    seed([card('c1', { expiresAt: NOW + 2_000 })], [])
    await render(<NotificationsScreen now={() => t} />)
    expect(screen.getByText('claude · delete_task · 0:02')).toBeTruthy()
    t = NOW + 1_000
    await act(async () => jest.advanceTimersByTime(1_000))
    expect(screen.getByText('claude · delete_task · 0:01')).toBeTruthy()
    t = NOW + 2_000
    await act(async () => jest.advanceTimersByTime(1_000))
    expect(screen.getByText(`claude · delete_task · ${CONTROL_TEXT.cardGone}`)).toBeTruthy()
    expect(screen.getByText('Aprovações pendentes (0)')).toBeTruthy()
  })

  it('sem cartões a seção não aparece', async () => {
    seed([], [entry()])
    await render(<NotificationsScreen now={clock} />)
    expect(screen.queryByText(/Aprovações pendentes/)).toBeNull()
  })

  it('histórico: texto, categoria, data e hora, mais nova primeiro', async () => {
    seed(
      [],
      [
        entry({ id: 'a', code: 'server-ready', at: new Date(2026, 10, 13, 14, 32).getTime() }),
        entry({ id: 'b', code: 'device-paired', at: new Date(2026, 10, 12, 9, 10).getTime() }),
        entry({
          id: 'c',
          code: 'unknown',
          text: 'Aviso novo',
          at: new Date(2026, 10, 8, 23, 5).getTime()
        })
      ]
    )
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText('Histórico')).toBeTruthy()
    expect(screen.getByText('Servidor de Remote Control ligado.')).toBeTruthy()
    expect(screen.getByText('PC e servidores · hoje 14:32')).toBeTruthy()
    expect(screen.getByText('Um aparelho foi pareado ao seu sync.')).toBeTruthy()
    expect(screen.getByText('Segurança · ontem 09:10')).toBeTruthy()
    expect(screen.getByText('Aviso novo')).toBeTruthy()
    expect(screen.getByText('08/11 23:05')).toBeTruthy()
  })

  it('abrir a tela marca tudo como lido, mas as não lidas ficam em negrito nesta visita', async () => {
    seed([], [entry({ id: 'a', read: false }), entry({ id: 'b', code: 'access-cut', read: true })])
    await render(<NotificationsScreen now={clock} />)
    expect(useNotifications.getState().unread).toBe(0)
    const bold = (text: string): unknown =>
      screen
        .getByText(text)
        .props.style.flat?.()
        .some((x: { fontWeight?: string } | null) => x?.fontWeight === '700')
    expect(bold('PC pronto.')).toBe(true)
    expect(bold('Acesso remoto cortado.')).toBe(false)
  })

  it('entrada de aprovação: "Responder acima" com cartão válido, "Expirou" sem nenhum', async () => {
    seed([card('c1')], [entry({ id: 'a', code: 'approval' })])
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText(/Sessões de código · hoje 14:32 · Responder acima/)).toBeTruthy()
    seed([], [entry({ id: 'a', code: 'approval' })])
    await act(async () => undefined)
    expect(screen.getByText(/Sessões de código · hoje 14:32 · Expirou/)).toBeTruthy()
  })

  it('tocar numa entrada leva à aba PC; uma aprovação não navega (os cartões já estão acima)', async () => {
    const navigate = jest.fn()
    seed(
      [],
      [
        entry({ id: 'a', code: 'ready' }),
        entry({ id: 'b', code: 'approval', at: NOW - 10 * 60_000 })
      ]
    )
    await render(<NotificationsScreen navigation={{ navigate }} now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: /PC pronto\./ }))
    expect(navigate).toHaveBeenCalledWith('Abas', { screen: 'PC' })
    expect(screen.queryByRole('button', { name: /Aprovação pendente no Sagyou\./ })).toBeNull()
  })

  it('Limpar histórico apaga só o histórico, nunca os cartões', async () => {
    seed([card('c1')], [entry()])
    await render(<NotificationsScreen now={clock} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Limpar histórico' }))
    expect(useNotifications.getState().entries).toEqual([])
    expect(screen.queryByText('PC pronto.')).toBeNull()
    expect(screen.getByText('Aprovações pendentes (1)')).toBeTruthy()
    // And what was in the bar goes too, or it would come back when the app returns.
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1)
  })

  it('sem nada: só o estado vazio', async () => {
    seed([], [])
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText('Nenhuma notificação ainda.')).toBeTruthy()
    expect(screen.queryByText('Histórico')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Limpar histórico' })).toBeNull()
  })

  it('sem conexão mostra o aviso de conexão que a aba PC usa', async () => {
    seed([], [], { connection: CONTROL_TEXT.notDeployed })
    await render(<NotificationsScreen now={clock} />)
    expect(screen.getByText(CONTROL_TEXT.notDeployed)).toBeTruthy()
  })

  it('liga o polling de 5 s ao focar e desliga ao sair', async () => {
    seed([], [])
    const view = await render(<NotificationsScreen now={clock} />)
    expect(startPolling).toHaveBeenCalledTimes(1)
    await view.unmount()
    expect(stopPolling).toHaveBeenCalledTimes(1)

    jest.clearAllMocks()
    await render(<NotificationsScreen now={clock} focused={false} />)
    expect(startPolling).not.toHaveBeenCalled()
  })
})
