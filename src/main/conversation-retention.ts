/** Keep a conversation while any memory cites it, including archived memories. */
export function referencedConversationIds(
  memories: { sourceConversationId: string | null }[]
): Set<string> {
  return new Set(
    memories
      .map((memory) => memory.sourceConversationId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )
}

/** A backup may replace history before it replaces memories. Preserve local evidence until then. */
export function retainReferencedConversations<T extends { id: string }>(
  incoming: T[],
  current: T[],
  referencedIds: ReadonlySet<string>
): T[] {
  const incomingIds = new Set(incoming.map((conversation) => conversation.id))
  return [
    ...incoming,
    ...current.filter(
      (conversation) => referencedIds.has(conversation.id) && !incomingIds.has(conversation.id)
    )
  ]
}

export function partitionConversations<T extends { id: string; updatedAt: string }>(
  conversations: T[],
  referencedIds: ReadonlySet<string>,
  cutoff: Date,
  maxRecent: number
): { keep: T[]; prune: T[] } {
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const keep: T[] = []
  const prune: T[] = []
  let recentKept = 0

  for (const conversation of sorted) {
    if (referencedIds.has(conversation.id)) {
      keep.push(conversation)
    } else if (new Date(conversation.updatedAt) >= cutoff && recentKept < maxRecent) {
      keep.push(conversation)
      recentKept++
    } else {
      prune.push(conversation)
    }
  }
  return { keep, prune }
}
