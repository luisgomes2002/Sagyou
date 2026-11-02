export type ReleaseApp = 'desktop' | 'mobile'
export interface PullRequest {
  number: number
  title: string
}
export const APP_PATHS: Record<ReleaseApp, string[]>
export function tagInfo(tag: string): { app: ReleaseApp; version: [number, number, number] } | null
export function previousTag(tags: string[], current: string): string | null
export function touchesApp(files: string[], app: ReleaseApp): boolean
export function pullRequestOf(subject: string, body: string): PullRequest | null
export function renderNotes(input: {
  app: ReleaseApp
  tag: string
  previous: string | null
  repo: string
  prs: PullRequest[]
}): string
export function collect(tag: string, repo: string): string
