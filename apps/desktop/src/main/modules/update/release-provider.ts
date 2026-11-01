// The desktop's own electron-updater provider. GitHub's "Latest" release is
// shared with the Android app (a mobile-v* marked Latest by mistake would hide
// the desktop from GitHubProvider), so this one lists the releases and picks
// the highest published vX.Y.Z itself, then reads its latest*.yml like
// GitHubProvider does.
import type { ResolvedUpdateFileInfo, UpdateInfo } from 'electron-updater'
import {
  parseUpdateInfo,
  Provider,
  resolveFiles,
  type ProviderRuntimeOptions
} from 'electron-updater/out/providers/Provider'
import { URL } from 'url'

export const DESKTOP_RELEASES_API =
  'https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100'
const DOWNLOAD_BASE = 'https://github.com/luisgomes2002/Sagyou/releases/download/'

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/

type DesktopUpdateInfo = UpdateInfo & { tag: string }

function tagParts(tag: string): [number, number, number] | null {
  const m = TAG_RE.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The highest published (not draft, not prerelease) vX.Y.Z tag, or null. */
export function pickDesktopTag(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null
  let best: { tag: string; parts: [number, number, number] } | null = null
  for (const raw of releases as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { tag_name?: unknown; draft?: unknown; prerelease?: unknown }
    if (r.draft !== false || r.prerelease !== false || typeof r.tag_name !== 'string') continue
    const parts = tagParts(r.tag_name)
    if (!parts) continue
    if (!best || compareParts(parts, best.parts) > 0) best = { tag: r.tag_name, parts }
  }
  return best?.tag ?? null
}

function compareParts(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

const downloadPath = (tag: string, file: string): string =>
  `/luisgomes2002/Sagyou/releases/download/${tag}/${file}`

export class DesktopReleaseProvider extends Provider<DesktopUpdateInfo> {
  private readonly baseUrl = new URL(DOWNLOAD_BASE)

  // electron-updater builds a custom provider as new P(options, updater, runtimeOptions).
  constructor(_options: unknown, _updater: unknown, runtimeOptions: ProviderRuntimeOptions) {
    super(runtimeOptions)
  }

  async getLatestVersion(): Promise<DesktopUpdateInfo> {
    const body = await this.httpRequest(new URL(DESKTOP_RELEASES_API), {
      Accept: 'application/vnd.github+json'
    })
    let releases: unknown
    try {
      releases = JSON.parse(body ?? '')
    } catch {
      throw codedError('Invalid GitHub releases response', 'ERR_UPDATER_INVALID_RELEASE_FEED')
    }
    const tag = pickDesktopTag(releases)
    if (!tag)
      throw codedError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
    const channelFile = `${this.getDefaultChannelName()}.yml`
    const channelUrl = new URL(downloadPath(tag, channelFile), this.baseUrl)
    const raw = await this.httpRequest(channelUrl)
    return { ...parseUpdateInfo(raw, channelFile, channelUrl), tag }
  }

  resolveFiles(info: DesktopUpdateInfo): ResolvedUpdateFileInfo[] {
    // Same naming as GitHubProvider: GitHub turns spaces in asset names into '-'.
    return resolveFiles(info, this.baseUrl, (p) => downloadPath(info.tag, p.replace(/ /g, '-')))
  }
}
