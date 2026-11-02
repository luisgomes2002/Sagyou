import { fireEvent, render, screen } from '@testing-library/react-native'
import { exampleA11yLabel } from '@sagyou/core/sync/guide'
import { seedApp } from '../../__tests__/seed'
import { SYNC_GUIDE_LINK } from '../../components/SyncGuideContent'
import { useApp } from '../../store/app'
import { SettingsScreen } from '../SettingsScreen'
import { SyncGuideScreen } from '../SyncGuideScreen'

const STATUS = {
  state: 'ok' as const,
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 0
}

describe('Como funciona a sincronização', () => {
  it('mostra os dois artigos como cabeçalhos, os exemplos marcados e a tabela', async () => {
    await render(<SyncGuideScreen />)
    expect(screen.getByRole('header', { name: 'Como a sincronização se comporta' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'As chaves da sincronização' })).toBeTruthy()
    expect(screen.getAllByText('Exemplo')).toHaveLength(5)
    expect(screen.getByLabelText(exampleA11yLabel('Código de recuperação'))).toBeTruthy()
    expect(screen.getByLabelText(exampleA11yLabel('Códigos reserva'))).toBeTruthy()
    expect(screen.getByText('Perdeu…: Um aparelho')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('Ajustes abre a tela, com ou sem conflitos', async () => {
    for (const conflictCount of [0, 2]) {
      seedApp()
      useApp.setState({ status: { ...STATUS, conflictCount } })
      const navigate = jest.fn()
      await render(<SettingsScreen navigation={{ navigate }} />)
      await fireEvent.press(screen.getByRole('button', { name: SYNC_GUIDE_LINK }))
      expect(navigate).toHaveBeenCalledWith('ComoFunciona')
    }
  })
})
