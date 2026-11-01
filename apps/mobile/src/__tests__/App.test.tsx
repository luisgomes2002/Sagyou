import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import * as RN from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppShell, TAB_LABELS } from '../App'
import { StatusBanner } from '../components/StatusBanner'
import { LockGate, type LockDeps } from '../lock/LockGate'
import { LOCKED_TITLE } from '../lock/texts'
import { PAIR_TITLE } from '../screens/PairScreen'
import { DISCONNECTED_TEXT, OFFLINE_TEXT, useApp } from '../store/app'
import { project, seedApp } from './seed'
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

  it('o (+) aparece nas abas de conteúdo e some na Busca', async () => {
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
    await fireEvent.press(screen.getByTestId('tab-Busca'))
    expect(screen.queryByRole('button', { name: 'Criar' })).toBeNull()
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
