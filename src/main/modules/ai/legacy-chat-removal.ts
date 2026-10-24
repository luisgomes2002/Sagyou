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
  rebuildSearchIndex: () => Promise<void>
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

  const stamp = deps.now().toISOString().replace(/[:.]/g, '-')
  const snapshotDir = join(deps.userDataDir, 'backups', `pre-remocao-chat-${stamp}`)

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

  // From here on each step is idempotent, so a failure leaves the marker unset
  // and the next launch simply runs the remaining work again.
  try {
    for (const item of DELETED_ITEMS) {
      rmSync(join(deps.userDataDir, item), { recursive: true, force: true })
    }
    deps.scrubMemories()
    await deps.rebuildSearchIndex()
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
