import type { StoredConversation } from './conversation-types'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read-time migration only. Unknown keys deliberately survive so the first
 * config save cannot erase a field introduced by a newer or experimental build.
 */
export function normalizeLegacyAIConfig(value: unknown): RecordValue {
  if (!isRecord(value)) return {}
  const config = { ...value }
  // The native executor is retired; an old selection must not resurrect it.
  if (config.codeHarness === 'sagyou') config.codeHarness = 'codex'
  return config
}

/**
 * Keep legacy conversation records structurally intact. In particular, an
 * absent projectId remains absent because it has a documented legacy fallback.
 */
export function normalizeLegacyConversations(value: unknown): StoredConversation[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (conversation): conversation is RecordValue =>
        isRecord(conversation) &&
        typeof conversation.id === 'string' &&
        Array.isArray(conversation.messages)
    )
    .map((conversation) => ({
      ...conversation,
      messages: (conversation.messages as unknown[])
        .filter(
          (message): message is RecordValue =>
            isRecord(message) &&
            typeof message.role === 'string' &&
            typeof message.content === 'string'
        )
        .map((message) => ({ ...message }))
    })) as StoredConversation[]
}
