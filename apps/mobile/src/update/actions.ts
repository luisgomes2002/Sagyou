import { Linking } from 'react-native'
import type { RecordRepo } from '../data/records'
import type { UpdateDeps } from '../store/update'
import { installedVersion } from './installed'

export const DOWNLOAD_LABEL = 'Baixar'
export const DISMISS_LABEL = 'Agora não'
export const availableText = (version: string): string => `Versão ${version} disponível`

/** The real effects of a check: global fetch, the clock and the APK's own version. */
export function updateDeps(repo: Pick<RecordRepo, 'readPref' | 'writePref'>): UpdateDeps {
  return {
    repo,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    installed: installedVersion()
  }
}

/** Opening the APK: the browser downloads it and Android asks to install it over this one. */
export function openDownload(url: string): void {
  Linking.openURL(url).catch(() => undefined)
}
