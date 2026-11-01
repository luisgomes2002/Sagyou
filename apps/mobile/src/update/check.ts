// Decides whether a newer Android build is published on GitHub Releases.
// Pure: the network comes in as `fetchFn`, so the rules are testable.

export const RELEASES_URL = 'https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100'
// Only a file in this repository's releases is ever offered for download: a
// tampered response must not send the user to another site or repository.
export const DOWNLOAD_PREFIX = 'https://github.com/luisgomes2002/Sagyou/releases/download/'
export const CHECK_TIMEOUT_MS = 15_000

export interface AvailableUpdate {
  version: string
  url: string
}

const VERSION_RE = /^\d+\.\d+\.\d+$/
const TAG_PREFIX = 'mobile-v'

export function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== 'string' || !VERSION_RE.test(v)) return null
  const [a, b, c] = v.split('.').map(Number)
  return [a, b, c]
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`versão inválida: ${!pa ? a : b}`)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

interface ReleaseLike {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

interface AssetLike {
  name?: unknown
  state?: unknown
  browser_download_url?: unknown
}

function downloadUrl(release: ReleaseLike, version: string): string | null {
  if (!Array.isArray(release.assets)) return null
  const name = `sagyou-mobile-${version}.apk`
  for (const raw of release.assets as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const asset = raw as AssetLike
    if (asset.name !== name || asset.state !== 'uploaded') continue
    const url = asset.browser_download_url
    if (typeof url === 'string' && url === `${DOWNLOAD_PREFIX}${TAG_PREFIX}${version}/${name}`)
      return url
  }
  return null
}

/**
 * The newest published `mobile-vX.Y.Z` above `installed`, with its APK.
 * When that newest one lacks a valid APK the answer is `null`: never fall back
 * to an older release, which would be offered as if it were the latest.
 */
export function pickUpdate(releases: unknown, installed: string): AvailableUpdate | null {
  if (!Array.isArray(releases) || !parseVersion(installed)) return null
  let best: { version: string; release: ReleaseLike } | null = null
  for (const raw of releases as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const release = raw as ReleaseLike
    if (release.draft !== false || release.prerelease !== false) continue
    if (typeof release.tag_name !== 'string' || !release.tag_name.startsWith(TAG_PREFIX)) continue
    const version = release.tag_name.slice(TAG_PREFIX.length)
    if (!parseVersion(version)) continue
    if (!best || compareVersions(version, best.version) > 0) best = { version, release }
  }
  if (!best || compareVersions(best.version, installed) <= 0) return null
  const url = downloadUrl(best.release, best.version)
  return url ? { version: best.version, url } : null
}

/** Throws on a network error, a non-200 status, invalid JSON or a timeout. */
export async function fetchLatest(
  fetchFn: typeof fetch,
  installed: string,
  timeoutMs: number = CHECK_TIMEOUT_MS
): Promise<AvailableUpdate | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('timeout'))
    }, timeoutMs)
  })
  try {
    const body = await Promise.race([
      (async () => {
        const res = await fetchFn(RELEASES_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal
        })
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as unknown
      })(),
      timeout
    ])
    return pickUpdate(body, installed)
  } finally {
    clearTimeout(timer)
  }
}
