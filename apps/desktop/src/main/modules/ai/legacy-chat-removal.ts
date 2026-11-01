import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * One-time removal of the generic chat's data. Every effect is injected so the
 * rules (order, abort-on-snapshot-failure, resumability) are testable without
 * Electron or SQLite.
 */
export interface LegacyChatRemovalDeps {
  userDataDir: string
  getMarker: () => string | null
  setMarker: (iso: string) => void
  /** Writes a consistent copy of kanban.db to `dest`. */
  copyDatabase: (dest: string) => Promise<void>
  /** Clears conversation links from memories; returns how many changed. */
  scrubMemories: () => number
  /** True when ai-config.json still carries any of the retired chat keys. */
  hasLegacyConfig: () => boolean
  /** Folder of a snapshot an earlier, interrupted run already made, if any. */
  getSnapshotDir: () => string | null
  /** Called as soon as a snapshot is complete, before anything is deleted. */
  setSnapshotDir: (dir: string) => void
  /** Strips the legacy API keys from ai-config.json. */
  stripAiConfig: () => { warning?: string }
  now: () => Date
  warn?: (message: string) => void
}

export interface LegacyChatRemovalResult {
  status: 'done' | 'skipped' | 'aborted'
  snapshotDir?: string
  warnings: string[]
}

/** Snapshotted, then deleted. ai-config.json is deliberately not in this list. */
const SNAPSHOT_ITEMS = ['ai-conversations.json', 'chat-images', 'chat-files'] as const
const DELETED_ITEMS = [
  'ai-conversations.json',
  'chat-images',
  'chat-files',
  'ai-usage-log.json',
  'ai-run-metrics.json'
] as const

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason)

export async function runLegacyChatRemoval(
  deps: LegacyChatRemovalDeps
): Promise<LegacyChatRemovalResult> {
  const warnings: string[] = []
  const warn = (message: string): void => {
    warnings.push(message)
    deps.warn?.(message)
  }

  if (deps.getMarker()) return { status: 'skipped', warnings }

  // An install that never had a chat has nothing to snapshot or announce: it
  // only needs the marker (and a harmless pass over memories).
  const hasWork =
    DELETED_ITEMS.some((item) => existsSync(join(deps.userDataDir, item))) ||
    deps.hasLegacyConfig()
  if (!hasWork) {
    try {
      deps.scrubMemories()
      deps.setMarker(deps.now().toISOString())
    } catch (reason) {
      warn(`Migração interrompida; será retomada na próxima abertura: ${errorText(reason)}`)
      return { status: 'aborted', warnings }
    }
    return { status: 'done', warnings }
  }

  // A snapshot from an interrupted run already holds the conversations; a
  // second one, taken after they were deleted, would hold none and the notice
  // would point at the wrong folder.
  const recorded = deps.getSnapshotDir()
  let snapshotDir: string
  if (recorded && existsSync(recorded)) {
    snapshotDir = recorded
  } else {
    const stamp = deps.now().toISOString().replace(/[:.]/g, '-')
    snapshotDir = join(deps.userDataDir, 'backups', `pre-remocao-chat-${stamp}`)

    // Nothing is deleted until every copy succeeded; a half-written snapshot is
    // removed so it cannot pass for a real one.
    try {
      mkdirSync(snapshotDir, { recursive: true })
      for (const item of SNAPSHOT_ITEMS) {
        const source = join(deps.userDataDir, item)
        if (existsSync(source)) cpSync(source, join(snapshotDir, item), { recursive: true })
      }
      await deps.copyDatabase(join(snapshotDir, 'kanban.db'))
    } catch (reason) {
      rmSync(snapshotDir, { recursive: true, force: true })
      warn(`Snapshot falhou; nada foi apagado: ${errorText(reason)}`)
      return { status: 'aborted', warnings }
    }
    // Recorded before the first deletion: a process killed from here on still
    // leaves the notice pointing at the folder that has the conversations.
    deps.setSnapshotDir(snapshotDir)
  }

  // From here on each step is idempotent, so a failure leaves the marker unset
  // and the next launch simply runs the remaining work again.
  try {
    for (const item of DELETED_ITEMS) {
      rmSync(join(deps.userDataDir, item), { recursive: true, force: true })
    }
    deps.scrubMemories()
    // The API keys go last: they are the one thing no snapshot can restore.
    const config = deps.stripAiConfig()
    if (config.warning) warn(config.warning)
    deps.setMarker(deps.now().toISOString())
  } catch (reason) {
    warn(`Migração interrompida; será retomada na próxima abertura: ${errorText(reason)}`)
    return { status: 'aborted', snapshotDir, warnings }
  }

  return { status: 'done', snapshotDir, warnings }
}

/**
 * The keys that only the retired API chat used. Everything else in
 * ai-config.json (agent settings and any key a newer build added) survives.
 */
export const LEGACY_API_CONFIG_KEYS = [
  'baseUrl',
  'apiKey',
  'model',
  'providerProfiles',
  'activeProviderProfileId',
  'legacyProfileMigrated',
  'chatProvider',
  'modelComplex',
  'maxSteps',
  'inputPricePer1M',
  'outputPricePer1M',
  'timeoutMs',
  'lastConversationId',
  'codeAgent'
] as const

export function stripLegacyApiConfig(value: unknown): {
  config: Record<string, unknown>
  changed: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { config: {}, changed: false }
  }
  const config = { ...(value as Record<string, unknown>) }
  let changed = false
  for (const key of LEGACY_API_CONFIG_KEYS) {
    if (key in config) {
      delete config[key]
      changed = true
    }
  }
  return { config, changed }
}

/**
 * An unreadable file is left exactly as it is: it may still be recoverable, and
 * rewriting it from defaults would destroy what is in it.
 */
export function stripAiConfigFile(path: string): { warning?: string } {
  if (!existsSync(path)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (reason) {
    return {
      warning: `ai-config.json está ilegível e não foi alterado: ${errorText(reason)}`
    }
  }
  const { config, changed } = stripLegacyApiConfig(parsed)
  if (!changed) return {}
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmp, path)
  return {}
}

/** True when ai-config.json is readable and still has a retired chat key. */
export function hasLegacyApiConfig(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    return stripLegacyApiConfig(JSON.parse(readFileSync(path, 'utf-8'))).changed
  } catch {
    return false
  }
}
