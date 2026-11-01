import { render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import * as RN from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppShell, TAB_LABELS } from '../App'
import { StatusBanner } from '../components/StatusBanner'
import { PAIR_TITLE } from '../screens/PairScreen'
import { OFFLINE_TEXT, useApp, type AppServices } from '../store/app'
import { useUpdate } from '../store/update'
import { darkTheme, lightTheme, useTheme } from '../theme'

function Probe(): React.JSX.Element {
  return <Text testID="bg">{useTheme().bg}</Text>
}

describe('App', () => {
  afterEach(() => jest.restoreAllMocks())

  it('mostra as cinco abas com os rótulos exatos', async () => {
    await render(
      <SafeAreaProvider>
        <AppShell mode="app" />
      </SafeAreaProvider>
    )
    expect(TAB_LABELS).toEqual(['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'])
    for (const label of TAB_LABELS) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
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

  describe('procura de atualização', () => {
    const autoCheck = jest.fn(async () => undefined)
    beforeEach(() => {
      autoCheck.mockClear()
      useUpdate.getState().reset()
      useUpdate.setState({ autoCheck })
      const repo = { readPref: () => null, writePref: () => undefined }
      useApp.setState({ services: { repo } as unknown as AppServices, status: null })
    })
    afterEach(() => useApp.setState({ services: null, readOnly: false }))

    it('consulta uma vez ao abrir o app, também só leitura', async () => {
      for (const readOnly of [false, true]) {
        autoCheck.mockClear()
        useApp.setState({ readOnly })
        const view = await render(
          <SafeAreaProvider>
            <AppShell mode="app" />
          </SafeAreaProvider>
        )
        expect(autoCheck).toHaveBeenCalledTimes(1)
        await view.unmount()
      }
    })

    it('não consulta antes de parear nem carregando', async () => {
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
