import { DOWNLOAD_PREFIX } from '../../update/check'
import { useApp } from '../app'
import {
  AUTO_CHECK_INTERVAL_MS,
  PREF_UPDATE_DISMISSED,
  PREF_UPDATE_LAST_CHECK,
  bannerUpdate,
  useUpdate,
  type UpdateDeps
} from '../update'

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function releases(...versions: string[]): unknown[] {
  return versions.map((v) => ({
    tag_name: `mobile-v${v}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `sagyou-mobile-${v}.apk`,
        state: 'uploaded',
        browser_download_url: `${DOWNLOAD_PREFIX}mobile-v${v}/sagyou-mobile-${v}.apk`
      }
    ]
  }))
}

function setup(body: unknown[] = [], prefs: Record<string, string> = {}) {
  const store = new Map(Object.entries(prefs))
  const repo = {
    readPref: jest.fn((k: string) => store.get(k) ?? null),
    writePref: jest.fn((k: string, v: string | null) => {
      if (v === null) store.delete(k)
      else store.set(k, v)
    })
  }
  const fetch = jest.fn(async () => ({ status: 200, json: async () => body }) as unknown as Response)
  const now = jest.fn(() => NOW)
  const deps: UpdateDeps = { repo, fetch: fetch as unknown as typeof globalThis.fetch, now, installed: '0.0.1' }
  return { deps, store, fetch, now }
}

beforeEach(() => useUpdate.getState().reset())

describe('consulta automática', () => {
  it('lê o "Agora não" mesmo quando não consulta', async () => {
    const { deps, fetch } = setup([], {
      [PREF_UPDATE_DISMISSED]: '0.0.2',
      [PREF_UPDATE_LAST_CHECK]: new Date(NOW - HOUR).toISOString()
    })
    await useUpdate.getState().autoCheck(deps)
    expect(fetch).not.toHaveBeenCalled()
    expect(useUpdate.getState().dismissed).toBe('0.0.2')
  })

  it('sem consulta anterior e nada novo: consulta e grava a hora', async () => {
    const { deps, store, fetch } = setup(releases('0.0.1'))
    await useUpdate.getState().autoCheck(deps)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.get(PREF_UPDATE_LAST_CHECK)).toBe(new Date(NOW).toISOString())
    expect(useUpdate.getState().available).toBeNull()
  })

  it('com versão nova não grava a hora e consulta de novo na próxima abertura', async () => {
    const { deps, store, fetch, now } = setup(releases('0.0.2'))
    await useUpdate.getState().autoCheck(deps)
    expect(useUpdate.getState().available?.version).toBe('0.0.2')
    expect(store.has(PREF_UPDATE_LAST_CHECK)).toBe(false)
    now.mockReturnValue(NOW + 60_000)
    await useUpdate.getState().autoCheck(deps)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('consulta no máximo uma vez a cada 24 h', async () => {
    const recent = setup([], { [PREF_UPDATE_LAST_CHECK]: new Date(NOW - 23 * HOUR).toISOString() })
    await useUpdate.getState().autoCheck(recent.deps)
    expect(recent.fetch).not.toHaveBeenCalled()
    const old = setup([], { [PREF_UPDATE_LAST_CHECK]: new Date(NOW - AUTO_CHECK_INTERVAL_MS).toISOString() })
    await useUpdate.getState().autoCheck(old.deps)
    expect(old.fetch).toHaveBeenCalledTimes(1)
  })

  it('falha de rede não conta como consulta e não lança', async () => {
    const { deps, store, fetch } = setup()
    fetch.mockRejectedValue(new Error('offline'))
    await expect(useUpdate.getState().autoCheck(deps)).resolves.toBeUndefined()
    expect(store.has(PREF_UPDATE_LAST_CHECK)).toBe(false)
    expect(useUpdate.getState().available).toBeNull()
  })

  it('duas consultas ao mesmo tempo fazem um pedido só', async () => {
    const { deps, fetch } = setup(releases('0.0.2'))
    await Promise.all([useUpdate.getState().autoCheck(deps), useUpdate.getState().autoCheck(deps)])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('faixa e "Agora não"', () => {
  it('"Agora não" grava a versão e some só para ela', async () => {
    const { deps, store } = setup(releases('0.0.2'))
    await useUpdate.getState().autoCheck(deps)
    useUpdate.getState().dismiss(deps)
    expect(store.get(PREF_UPDATE_DISMISSED)).toBe('0.0.2')
    expect(bannerUpdate(useUpdate.getState(), '0.0.1')).toBeNull()
    const url = `${DOWNLOAD_PREFIX}mobile-v0.0.3/sagyou-mobile-0.0.3.apk`
    expect(bannerUpdate({ available: { version: '0.0.3', url }, dismissed: '0.0.2' }, '0.0.1')).toEqual({
      version: '0.0.3',
      url
    })
  })

  it('não mostra versão igual ou menor que a instalada', () => {
    expect(bannerUpdate({ available: { version: '0.0.1', url: 'x' }, dismissed: null }, '0.0.1')).toBeNull()
    expect(bannerUpdate({ available: { version: '0.0.1', url: 'x' }, dismissed: null }, '0.1.0')).toBeNull()
  })

  it('apagar os dados do aparelho zera a atualização', async () => {
    const { deps } = setup(releases('0.0.2'), { [PREF_UPDATE_DISMISSED]: '0.0.1' })
    await useUpdate.getState().autoCheck(deps)
    await useUpdate.getState().manualCheck(deps)
    useApp.getState().wiped()
    expect(useUpdate.getState()).toMatchObject({ available: null, dismissed: null, manual: 'idle' })
  })
})

describe('consulta manual', () => {
  it('ignora o portão de 24 h e o "Agora não" e termina em "available"', async () => {
    const { deps, store, fetch } = setup(releases('0.0.2'), {
      [PREF_UPDATE_LAST_CHECK]: new Date(NOW - HOUR).toISOString(),
      [PREF_UPDATE_DISMISSED]: '0.0.2'
    })
    const p = useUpdate.getState().manualCheck(deps)
    expect(useUpdate.getState().manual).toBe('checking')
    await p
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useUpdate.getState().manual).toBe('available')
    expect(useUpdate.getState().available?.version).toBe('0.0.2')
    expect(store.get(PREF_UPDATE_LAST_CHECK)).toBe(new Date(NOW - HOUR).toISOString())
  })

  it('termina em "latest" sem versão nova', async () => {
    const { deps } = setup(releases('0.0.1'))
    await useUpdate.getState().manualCheck(deps)
    expect(useUpdate.getState().manual).toBe('latest')
  })

  it('termina em "error" quando a consulta falha', async () => {
    const { deps, fetch } = setup()
    fetch.mockRejectedValue(new Error('offline'))
    await useUpdate.getState().manualCheck(deps)
    expect(useUpdate.getState().manual).toBe('error')
  })
})
