// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  partitionConversations,
  referencedConversationIds,
  retainReferencedConversations
} from '../conversation-retention'

describe('conversation retention', () => {
  it('keeps memory sources across both the age and count limits, including archived memories', () => {
    const referenced = referencedConversationIds([
      { sourceConversationId: 'old-source' },
      { sourceConversationId: null }
    ])
    const records = [
      { id: 'old-source', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'recent-a', updatedAt: '2026-10-06T00:00:00.000Z' },
      { id: 'recent-b', updatedAt: '2026-10-05T00:00:00.000Z' }
    ]
    const result = partitionConversations(records, referenced, new Date('2026-09-20'), 1)
    expect(result.keep.map((record) => record.id)).toEqual(['recent-a', 'old-source'])
    expect(result.prune.map((record) => record.id)).toEqual(['recent-b'])
  })

  it('retains memory sources missing from an imported backup history', () => {
    const current = [{ id: 'memory-source' }, { id: 'unreferenced' }]
    const incoming = [{ id: 'backup-chat' }]
    expect(retainReferencedConversations(incoming, current, new Set(['memory-source']))).toEqual([
      { id: 'backup-chat' },
      { id: 'memory-source' }
    ])
  })
})
