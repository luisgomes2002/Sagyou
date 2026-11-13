import type { ApprovalCardBody } from '@sagyou/core/control/bodies'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { useNotifications } from '../../notifications/store'
import { useRemote } from '../../remote/store'
import { useApp } from '../../store/app'
import { NotificationBell } from '../NotificationBell'

const NOW = 1_800_000_000_000

const card = (id: string, expiresAt = NOW + 60_000): ApprovalCardBody => ({
  id,
  session: 'claude',
  tool: 'delete_task',
  resumo: `Excluir ${id}`,
  expiresAt
})

function seed(
  over: {
    authorized?: 'none' | 'pending' | 'yes'
    cards?: ApprovalCardBody[]
    unread?: number
  } = {},
  readOnly = false
): void {
  useRemote.setState({ authorized: over.authorized ?? 'yes', cards: over.cards ?? [] })
  useApp.setState({ readOnly })
  useNotifications.setState({ entries: [], unread: over.unread ?? 0 })
}

beforeEach(() => {
  jest.useRealTimers()
  seed()
})

afterEach(() => {
  useRemote.setState({ authorized: 'none', cards: [] })
  useApp.setState({ readOnly: false })
  useNotifications.setState({ entries: [], unread: 0 })
})

describe('NotificationBell', () => {
  it('só existe num celular autorizado que pode enviar', async () => {
    const cases: [string, 'none' | 'pending' | 'yes', boolean, boolean][] = [
      ['sem autorização', 'none', false, false],
      ['pendente', 'pending', false, false],
      ['autorizado', 'yes', false, true],
      ['autorizado, só leitura', 'yes', true, false]
    ]
    for (const [name, authorized, readOnly, shown] of cases) {
      seed({ authorized }, readOnly)
      const view = await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
      expect([name, screen.queryByRole('button', { name: 'Notificações' }) !== null]).toEqual([
        name,
        shown
      ])
      await view.unmount()
    }
  })

  it('sem cartões e sem não lidas: só o sino, sem selo nem ponto', async () => {
    await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeTruthy()
    expect(screen.queryByTestId('bell-dot')).toBeNull()
  })

  it('com 3 cartões válidos mostra o número e o rótulo diz quantas aprovações', async () => {
    seed({ cards: [card('a'), card('b'), card('c')] })
    await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
    expect(screen.getByText('3')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Notificações, 3 aprovações pendentes' })
    ).toBeTruthy()
  })

  it('1 cartão usa o singular no rótulo', async () => {
    seed({ cards: [card('a')] })
    await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
    expect(screen.getByRole('button', { name: 'Notificações, 1 aprovação pendente' })).toBeTruthy()
  })

  it('só não lidas: um ponto, sem número', async () => {
    seed({ unread: 2 })
    await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
    expect(screen.getByTestId('bell-dot')).toBeTruthy()
    expect(screen.queryByText('2')).toBeNull()
  })

  it('com cartões o número manda sobre o ponto', async () => {
    seed({ cards: [card('a')], unread: 4 })
    await render(<NotificationBell onPress={jest.fn()} now={() => NOW} />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.queryByTestId('bell-dot')).toBeNull()
  })

  it('um cartão que expira com a tela em outra aba baixa o número sem polling', async () => {
    jest.useFakeTimers()
    let t = NOW
    seed({ cards: [card('a', NOW + 1500), card('b', NOW + 60_000)] })
    const view = await render(<NotificationBell onPress={jest.fn()} now={() => t} />)
    expect(screen.getByText('2')).toBeTruthy()
    t = NOW + 2000
    await act(async () => jest.advanceTimersByTime(2000))
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Notificações, 1 aprovação pendente' })).toBeTruthy()
    // The clock is cleared on unmount.
    const clear = jest.spyOn(globalThis, 'clearInterval')
    await view.unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })

  it('o toque chama onPress', async () => {
    const onPress = jest.fn()
    await render(<NotificationBell onPress={onPress} now={() => NOW} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Notificações' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
