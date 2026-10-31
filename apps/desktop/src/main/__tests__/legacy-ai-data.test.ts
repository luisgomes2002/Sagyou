// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as legacy from '../modules/conversations/legacy-ai-data'
import { normalizeLegacyAIConfig } from '../modules/conversations/legacy-ai-data'
import { normalizeMemory } from '../modules/ai/memory'

describe('legacy AI config migration', () => {
  it('normalizes removed executor modes without discarding unknown configuration', () => {
    const fixture = {
      baseUrl: 'https://example.test/v1',
      model: 'old-model',
      codeHarness: 'sagyou',
      futureSetting: { keep: true }
    }

    expect(normalizeLegacyAIConfig(fixture)).toEqual({
      ...fixture,
      codeHarness: 'codex'
    })
    expect(fixture.codeHarness).toBe('sagyou')
  })

  it('treats a non-object config as empty', () => {
    expect(normalizeLegacyAIConfig(null)).toEqual({})
    expect(normalizeLegacyAIConfig([1])).toEqual({})
  })

  it('no longer exposes a conversation normalizer', () => {
    expect('normalizeLegacyConversations' in legacy).toBe(false)
  })

  it('keeps an old memory readable with no conversation link', () => {
    const memory = normalizeMemory(
      {
        id: 'legacy-memory',
        projectId: 'project-1',
        type: 'decisao',
        title: 'Dinheiro',
        body: 'Use Decimal.',
        tags: ['financeiro'],
        createdAt: '2025-01-01T00:00:00.000Z'
      },
      '2026-01-01T00:00:00.000Z'
    )
    expect(memory).toMatchObject({
      id: 'legacy-memory',
      projectId: 'project-1',
      body: 'Use Decimal.',
      sourceConversationId: null
    })
  })
})
