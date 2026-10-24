// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeLegacyAIConfig, normalizeLegacyConversations } from '../modules/conversations/legacy-ai-data'
import { normalizeMemory } from '../modules/ai/memory'

describe('legacy AI data migration', () => {
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

  it('opens an old history without adding scope or losing message metadata on its first save', () => {
    const [conversation] = normalizeLegacyConversations([
      {
        id: 'legacy-conversation',
        title: 'Histórico antigo',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        legacyConversationFlag: 'keep',
        messages: [
          {
            role: 'assistant',
            content: 'Memória e conversa continuam disponíveis.',
            legacyToolName: 'salvar_memoria'
          }
        ]
      }
    ])

    expect(conversation.projectId).toBeUndefined()
    expect(conversation).toMatchObject({ legacyConversationFlag: 'keep' })
    expect(conversation.messages[0]).toMatchObject({ legacyToolName: 'salvar_memoria' })
  })

  it('keeps a previous-version conversation and memory readable together', () => {
    const [conversation] = normalizeLegacyConversations([
      {
        id: 'legacy-history',
        title: 'Decisão anterior',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        messages: [{ role: 'user', content: 'Use Decimal.' }]
      }
    ])
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

    expect(conversation.messages[0].content).toBe('Use Decimal.')
    expect(memory).toMatchObject({
      id: 'legacy-memory',
      projectId: 'project-1',
      body: 'Use Decimal.',
      sourceConversationId: null
    })
  })
})
