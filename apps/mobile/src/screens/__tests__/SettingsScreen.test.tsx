import { render, screen } from '@testing-library/react-native'
import { useApp } from '../../store/app'
import { conflictsText } from '../../sync/status-text'
import { SettingsScreen } from '../SettingsScreen'

describe('SettingsScreen', () => {
  it('com um conflito aberto pede para resolver no PC', async () => {
    useApp.setState({
      readOnly: false,
      status: {
        state: 'ok',
        lastSyncAt: Date.now(),
        pendingCount: 0,
        paused: null,
        deviceName: 'Pixel',
        conflictCount: 1
      }
    })
    await render(<SettingsScreen />)
    expect(screen.getByText('1 conflito — resolva no PC')).toBeTruthy()
    expect(conflictsText(3)).toBe('3 conflitos — resolva no PC')
  })
})
