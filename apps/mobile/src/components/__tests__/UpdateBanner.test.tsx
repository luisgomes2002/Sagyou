import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { AppServices } from '../../store/app'
import { useApp } from '../../store/app'
import { PREF_UPDATE_DISMISSED, useUpdate } from '../../store/update'
import { DOWNLOAD_PREFIX } from '../../update/check'
import { installedVersion } from '../../update/installed'
import { UpdateBanner } from '../UpdateBanner'

const URL_002 = `${DOWNLOAD_PREFIX}mobile-v0.0.2/sagyou-mobile-0.0.2.apk`

function withRepo(): Map<string, string> {
  const prefs = new Map<string, string>()
  const repo = {
    readPref: (k: string) => prefs.get(k) ?? null,
    writePref: (k: string, v: string | null) => {
      if (v === null) prefs.delete(k)
      else prefs.set(k, v)
    }
  }
  useApp.setState({ services: { repo } as unknown as AppServices, readOnly: false, status: null })
  return prefs
}

async function renderBanner(): Promise<void> {
  await render(
    <SafeAreaProvider>
      <UpdateBanner />
    </SafeAreaProvider>
  )
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    useUpdate.getState().reset()
    // The banner checks on mount; these tests drive the store directly.
    useUpdate.setState({ autoCheck: jest.fn(async () => undefined) })
  })
  afterEach(() => jest.restoreAllMocks())

  it('a versão instalada é a do app.json', () => {
    expect(installedVersion()).toBe('0.0.1')
  })

  it('mostra a versão nova e Baixar abre o APK pelo navegador', async () => {
    withRepo()
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    useUpdate.setState({ available: { version: '0.0.2', url: URL_002 } })
    await renderBanner()
    expect(screen.getByText('Versão 0.0.2 disponível')).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Baixar a versão 0.0.2'))
    expect(open).toHaveBeenCalledWith(URL_002)
  })

  it('"Agora não" grava a versão e a faixa some', async () => {
    const prefs = withRepo()
    useUpdate.setState({ available: { version: '0.0.2', url: URL_002 } })
    await renderBanner()
    await fireEvent.press(screen.getByText('Agora não'))
    expect(prefs.get(PREF_UPDATE_DISMISSED)).toBe('0.0.2')
    expect(screen.queryByText('Versão 0.0.2 disponível')).toBeNull()
  })

  it('sem atualização, ou com ela dispensada, não mostra nada', async () => {
    withRepo()
    await renderBanner()
    expect(screen.queryByText(/disponível/)).toBeNull()
    useUpdate.setState({ available: { version: '0.0.2', url: URL_002 }, dismissed: '0.0.2' })
    await renderBanner()
    expect(screen.queryByText(/disponível/)).toBeNull()
  })
})
