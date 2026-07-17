// Filtering the chat history. No Electron or fs here, so the rules are testable
// on their own; index.ts reads the file and calls in.

export interface SearchableMessage {
  role: 'user' | 'assistant' | 'status'
  content: string
}

export interface SearchableConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: SearchableMessage[]
}

export interface ConversationHit {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /**
   * The bit of the conversation that matched, when the hit came from the body
   * rather than the title. Shown under the title so the user can see *why* a
   * result is there instead of having to open it.
   */
  snippet?: string
}

/** Characters either side of the hit in a snippet. */
const SNIPPET_PAD = 40

/**
 * Casefold and strip accents.
 *
 * The app is Portuguese: without this, searching "habito" misses "hábito" and
 * "reuniao" misses "reunião" — which is most of the time, since nobody reaches
 * for the accent keys mid-search.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** A one-line excerpt around the first hit, elided at both ends as needed. */
function snippetAround(content: string, needle: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const at = normalize(flat).indexOf(needle)
  if (at === -1) return flat.slice(0, SNIPPET_PAD * 2)
  const from = Math.max(0, at - SNIPPET_PAD)
  const to = Math.min(flat.length, at + needle.length + SNIPPET_PAD)
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`
}

/**
 * Conversations matching `term`, newest first.
 *
 * Matches the title or anything said in the chat. Status lines are skipped:
 * they're the agent's own trace ("Lendo src/App.tsx"), so searching "App.tsx"
 * would surface every conversation that happened to read that file rather than
 * the ones that discussed it.
 *
 * An empty term is not a filter — it returns the whole history, which is what
 * the dropdown shows before anything is typed.
 */
export function searchConversations(
  list: SearchableConversation[],
  term: string
): ConversationHit[] {
  const needle = normalize(term.trim())
  const byNewest = (a: ConversationHit, b: ConversationHit): number =>
    b.updatedAt.localeCompare(a.updatedAt)

  const meta = (c: SearchableConversation): ConversationHit => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  })

  if (!needle) return list.map(meta).sort(byNewest)

  const hits: ConversationHit[] = []
  for (const c of list) {
    if (normalize(c.title).includes(needle)) {
      hits.push(meta(c))
      continue
    }
    const hit = (c.messages ?? []).find(
      (m) => m.role !== 'status' && normalize(m.content).includes(needle)
    )
    if (hit) hits.push({ ...meta(c), snippet: snippetAround(hit.content, needle) })
  }
  return hits.sort(byNewest)
}
