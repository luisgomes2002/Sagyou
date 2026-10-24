// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  runLegacyChatRemoval,
  stripAiConfigFile,
  stripLegacyApiConfig,
  LEGACY_API_CONFIG_KEYS,
  type LegacyChatRemovalDeps
} from '../modules/ai/legacy-chat-removal'

let dir: string

function seed(): void {
  writeFileSync(join(dir, 'ai-conversations.json'), '[{"id":"c1"}]')
  writeFileSync(join(dir, 'ai-usage-log.json'), '[]')
  writeFileSync(join(dir, 'ai-run-metrics.json'), '[]')
  writeFileSync(join(dir, 'ai-config.json'), '{"apiKey":"sk-secret"}')
  mkdirSync(join(dir, 'chat-images'))
  writeFileSync(join(dir, 'chat-images', 'a.png'), 'png')
  mkdirSync(join(dir, 'chat-files'))
  writeFileSync(join(dir, 'chat-files', 'doc.txt'), 'texto extraído')
}

function makeDeps(overrides: Partial<LegacyChatRemovalDeps> = {}): {
  deps: LegacyChatRemovalDeps
  calls: string[]
  marker: { value: string | null }
} {
  const calls: string[] = []
  const marker = { value: null as string | null }
  const deps: LegacyChatRemovalDeps = {
    userDataDir: dir,
    getMarker: () => marker.value,
    setMarker: (iso) => {
      calls.push('setMarker')
      marker.value = iso
    },
    copyDatabase: async (dest) => {
      calls.push('copyDatabase')
      writeFileSync(dest, 'sqlite-copy')
    },
    scrubMemories: () => {
      calls.push('scrubMemories')
      return 2
    },
    rebuildSearchIndex: async () => {
      calls.push('rebuildSearchIndex')
    },
    stripAiConfig: () => {
      calls.push('stripAiConfig')
      return {}
    },
    now: () => new Date('2026-10-24T12:00:00.000Z'),
    ...overrides
  }
  return { deps, calls, marker }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-legacy-chat-'))
  seed()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runLegacyChatRemoval', () => {
  it('does nothing when the marker is already present', async () => {
    const { deps, calls, marker } = makeDeps()
    marker.value = '2026-01-01T00:00:00.000Z'

    const result = await runLegacyChatRemoval(deps)

    expect(result.status).toBe('skipped')
    expect(calls).toEqual([])
    expect(existsSync(join(dir, 'ai-conversations.json'))).toBe(true)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('deletes nothing and writes no marker when the snapshot fails', async () => {
    const { deps, calls, marker } = makeDeps({
      copyDatabase: async () => {
        throw new Error('disco cheio')
      }
    })

    const result = await runLegacyChatRemoval(deps)

    expect(result.status).toBe('aborted')
    expect(result.warnings.join(' ')).toContain('disco cheio')
    expect(existsSync(join(dir, 'ai-conversations.json'))).toBe(true)
    expect(existsSync(join(dir, 'chat-images', 'a.png'))).toBe(true)
    expect(existsSync(join(dir, 'chat-files', 'doc.txt'))).toBe(true)
    expect(existsSync(join(dir, 'ai-usage-log.json'))).toBe(true)
    expect(marker.value).toBeNull()
    expect(calls).not.toContain('scrubMemories')
    expect(calls).not.toContain('stripAiConfig')
  })

  it('snapshots first, deletes the five items, and writes the marker last', async () => {
    const { deps, calls, marker } = makeDeps()

    const result = await runLegacyChatRemoval(deps)

    expect(result.status).toBe('done')
    const snapshot = result.snapshotDir as string
    expect(snapshot).toBe(join(dir, 'backups', 'pre-remocao-chat-2026-10-24T12-00-00-000Z'))
    expect(readFileSync(join(snapshot, 'ai-conversations.json'), 'utf-8')).toBe('[{"id":"c1"}]')
    expect(readFileSync(join(snapshot, 'chat-images', 'a.png'), 'utf-8')).toBe('png')
    expect(readFileSync(join(snapshot, 'chat-files', 'doc.txt'), 'utf-8')).toBe('texto extraído')
    expect(readFileSync(join(snapshot, 'kanban.db'), 'utf-8')).toBe('sqlite-copy')

    for (const gone of [
      'ai-conversations.json',
      'chat-images',
      'chat-files',
      'ai-usage-log.json',
      'ai-run-metrics.json'
    ]) {
      expect(existsSync(join(dir, gone))).toBe(false)
    }
    expect(calls).toEqual([
      'copyDatabase',
      'scrubMemories',
      'rebuildSearchIndex',
      'stripAiConfig',
      'setMarker'
    ])
    expect(marker.value).toBe('2026-10-24T12:00:00.000Z')
  })

  it('never copies ai-config.json into the snapshot', async () => {
    const { deps } = makeDeps()

    const result = await runLegacyChatRemoval(deps)

    expect(readdirSync(result.snapshotDir as string)).not.toContain('ai-config.json')
    expect(existsSync(join(dir, 'ai-config.json'))).toBe(true)
  })

  it('is a no-op on the second run', async () => {
    const { deps, calls } = makeDeps()
    await runLegacyChatRemoval(deps)
    calls.length = 0

    const second = await runLegacyChatRemoval(deps)

    expect(second.status).toBe('skipped')
    expect(calls).toEqual([])
  })

  it('resumes after an interruption in a later step', async () => {
    let fail = true
    const { deps, marker } = makeDeps({
      scrubMemories: () => {
        if (fail) throw new Error('memória indisponível')
        return 0
      }
    })

    const first = await runLegacyChatRemoval(deps)
    expect(first.status).toBe('aborted')
    expect(marker.value).toBeNull()
    expect(existsSync(join(dir, 'ai-conversations.json'))).toBe(false)

    fail = false
    const second = await runLegacyChatRemoval(deps)
    expect(second.status).toBe('done')
    expect(marker.value).not.toBeNull()
  })

  it('tolerates files that never existed and snapshots only what is there', async () => {
    rmSync(join(dir, 'chat-files'), { recursive: true })
    rmSync(join(dir, 'ai-run-metrics.json'))
    const { deps } = makeDeps()

    const result = await runLegacyChatRemoval(deps)

    expect(result.status).toBe('done')
    expect(existsSync(join(result.snapshotDir as string, 'chat-files'))).toBe(false)
  })

  it('keeps the original snapshot out of the way of a failed attempt', async () => {
    const warn = vi.fn()
    const { deps } = makeDeps({
      copyDatabase: async () => {
        throw new Error('falhou')
      },
      warn
    })

    const result = await runLegacyChatRemoval(deps)

    expect(result.status).toBe('aborted')
    // A half-written snapshot must not be left looking like a real one.
    expect(existsSync(join(dir, 'backups', 'pre-remocao-chat-2026-10-24T12-00-00-000Z'))).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})

describe('stripLegacyApiConfig', () => {
  const full = {
    baseUrl: 'https://api.test/v1',
    apiKey: 'sk-secret',
    model: 'm',
    providerProfiles: [{ id: 'p', apiKey: 'sk-profile' }],
    activeProviderProfileId: 'p',
    legacyProfileMigrated: true,
    chatProvider: 'api',
    modelComplex: 'big',
    maxSteps: 40,
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    timeoutMs: 60000,
    lastConversationId: 'c1',
    codeAgent: { baseUrl: 'x', apiKey: 'y', model: 'z' }
  }

  it('removes exactly the 14 legacy chat keys', () => {
    expect([...LEGACY_API_CONFIG_KEYS].sort()).toEqual(Object.keys(full).sort())
    const { config, changed } = stripLegacyApiConfig(full)
    expect(changed).toBe(true)
    expect(config).toEqual({})
  })

  it('keeps agent settings and unknown keys', () => {
    const { config } = stripLegacyApiConfig({
      ...full,
      codeHarness: 'claude-code',
      userName: 'Luis',
      reasoningEffort: 'high',
      sandboxEnabled: false,
      futureSetting: { keep: true }
    })
    expect(config).toEqual({
      codeHarness: 'claude-code',
      userName: 'Luis',
      reasoningEffort: 'high',
      sandboxEnabled: false,
      futureSetting: { keep: true }
    })
  })

  it('reports no change and returns an empty object for non-objects', () => {
    expect(stripLegacyApiConfig(null)).toEqual({ config: {}, changed: false })
    expect(stripLegacyApiConfig([1])).toEqual({ config: {}, changed: false })
    expect(stripLegacyApiConfig({ codeHarness: 'codex' }).changed).toBe(false)
  })
})

describe('stripAiConfigFile', () => {
  it('rewrites the file atomically without the keys', () => {
    const path = join(dir, 'ai-config.json')
    writeFileSync(path, JSON.stringify({ apiKey: 'sk', codeHarness: 'codex', extra: 1 }))

    expect(stripAiConfigFile(path)).toEqual({})

    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ codeHarness: 'codex', extra: 1 })
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('leaves an unreadable file untouched and warns', () => {
    const path = join(dir, 'ai-config.json')
    writeFileSync(path, '{ not json')

    const result = stripAiConfigFile(path)

    expect(result.warning).toMatch(/ai-config\.json/)
    expect(readFileSync(path, 'utf-8')).toBe('{ not json')
  })

  it('does nothing when the file does not exist', () => {
    expect(stripAiConfigFile(join(dir, 'missing.json'))).toEqual({})
    expect(existsSync(join(dir, 'missing.json'))).toBe(false)
  })

  it('does not rewrite a file that has none of the keys', () => {
    const path = join(dir, 'ai-config.json')
    const original = '{"codeHarness":"codex"}'
    writeFileSync(path, original)

    stripAiConfigFile(path)

    expect(readFileSync(path, 'utf-8')).toBe(original)
  })
})
