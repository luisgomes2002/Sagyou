import { render, screen, within } from '@testing-library/react-native'
import { seedApp } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { conflictsText } from '../../sync/status-text'
import { DISCONNECT_LABEL, SettingsScreen } from '../SettingsScreen'

const STATUS = {
  state: 'ok' as const,
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 1
}

describe('SettingsScreen', () => {
  it('com um conflito aberto pede para resolver no PC', async () => {
    seedApp()
    useApp.setState({ status: STATUS })
    await render(<SettingsScreen />)
    expect(screen.getByText('1 conflito — resolva no PC')).toBeTruthy()
    expect(conflictsText(3)).toBe('3 conflitos — resolva no PC')
  })

  it('as seções aparecem na ordem e desconectar fica na zona de perigo', async () => {
    seedApp({
      financialProfiles: [
        { id: 'personal', name: 'Minhas finanças' },
        { id: 'trabalho', name: 'Trabalho' }
      ] as never
    })
    useApp.setState({ status: STATUS })
    await render(<SettingsScreen />)
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual([
      'Este aparelho',
      'Sincronização',
      'Perfil financeiro',
      'Zona de perigo'
    ])
    const danger = screen.getByTestId('zona-de-perigo')
    expect(within(danger).getByRole('button', { name: DISCONNECT_LABEL })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Minhas finanças' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Trabalho' })).not.toBeChecked()
  })
})
