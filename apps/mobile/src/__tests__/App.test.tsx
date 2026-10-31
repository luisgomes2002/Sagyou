import { render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import * as RN from 'react-native'
import App, { TAB_LABELS } from '../App'
import { darkTheme, lightTheme, useTheme } from '../theme'

function Probe(): React.JSX.Element {
  return <Text testID="bg">{useTheme().bg}</Text>
}

describe('App', () => {
  afterEach(() => jest.restoreAllMocks())

  it('mostra as cinco abas com os rótulos exatos', async () => {
    await render(<App />)
    expect(TAB_LABELS).toEqual(['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'])
    for (const label of TAB_LABELS) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
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
