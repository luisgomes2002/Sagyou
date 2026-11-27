/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  LEGACY_API_CONFIG_KEYS,
  agentOnlyConfig,
  stripLegacyApiConfig
} from '../modules/ai/ai-config'

describe('stripLegacyApiConfig', () => {
  it('removes every retired chat key and keeps anything else', () => {
    const input: Record<string, unknown> = { codeHarness: 'codex', fromANewerBuild: { x: 1 } }
    for (const key of LEGACY_API_CONFIG_KEYS) input[key] = 'segredo'
    const { config, changed } = stripLegacyApiConfig(input)
    expect(changed).toBe(true)
    expect(config).toEqual({ codeHarness: 'codex', fromANewerBuild: { x: 1 } })
    expect(
      Object.keys(config).some((key) => (LEGACY_API_CONFIG_KEYS as readonly string[]).includes(key))
    ).toBe(false)
  })

  it('reports no change when there is no retired key, and does not mutate its input', () => {
    const input = { codeHarness: 'claude-code', userName: 'Ana' }
    const { config, changed } = stripLegacyApiConfig(input)
    expect(changed).toBe(false)
    expect(config).toEqual(input)
    expect(config).not.toBe(input)
  })

  it('reads anything that is not an object as an empty config', () => {
    expect(stripLegacyApiConfig(null)).toEqual({ config: {}, changed: false })
    expect(stripLegacyApiConfig([1, 2])).toEqual({ config: {}, changed: false })
    expect(stripLegacyApiConfig('x')).toEqual({ config: {}, changed: false })
  })
})

describe('agentOnlyConfig', () => {
  it('never hands out or lets through an API key', () => {
    expect(
      agentOnlyConfig({ codeHarness: 'codex', apiKey: 'sk-x', providerProfiles: [{}] })
    ).toEqual({
      codeHarness: 'codex'
    })
  })

  it('turns the retired native harness into codex and keeps unknown keys', () => {
    expect(agentOnlyConfig({ codeHarness: 'sagyou', foo: 1 })).toEqual({
      codeHarness: 'codex',
      foo: 1
    })
  })
})
