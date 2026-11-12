import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import { Text } from 'react-native'
import * as RN from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppShell, TAB_LABELS } from '../App'
import { navigationRef } from '../navigation'
import { StatusBanner } from '../components/StatusBanner'
import { LockGate, type LockDeps } from '../lock/LockGate'
import { useRemote } from '../remote/store'
import { LOADING_TEXT } from '../screens/PcScreen'
import { LOCKED_TITLE } from '../lock/texts'
import { PAIR_TITLE } from '../screens/PairScreen'
import { type AppServices, DISCONNECTED_TEXT, OFFLINE_TEXT, useApp } from '../store/app'
import { useUpdate } from '../store/update'
import { T, project, seedApp } from './seed'
import { darkTheme, lightTheme, useTheme } from '../theme'

function Probe(): React.JSX.Element {
  return <Text testID="bg">{useTheme().bg}</Text>
}

describe('App', () => {
  // The shell checks GitHub for a newer APK; no test may reach the network.
  const autoCheck = jest.fn(async () => undefined)
  beforeEach(() => {
    autoCheck.mockClear()
    useUpdate.getState().reset()
    useUpdate.setState({ autoCheck })
  })
  afterEach(() => jest.restoreAllMocks())

  it('procura atualização uma vez ao abrir o app, também só leitura', async () => {
    for (const readOnly of [false, true]) {
      autoCheck.mockClear()
      seedApp({}, { readOnly })
      const view = await render(
        <SafeAreaProvider>
          <AppShell mode="app" />
        </SafeAreaProvider>
      )
      expect(autoCheck).toHaveBeenCalledTimes(1)
      await view.unmount()
    }
  })

  it('não procura atualização antes de parear nem carregando', async () => {
    seedApp()
    for (const mode of ['pair', 'loading'] as const) {
      const view = await render(
        <SafeAreaProvider>
          <AppShell mode={mode} />
        </SafeAreaProvider>
      )
      await view.unmount()
    }
    expect(autoCheck).not.toHaveBeenCalled()
  })

  it('mostra as quatro abas com os rótulos exatos, sem Busca na barra', async () => {
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(TAB_LABELS).toEqual(['Tarefas', 'Hábitos', 'Finanças', 'Notas'])
    for (const label of TAB_LABELS) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('tab-Busca')).toBeNull()
  })

  it('a aba PC só aparece num celular autorizado que pode enviar', async () => {
    const polling = { startPolling: jest.fn(), stopPolling: jest.fn() }
    const cases: [string, 'none' | 'pending' | 'yes', boolean, boolean][] = [
      ['sem autorização', 'none', false, false],
      ['pendente', 'pending', false, false],
      ['autorizado', 'yes', false, true],
      ['autorizado, só leitura', 'yes', true, false]
    ]
    for (const [name, authorized, readOnly, shown] of cases) {
      seedApp({}, { readOnly })
      useRemote.setState({ authorized, view: null, status: null, cards: [], ...polling })
      const view = await render(
        <SafeAreaProvider>
          <AppShell mode="app" />
        </SafeAreaProvider>
      )
      expect([name, screen.queryByTestId('tab-PC') !== null]).toEqual([name, shown])
      await view.unmount()
    }
    useRemote.setState({ authorized: 'none' })
  })

  it('tocar na notificação do PC abre a aba PC e o token vai para o Worker', async () => {
    const putPushToken = jest.fn(async () => undefined)
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ granted: true } as never)
    jest
      .mocked(Notifications.getDevicePushTokenAsync)
      .mockResolvedValueOnce({ type: 'android', data: 'fcm-token' } as never)
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce({
      notification: { request: { content: { data: { open: 'pc' } } } }
    } as never)
    seedApp({ projects: [project('p1', 'Sagyou')] })
    useRemote.setState({
      authorized: 'yes',
      view: null,
      status: null,
      cards: [],
      connection: null,
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
      putPushToken
    })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(await screen.findByText(LOADING_TEXT)).toBeTruthy()
    expect(putPushToken).toHaveBeenCalledWith('fcm-token')
    useRemote.setState({ authorized: 'none' })
  })

  it('a mesma notificação já tratada não reabre a aba PC ao montar de novo', async () => {
    const tap = {
      notification: {
        request: { identifier: 'app-test-tap-1', content: { data: { open: 'pc' } } }
      }
    }
    seedApp({ projects: [project('p1', 'Sagyou')] })
    useRemote.setState({
      authorized: 'yes',
      view: null,
      status: null,
      cards: [],
      connection: null,
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
      putPushToken: jest.fn(async () => undefined)
    })
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce(tap as never)
    const first = await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(await screen.findByText(LOADING_TEXT)).toBeTruthy()
    await first.unmount()

    let asked = false
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockImplementationOnce(async () => {
      asked = true
      return tap as never
    })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    await act(async () => undefined)
    expect(asked).toBe(true)
    expect(screen.queryByText(LOADING_TEXT)).toBeNull()
    useRemote.setState({ authorized: 'none' })
  })

  it('sem autorização, nem token nem navegação pela notificação', async () => {
    const putPushToken = jest.fn(async () => undefined)
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockClear()
    seedApp({ projects: [project('p1', 'Sagyou')] })
    useRemote.setState({ authorized: 'none', putPushToken })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(Notifications.getLastNotificationResponseAsync).not.toHaveBeenCalled()
    expect(putPushToken).not.toHaveBeenCalled()
    expect(screen.queryByText(LOADING_TEXT)).toBeNull()
  })

  it('cada aba tem ícone e o header abre Ajustes pela engrenagem', async () => {
    seedApp({ projects: [project('p1', 'Sagyou')] })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    // The tab bar draws each icon twice (active and inactive, for the crossfade).
    for (const label of TAB_LABELS)
      expect(screen.getAllByTestId(`tab-icon-${label}`).length).toBeGreaterThan(0)
    await fireEvent.press(screen.getByRole('button', { name: 'Ajustes' }))
    expect(await screen.findByText('Perfil financeiro')).toBeTruthy()
  })

  it('o (+) aparece nas quatro abas de conteúdo', async () => {
    seedApp({ projects: [project('p1', 'Sagyou')] })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    for (const label of ['Hábitos', 'Finanças', 'Notas', 'Tarefas']) {
      // The tab's role is "tab" on Android and "button" on iOS (the test platform).
      await fireEvent.press(screen.getByTestId(`tab-${label}`))
      expect([label, screen.queryByRole('button', { name: 'Criar' }) !== null]).toEqual([
        label,
        true
      ])
    }
  })

  describe('Busca no cabeçalho', () => {
    const hits = [
      { kind: 'task' as const, id: 't1', title: 'Comprar pão', parentId: 'p1' },
      { kind: 'project' as const, id: 'p1', title: 'Sagyou', parentId: null },
      { kind: 'note' as const, id: 'n1', title: 'Ideia', parentId: 'p1' },
      { kind: 'habit' as const, id: 'h1', title: 'Ler', parentId: null },
      { kind: 'transaction' as const, id: 'x1', title: 'Mercado', parentId: 'ft1' }
    ]

    async function openSearch(): Promise<void> {
      seedApp({
        projects: [project('p1', 'Sagyou')],
        tasks: [
          {
            id: 't1',
            projectId: 'p1',
            columnId: 'p1-todo',
            title: 'Comprar pão',
            priority: 'medium',
            tags: [],
            order: 0,
            createdAt: T,
            updatedAt: T
          }
        ]
      })
      const services = useApp.getState().services as AppServices
      useApp.setState({ services: { ...services, search: () => hits } as AppServices })
      await render(
        <SafeAreaProvider>
          <AppShell mode="app" />
        </SafeAreaProvider>
      )
      await fireEvent.press(screen.getAllByRole('button', { name: 'Buscar' })[0])
      await fireEvent.changeText(await screen.findByPlaceholderText('Buscar'), 'a')
    }

    const rootNames = (): string[] =>
      (navigationRef.getRootState()?.routes ?? []).map((r) => r.name)
    const tasksStack = (): string[] => {
      const tabs = navigationRef.getRootState()?.routes[0]?.state
      const tasks = tabs?.routes.find((r) => r.name === 'Tarefas')
      return (tasks?.state?.routes ?? []).map((r) => r.name)
    }

    it('a lupa abre a Busca por cima das abas, e a Busca não tem (+)', async () => {
      await openSearch()
      expect(rootNames()).toEqual(['Abas', 'Busca'])
      const search = screen.getByTestId('search-screen')
      expect(within(search).queryByRole('button', { name: 'Criar' })).toBeNull()
    })

    // Review: navigate('Abas') from Busca pushed a second copy of the tabs every time.
    it('abrir um resultado volta para as abas, sem empilhar outra cópia', async () => {
      await openSearch()
      await fireEvent.press(screen.getByRole('button', { name: 'Ideia' }))
      expect(rootNames()).toEqual(['Abas'])
      await fireEvent.press(screen.getAllByRole('button', { name: 'Buscar' })[0])
      await fireEvent.changeText(await screen.findByPlaceholderText('Buscar'), 'a')
      await fireEvent.press(screen.getByRole('button', { name: 'Comprar pão' }))
      expect(rootNames()).toEqual(['Abas'])
      // The form opens over the project list, so "Salvar" goes back into Tarefas.
      expect(tasksStack()).toEqual(['Projetos', 'Tarefa'])
    })

    // Review: a reused route kept the previous record's state; "Salvar" wrote X's fields over Y.
    it('abrir outra tarefa pela Busca com uma aberta mostra a tarefa nova', async () => {
      await openSearch()
      useApp.setState((st) => ({
        state: {
          ...st.state,
          tasks: [
            ...st.state.tasks,
            { ...st.state.tasks[0], id: 't2', title: 'Pagar luz', order: 1 }
          ]
        }
      }))
      await fireEvent.press(screen.getByRole('button', { name: 'Comprar pão' }))
      expect(await screen.findByDisplayValue('Comprar pão')).toBeTruthy()
      const services = useApp.getState().services as AppServices
      useApp.setState({
        services: {
          ...services,
          search: () => [{ kind: 'task' as const, id: 't2', title: 'Pagar luz', parentId: 'p1' }]
        } as AppServices
      })
      await fireEvent.press(screen.getAllByRole('button', { name: 'Buscar' })[0])
      await fireEvent.changeText(await screen.findByPlaceholderText('Buscar'), 'luz')
      await fireEvent.press(screen.getByRole('button', { name: 'Pagar luz' }))
      expect(await screen.findByDisplayValue('Pagar luz')).toBeTruthy()
      expect(screen.queryByDisplayValue('Comprar pão')).toBeNull()
    })

    it('um resultado de tarefa abre o formulário dela', async () => {
      await openSearch()
      await fireEvent.press(screen.getByRole('button', { name: 'Comprar pão' }))
      expect(await screen.findByDisplayValue('Comprar pão')).toBeTruthy()
    })

    it('um resultado de projeto abre o projeto', async () => {
      await openSearch()
      await fireEvent.press(screen.getByRole('button', { name: 'Sagyou' }))
      expect(await screen.findByRole('button', { name: /^Sprint:/ })).toBeTruthy()
    })

    it.each([
      ['Ideia', 'Notas'],
      ['Ler', 'Hábitos'],
      ['Mercado', 'Finanças']
    ])('%s abre a aba %s', async (title, tab) => {
      await openSearch()
      await fireEvent.press(screen.getByRole('button', { name: title }))
      expect(screen.queryByTestId('search-screen')).toBeNull()
      expect(screen.getByTestId(`tab-${tab}`).props.accessibilityState).toMatchObject({
        selected: true
      })
    })
  })

  // Review: the (+) sat on top of the note editor's "Salvar".
  it('o (+) some enquanto uma nota está em edição', async () => {
    seedApp({
      projects: [project('p1', 'Sagyou')],
      notes: [
        {
          id: 'n1',
          projectId: 'p1',
          content: 'Ideia',
          color: '#fef08a',
          x: 0,
          y: 0,
          width: 200,
          height: 150,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z'
        }
      ]
    })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    await fireEvent.press(screen.getByTestId('tab-Notas'))
    expect(screen.getByRole('button', { name: 'Criar' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Ideia' }))
    expect(screen.queryByRole('button', { name: 'Criar' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Criar' })).toBeTruthy()
  })

  it('somente leitura: o (+) fica desabilitado e a faixa explica', async () => {
    seedApp({ projects: [project('p1', 'Sagyou')] }, { readOnly: true })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled()
    expect(screen.getByText(DISCONNECTED_TEXT)).toBeTruthy()
  })

  it('nada do app, nem o (+), aparece antes de desbloquear', async () => {
    seedApp({ projects: [project('p1', 'Sagyou')] })
    const deps: LockDeps = {
      getEnrolledLevelAsync: async () => 3,
      authenticateAsync: () => new Promise(() => undefined),
      appState: { addEventListener: () => ({ remove: () => undefined }) },
      now: () => 0
    }
    await render(
      <SafeAreaProvider>
        <LockGate deps={deps}>
          <AppShell mode="app" />
        </LockGate>
      </SafeAreaProvider>
    )
    expect(screen.queryByRole('button', { name: 'Criar' })).toBeNull()
    expect(await screen.findByText(LOCKED_TITLE)).toBeTruthy()
  })

  it('carregando mostra o ícone do Sagyou', async () => {
    await render(
      <SafeAreaProvider>
        <AppShell mode="loading" />
      </SafeAreaProvider>
    )
    expect(screen.getByLabelText('Carregando o Sagyou')).toBeTruthy()
  })

  it('com "Remover animações" ligado, as folhas abrem sem animação', async () => {
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    seedApp({ projects: [project('p1', 'Sagyou')] })
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Criar' }))
    expect(screen.getByTestId('bottom-sheet').props.animationType).toBe('none')
  })

  it('sem pareamento só existe a tela de parear', async () => {
    await render(
      <SafeAreaProvider>
        <AppShell mode="pair" />
      </SafeAreaProvider>
    )
    expect(screen.getByText(PAIR_TITLE)).toBeTruthy()
    for (const label of TAB_LABELS) expect(screen.queryByText(label)).toBeNull()
  })

  it('sem conexão e com alterações esperando, avisa no topo', async () => {
    useApp.setState({
      readOnly: false,
      status: {
        state: 'offline',
        lastSyncAt: null,
        pendingCount: 2,
        paused: null,
        deviceName: '',
        conflictCount: 0
      }
    })
    await render(<StatusBanner />)
    expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy()
    expect(OFFLINE_TEXT).toBe('Sem conexão: as alterações ficam guardadas')
  })

  it('segue o tema do sistema', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark')
    await render(<Probe />)
    expect(screen.getByTestId('bg')).toHaveTextContent(darkTheme.bg)
  })

  it('usa o tema claro quando o sistema está claro', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light')
    await render(<Probe />)
    expect(screen.getByTestId('bg')).toHaveTextContent(lightTheme.bg)
  })
})
