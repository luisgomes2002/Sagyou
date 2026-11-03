import { act, fireEvent, render, screen, within } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { seedApp } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { useUpdate } from '../../store/update'
import { DOWNLOAD_PREFIX } from '../../update/check'
import { installedVersion } from '../../update/installed'
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

// Derived from app.json, so bumping the app's version never breaks these tests.
const NEXT = ((v: string): string => {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
})(installedVersion())

describe('SettingsScreen', () => {
  it('com conflito aberto mostra a linha que abre a tela de conflitos, sem "resolva no PC"', async () => {
    seedApp()
    useApp.setState({ status: { ...STATUS, conflictCount: 2 } })
    const navigate = jest.fn()
    await render(<SettingsScreen navigation={{ navigate }} />)
    expect(screen.queryByText(/resolva no PC/)).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: '2 conflitos, ver e resolver' }))
    expect(navigate).toHaveBeenCalledWith('Conflitos')
    expect(conflictsText(1)).toBe('1 conflito')
    expect(conflictsText(3)).toBe('3 conflitos')
  })

  it('sem conflito, ou desconectado, a linha de conflitos não aparece', async () => {
    seedApp()
    useApp.setState({ status: { ...STATUS, conflictCount: 0 } })
    await render(<SettingsScreen />)
    expect(screen.queryByText(/conflito/)).toBeNull()
    seedApp({}, { readOnly: true })
    useApp.setState({ status: STATUS })
    await render(<SettingsScreen />)
    expect(screen.queryByText('1 conflito')).toBeNull()
  })

  it('Controlar o PC abre a tela e some no modo só leitura', async () => {
    seedApp()
    useApp.setState({ status: STATUS })
    const navigate = jest.fn()
    await render(<SettingsScreen navigation={{ navigate }} />)
    await fireEvent.press(screen.getByText('Controlar o PC'))
    expect(navigate).toHaveBeenCalledWith('ControlarPC')
    seedApp({}, { readOnly: true })
    useApp.setState({ status: STATUS })
    await render(<SettingsScreen navigation={{ navigate }} />)
    expect(screen.queryByText('Controlar o PC')).toBeNull()
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
      'Versão do app',
      'Zona de perigo'
    ])
    const danger = screen.getByTestId('zona-de-perigo')
    expect(within(danger).getByRole('button', { name: DISCONNECT_LABEL })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Minhas finanças' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Trabalho' })).not.toBeChecked()
  })

  describe('Versão do app', () => {
    const URL_NEXT = `${DOWNLOAD_PREFIX}mobile-v${NEXT}/sagyou-mobile-${NEXT}.apk`
    let finish: (r: Response | Error) => void = () => undefined
    const realFetch = globalThis.fetch

    beforeEach(() => {
      useUpdate.getState().reset()
      seedApp()
      globalThis.fetch = jest.fn(
        () =>
          new Promise<Response>((resolve, reject) => {
            finish = (r) => (r instanceof Error ? reject(r) : resolve(r))
          })
      ) as unknown as typeof fetch
    })
    afterEach(() => {
      globalThis.fetch = realFetch
      jest.restoreAllMocks()
    })

    const body = (b: unknown): Response =>
      ({ status: 200, json: async () => b }) as unknown as Response

    it('mostra a versão instalada', async () => {
      await render(<SettingsScreen />)
      expect(screen.getByText(`Instalada: ${installedVersion()}`)).toBeTruthy()
    })

    it('procura, desabilita enquanto procura e diz que está atualizado', async () => {
      await render(<SettingsScreen />)
      await fireEvent.press(screen.getByText('Procurar atualização'))
      expect(screen.getByRole('button', { name: 'Procurando…' })).toBeDisabled()
      await act(async () => finish(body([])))
      expect(screen.getByText('Você já está na versão mais recente.')).toBeTruthy()
    })

    it('com falha avisa para tentar depois', async () => {
      await render(<SettingsScreen />)
      await fireEvent.press(screen.getByText('Procurar atualização'))
      await act(async () => finish(new Error('offline')))
      expect(
        screen.getByText('Não foi possível verificar agora. Tente de novo mais tarde.')
      ).toBeTruthy()
    })

    it('com versão nova mostra e oferece Baixar', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
      await render(<SettingsScreen />)
      await fireEvent.press(screen.getByText('Procurar atualização'))
      const release = {
        tag_name: `mobile-v${NEXT}`,
        draft: false,
        prerelease: false,
        assets: [
          { name: `sagyou-mobile-${NEXT}.apk`, state: 'uploaded', browser_download_url: URL_NEXT }
        ]
      }
      await act(async () => finish(body([release])))
      expect(screen.getByText(`Versão ${NEXT} disponível`)).toBeTruthy()
      await fireEvent.press(screen.getByLabelText(`Baixar a versão ${NEXT}`))
      expect(open).toHaveBeenCalledWith(URL_NEXT)
    })
  })
})
