// Release notes for ONE app. The desktop (vX.Y.Z) and the Android app
// (mobile-vX.Y.Z) share this repository, so GitHub's generated notes listed
// every pull request between two tags, the other app's included. This lists
// only the pull requests that changed the app being released (or the shared
// core), between its previous tag and this one, read from the merge commits.
//
//   node apps/desktop/scripts/release-notes.mjs <tag> <owner/repo> > notes.md
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** What belongs to each app: its folder and the shared core both apps bundle. */
export const APP_PATHS = {
  desktop: ['apps/desktop/', 'packages/core/'],
  mobile: ['apps/mobile/', 'packages/core/']
}

const APP_LABEL = { desktop: 'desktop', mobile: 'Android' }

/** `v1.2.3` is the desktop, `mobile-v1.2.3` the Android app; anything else is null. */
export function tagInfo(tag) {
  const match = /^(mobile-)?v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  if (!match) return null
  return {
    app: match[1] ? 'mobile' : 'desktop',
    version: [Number(match[2]), Number(match[3]), Number(match[4])]
  }
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * The same app's highest tag below this one. Tags above it (old experiments)
 * are ignored, as the updater ignores tags without a published release.
 */
export function previousTag(tags, current) {
  const info = tagInfo(current)
  if (!info) throw new Error(`Tag fora do padrão: ${current}`)
  let best = null
  for (const tag of tags) {
    const other = tagInfo(tag)
    if (!other || other.app !== info.app || compare(other.version, info.version) >= 0) continue
    if (!best || compare(other.version, best.version) > 0) best = { tag, version: other.version }
  }
  return best?.tag ?? null
}

export function touchesApp(files, app) {
  return files.some((file) => APP_PATHS[app].some((prefix) => file.startsWith(prefix)))
}

/**
 * Pull requests out of first-parent commits: a merge commit ("Merge pull
 * request #N", its body's first line is the title) or a squash ("title (#N)").
 */
export function pullRequestOf(subject, body) {
  const merge = /^Merge pull request #(\d+)\b/.exec(subject)
  if (merge) {
    const title =
      body
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? subject
    return { number: Number(merge[1]), title }
  }
  const squash = /^(.*) \(#(\d+)\)$/.exec(subject)
  return squash ? { number: Number(squash[2]), title: squash[1] } : null
}

export function renderNotes({ app, tag, previous, repo, prs }) {
  const lines = [
    '## O que mudou',
    '',
    `> ✍️ **Antes de publicar:** troque esta linha por um resumo, em linguagem de quem usa, do que muda nesta versão do app ${APP_LABEL[app]}. A lista abaixo traz só os pull requests que mexeram neste app.`,
    '',
    '## Pull requests',
    ''
  ]
  if (prs.length === 0)
    lines.push(`Nenhum pull request mexeu no app ${APP_LABEL[app]} desde a versão anterior.`)
  for (const pr of prs) lines.push(`- ${pr.title} (#${pr.number})`)
  if (app === 'mobile') {
    lines.push('', 'Publique sem marcar como Latest: o Latest é do desktop.')
  }
  lines.push(
    '',
    previous
      ? `**Comparação completa:** https://github.com/${repo}/compare/${previous}...${tag}`
      : '**Primeira versão deste app.**'
  )
  return lines.join('\n') + '\n'
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

export function collect(tag, repo) {
  const info = tagInfo(tag)
  if (!info) throw new Error(`Tag fora do padrão: ${tag}`)
  const previous = previousTag(git(['tag', '--list']).split('\n').filter(Boolean), tag)
  const range = previous ? `${previous}..${tag}` : tag
  const log = git(['log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', range])
  const prs = []
  for (const entry of log.split('\x1e')) {
    const [hash, subject = '', body = ''] = entry.trim().split('\x1f')
    if (!hash) continue
    const pr = pullRequestOf(subject, body)
    if (!pr) continue
    const files = git(['diff', '--name-only', `${hash}^1`, hash])
      .split('\n')
      .filter(Boolean)
    if (touchesApp(files, info.app)) prs.push(pr)
  }
  // git log is newest first; the notes read oldest first, like GitHub's.
  return renderNotes({ app: info.app, tag, previous, repo, prs: prs.reverse() })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, repo] = process.argv.slice(2)
  if (!tag || !repo) {
    console.error('Uso: node release-notes.mjs <tag> <owner/repo>')
    process.exit(1)
  }
  process.stdout.write(collect(tag, repo))
}
