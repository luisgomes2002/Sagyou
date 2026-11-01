import {
  CHECK_TIMEOUT_MS,
  DOWNLOAD_PREFIX,
  RELEASES_URL,
  compareVersions,
  fetchLatest,
  parseVersion,
  pickUpdate
} from '../check'

const apkUrl = (v: string): string => `${DOWNLOAD_PREFIX}mobile-v${v}/sagyou-mobile-${v}.apk`

// Same shape as https://api.github.com/repos/.../releases.
function release(
  tag: string,
  over: { draft?: boolean; prerelease?: boolean; assets?: unknown[] } = {}
): Record<string, unknown> {
  const v = tag.replace(/^mobile-v/, '')
  return {
    tag_name: tag,
    draft: over.draft ?? false,
    prerelease: over.prerelease ?? false,
    assets: over.assets ?? [
      {
        name: `sagyou-mobile-${v}.apk`,
        state: 'uploaded',
        url: `https://api.github.com/repos/luisgomes2002/Sagyou/releases/assets/1`,
        browser_download_url: apkUrl(v)
      }
    ]
  }
}

describe('versões', () => {
  it('só aceita X.Y.Z numérico', () => {
    expect(parseVersion('0.0.10')).toEqual([0, 0, 10])
    expect(parseVersion('0.2')).toBeNull()
    expect(parseVersion('0.0.2-beta')).toBeNull()
    expect(parseVersion('v0.0.2')).toBeNull()
  })

  it('compara por número, não por texto', () => {
    expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.0.99')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
})

describe('pickUpdate', () => {
  it('oferece a versão publicada mais nova com o APK do repositório', () => {
    expect(pickUpdate([release('mobile-v0.0.2')], '0.0.1')).toEqual({
      version: '0.0.2',
      url: apkUrl('0.0.2')
    })
  })

  it('escolhe a maior versão', () => {
    const list = [release('mobile-v0.0.2'), release('mobile-v0.1.0'), release('mobile-v0.0.10')]
    expect(pickUpdate(list, '0.0.1')?.version).toBe('0.1.0')
    expect(pickUpdate([release('mobile-v0.0.9'), release('mobile-v0.0.10')], '0.0.1')?.version).toBe(
      '0.0.10'
    )
  })

  it('ignora rascunho, prerelease, tag do desktop e tags tortas', () => {
    const list = [
      release('mobile-v0.0.5', { draft: true }),
      release('mobile-v0.0.6', { prerelease: true }),
      release('v1.0.1'),
      release('mobile-v0.2'),
      release('mobile-v0.0.2-beta')
    ]
    expect(pickUpdate(list, '0.0.1')).toBeNull()
  })

  it('ignora versão igual ou menor que a instalada', () => {
    expect(pickUpdate([release('mobile-v0.0.1'), release('mobile-v0.0.0')], '0.0.1')).toBeNull()
  })

  it('não conta anexo ainda subindo nem só a URL da API', () => {
    const starter = release('mobile-v0.0.2', {
      assets: [{ name: 'sagyou-mobile-0.0.2.apk', state: 'starter', browser_download_url: apkUrl('0.0.2') }]
    })
    const apiOnly = release('mobile-v0.0.2', {
      assets: [
        {
          name: 'sagyou-mobile-0.0.2.apk',
          state: 'uploaded',
          url: 'https://api.github.com/repos/luisgomes2002/Sagyou/releases/assets/1'
        }
      ]
    })
    expect(pickUpdate([starter], '0.0.1')).toBeNull()
    expect(pickUpdate([apiOnly], '0.0.1')).toBeNull()
  })

  it('a maior sem o anexo certo ou com URL de fora dá null, sem cair para uma menor', () => {
    const asset = (url: string, name = 'sagyou-mobile-0.0.3.apk'): Record<string, unknown> =>
      release('mobile-v0.0.3', { assets: [{ name, state: 'uploaded', browser_download_url: url }] })
    for (const bad of [
      asset('https://evil.example/mobile-v0.0.3/sagyou-mobile-0.0.3.apk'),
      asset('http://github.com/luisgomes2002/Sagyou/releases/download/mobile-v0.0.3/sagyou-mobile-0.0.3.apk'),
      asset('https://github.com/outro/Sagyou/releases/download/mobile-v0.0.3/sagyou-mobile-0.0.3.apk'),
      asset(apkUrl('0.0.3'), 'outro.apk'),
      release('mobile-v0.0.3', { assets: [] })
    ])
      expect(pickUpdate([release('mobile-v0.0.2'), bad], '0.0.1')).toBeNull()
  })

  it('resposta estranha dá null sem lançar', () => {
    expect(pickUpdate({ message: 'Not Found' }, '0.0.1')).toBeNull()
    expect(pickUpdate(null, '0.0.1')).toBeNull()
    expect(pickUpdate([null, 1, 'x', {}, { tag_name: 'mobile-v0.0.2' }], '0.0.1')).toBeNull()
  })
})

describe('fetchLatest', () => {
  const ok = (body: unknown): Response =>
    ({ status: 200, json: async () => body }) as unknown as Response

  it('pede a lista de releases só com o Accept', async () => {
    const fetchFn = jest.fn(async () => ok([release('mobile-v0.0.2')]))
    await expect(fetchLatest(fetchFn as unknown as typeof fetch, '0.0.1')).resolves.toEqual({
      version: '0.0.2',
      url: apkUrl('0.0.2')
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(RELEASES_URL)
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' })
    expect(init.signal).toBeDefined()
  })

  it('lança em status diferente de 200', async () => {
    const fetchFn = jest.fn(async () => ({ status: 403, json: async () => ({}) }) as unknown as Response)
    await expect(fetchLatest(fetchFn as unknown as typeof fetch, '0.0.1')).rejects.toThrow()
  })

  it('lança em JSON inválido', async () => {
    const fetchFn = jest.fn(
      async () =>
        ({
          status: 200,
          json: async () => {
            throw new SyntaxError('bad json')
          }
        }) as unknown as Response
    )
    await expect(fetchLatest(fetchFn as unknown as typeof fetch, '0.0.1')).rejects.toThrow()
  })

  it('lança quando a rede não responde dentro do prazo', async () => {
    jest.useFakeTimers()
    try {
      const fetchFn = jest.fn(() => new Promise<Response>(() => undefined))
      const p = fetchLatest(fetchFn as unknown as typeof fetch, '0.0.1')
      const assertion = expect(p).rejects.toThrow('timeout')
      jest.advanceTimersByTime(CHECK_TIMEOUT_MS)
      await assertion
    } finally {
      jest.useRealTimers()
    }
  })
})
