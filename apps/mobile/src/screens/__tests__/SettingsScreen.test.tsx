import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { useApp, type AppServices } from '../../store/app'
import { useUpdate } from '../../store/update'
import { DOWNLOAD_PREFIX } from '../../update/check'
import { installedVersion } from '../../update/installed'
import { conflictsText } from '../../sync/status-text'
import { SettingsScreen } from '../SettingsScreen'

// Derived from app.json, so bumping the app's version never breaks these tests.
const NEXT = ((v: string): string => {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
})(installedVersion())

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

  describe('Versão do app', () => {
    const URL_NEXT = `${DOWNLOAD_PREFIX}mobile-v${NEXT}/sagyou-mobile-${NEXT}.apk`
    let finish: (r: Response | Error) => void = () => undefined

    beforeEach(() => {
      useUpdate.getState().reset()
      const repo = { readPref: () => null, writePref: () => undefined }
      useApp.setState({ services: { repo } as unknown as AppServices, status: null })
      globalThis.fetch = jest.fn(
        () =>
          new Promise<Response>((resolve, reject) => {
            finish = (r) => (r instanceof Error ? reject(r) : resolve(r))
          })
      ) as unknown as typeof fetch
    })
    const realFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = realFetch
      jest.restoreAllMocks()
      useApp.setState({ services: null })
    })

    const body = (b: unknown): Response =>
      ({ status: 200, json: async () => b }) as unknown as Response

    it('mostra a versão instalada', async () => {
      await render(<SettingsScreen />)
      expect(screen.getByText('Versão do app')).toBeTruthy()
      expect(screen.getByText(`Instalada: ${installedVersion()}`)).toBeTruthy()
    })

    it('procura, desabilita enquanto procura e diz que está atualizado', async () => {
      await render(<SettingsScreen />)
      await fireEvent.press(screen.getByText('Procurar atualização'))
      expect(screen.getByText('Procurando…')).toBeTruthy()
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
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
      await render(<SettingsScreen />)
      await fireEvent.press(screen.getByText('Procurar atualização'))
      await act(async () =>
        finish(
          body([
            {
              tag_name: `mobile-v${NEXT}`,
              draft: false,
              prerelease: false,
              assets: [
                { name: `sagyou-mobile-${NEXT}.apk`, state: 'uploaded', browser_download_url: URL_NEXT }
              ]
            }
          ])
        )
      )
      expect(screen.getByText(`Versão ${NEXT} disponível`)).toBeTruthy()
      await fireEvent.press(screen.getByLabelText(`Baixar a versão ${NEXT}`))
      expect(open).toHaveBeenCalledWith(URL_NEXT)
    })
  })
})
