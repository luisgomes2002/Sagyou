// @vitest-environment node
//
// GitHub's "Latest" is shared with the Android app: the desktop must pick the
// highest published vX.Y.Z on its own, or a mobile-v* release marked Latest
// would leave every installed PC unable to find its next version.
import type { RequestOptions } from 'http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DESKTOP_RELEASES_API,
  DesktopReleaseProvider,
  pickDesktopTag
} from '../modules/update/release-provider'

const rel = (tag: string, over: { draft?: boolean; prerelease?: boolean } = {}): object => ({
  tag_name: tag,
  draft: over.draft ?? false,
  prerelease: over.prerelease ?? false
})

const RELEASES = [
  rel('v1.0.0'),
  rel('v1.0.1'),
  rel('v1.0.10'),
  rel('mobile-v9.9.9'),
  rel('v2.0.0', { draft: true }),
  rel('v1.1.0', { prerelease: true }),
  rel('v1.2')
]

const YML = `version: 1.0.10
files:
  - url: sagyou 1.0.10 setup.exe
    sha512: abc
    size: 1
path: sagyou 1.0.10 setup.exe
sha512: abc
releaseDate: '2026-11-01T00:00:00.000Z'
`

const DOWNLOAD = 'https://github.com/luisgomes2002/Sagyou/releases/download/'

function makeProvider(
  platform: 'win32' | 'darwin' | 'linux',
  responses: Record<string, string | Error>
): { provider: DesktopReleaseProvider; requests: { url: string; headers: unknown }[] } {
  const requests: { url: string; headers: unknown }[] = []
  const executor = {
    request: async (opts: RequestOptions): Promise<string | null> => {
      const url = `${opts.protocol}//${opts.hostname}${opts.path}`
      requests.push({ url, headers: opts.headers })
      const answer = responses[url]
      if (answer === undefined) throw new Error(`404 ${url}`)
      if (answer instanceof Error) throw answer
      return answer
    }
  }
  const provider = new DesktopReleaseProvider({}, null, {
    platform,
    isUseMultipleRangeRequest: false,
    executor: executor as never
  })
  return { provider, requests }
}

describe('pickDesktopTag', () => {
  it('escolhe o maior vX.Y.Z publicado, ignorando o celular, rascunho, prerelease e tag torta', () => {
    expect(pickDesktopTag(RELEASES)).toBe('v1.0.10')
  })

  it('lista vazia ou resposta estranha dá null', () => {
    expect(pickDesktopTag([])).toBeNull()
    expect(pickDesktopTag({ message: 'Not Found' })).toBeNull()
    expect(pickDesktopTag(null)).toBeNull()
  })
})

describe('DesktopReleaseProvider', () => {
  // The Linux channel name depends on the CPU; pin it like electron-updater's own tests.
  const arch = process.env.TEST_UPDATER_ARCH
  beforeAll(() => {
    process.env.TEST_UPDATER_ARCH = 'x64'
  })
  afterAll(() => {
    if (arch === undefined) delete process.env.TEST_UPDATER_ARCH
    else process.env.TEST_UPDATER_ARCH = arch
  })

  it('lê a lista pela API e depois o latest.yml do maior vX.Y.Z', async () => {
    const { provider, requests } = makeProvider('win32', {
      [DESKTOP_RELEASES_API]: JSON.stringify(RELEASES),
      [`${DOWNLOAD}v1.0.10/latest.yml`]: YML
    })
    const info = await provider.getLatestVersion()
    expect(info.version).toBe('1.0.10')
    expect(info.tag).toBe('v1.0.10')
    expect(requests.map((r) => r.url)).toEqual([
      DESKTOP_RELEASES_API,
      `${DOWNLOAD}v1.0.10/latest.yml`
    ])
    expect(requests[0].headers).toEqual({ Accept: 'application/vnd.github+json' })
  })

  it.each([
    ['darwin', 'latest-mac.yml'],
    ['linux', 'latest-linux.yml']
  ] as const)('em %s lê o %s', async (platform, file) => {
    const { provider, requests } = makeProvider(platform, {
      [DESKTOP_RELEASES_API]: JSON.stringify(RELEASES),
      [`${DOWNLOAD}v1.0.10/${file}`]: YML
    })
    await provider.getLatestVersion()
    expect(requests[1].url).toBe(`${DOWNLOAD}v1.0.10/${file}`)
  })

  it('sem vX.Y.Z publicado rejeita com o código do electron-updater', async () => {
    const { provider } = makeProvider('win32', {
      [DESKTOP_RELEASES_API]: JSON.stringify([rel('mobile-v0.0.1')])
    })
    await expect(provider.getLatestVersion()).rejects.toMatchObject({
      code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'
    })
  })

  it('API que falha rejeita', async () => {
    const { provider } = makeProvider('win32', {
      [DESKTOP_RELEASES_API]: new Error('403 rate limit')
    })
    await expect(provider.getLatestVersion()).rejects.toThrow()
  })

  it('baixa o instalador do release escolhido, com espaço virando hífen', async () => {
    const { provider } = makeProvider('win32', {
      [DESKTOP_RELEASES_API]: JSON.stringify(RELEASES),
      [`${DOWNLOAD}v1.0.10/latest.yml`]: YML
    })
    const files = provider.resolveFiles(await provider.getLatestVersion())
    expect(files.map((f) => f.url.href)).toEqual([`${DOWNLOAD}v1.0.10/sagyou-1.0.10-setup.exe`])
  })
})
