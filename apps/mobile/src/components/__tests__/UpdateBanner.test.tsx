import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { AppServices } from '../../store/app'
import { useApp } from '../../store/app'
import { PREF_UPDATE_DISMISSED, useUpdate } from '../../store/update'
import { DOWNLOAD_PREFIX } from '../../update/check'
import { installedVersion } from '../../update/installed'
import { UpdateBanner } from '../UpdateBanner'

// Derived from app.json, so bumping the app's version never breaks these tests.
const NEXT = ((v: string): string => {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
})(installedVersion())
const URL_NEXT = `${DOWNLOAD_PREFIX}mobile-v${NEXT}/sagyou-mobile-${NEXT}.apk`

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

  it('mostra a versão nova e Baixar abre o APK pelo navegador', async () => {
    withRepo()
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    useUpdate.setState({ available: { version: NEXT, url: URL_NEXT } })
    await renderBanner()
    expect(screen.getByText(`Versão ${NEXT} disponível`)).toBeTruthy()
    await fireEvent.press(screen.getByLabelText(`Baixar a versão ${NEXT}`))
    expect(open).toHaveBeenCalledWith(URL_NEXT)
  })

  it('"Agora não" grava a versão e a faixa some', async () => {
    const prefs = withRepo()
    useUpdate.setState({ available: { version: NEXT, url: URL_NEXT } })
    await renderBanner()
    await fireEvent.press(screen.getByText('Agora não'))
    expect(prefs.get(PREF_UPDATE_DISMISSED)).toBe(NEXT)
    expect(screen.queryByText(`Versão ${NEXT} disponível`)).toBeNull()
  })

  it('sem atualização, ou com ela dispensada, não mostra nada', async () => {
    withRepo()
    await renderBanner()
    expect(screen.queryByText(/disponível/)).toBeNull()
    useUpdate.setState({ available: { version: NEXT, url: URL_NEXT }, dismissed: NEXT })
    await renderBanner()
    expect(screen.queryByText(/disponível/)).toBeNull()
  })
})
