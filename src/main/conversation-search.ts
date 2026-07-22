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

/**
 * Words we don't search a task on: too common to signal a shared subject, or so
 * generic to a code-agent run that they'd match every chat that ever mentioned
 * "código"/"arquivo". A length floor drops the rest of the short function words.
 */
const TASK_STOPWORDS = new Set([
  'para', 'como', 'mais', 'esse', 'essa', 'isso', 'esta', 'este', 'pelo', 'pela',
  'sobre', 'entre', 'quando', 'porque', 'tambem', 'entao', 'todos', 'todas',
  'cada', 'seja', 'pode', 'deve', 'fazer', 'feito', 'onde', 'quer', 'entao',
  'agente', 'codigo', 'arquivo', 'arquivos', 'task', 'tarefa', 'projeto'
])

/** Distinct search keywords pulled from a free-text task, in first-seen order. */
function keywordsOf(task: string, cap = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const word of normalize(task).split(/[^a-z0-9]+/)) {
    if (word.length < 4 || TASK_STOPWORDS.has(word) || seen.has(word)) continue
    seen.add(word)
    out.push(word)
    if (out.length >= cap) break
  }
  return out
}

export interface ConversationBriefOptions {
  /** A conversation to leave out — normally the chat that fired the agent, so
   *  the run isn't briefed with the very conversation that spawned it. */
  excludeId?: string | null
  /** How many past conversations to surface. */
  maxConversations?: number
}

/**
 * A prompt block of past conversations that read like they're about the same
 * thing as `task`, so a code-agent run can reuse decisions/gotchas already
 * discussed instead of rediscovering them. Empty string when nothing matches
 * (or the task has no searchable keyword) — the caller just omits the section.
 *
 * Shaped after formatMemoriesForPrompt: a whole task sentence is never a
 * substring of a past message, so we search the task's keywords one by one and
 * rank a conversation by how many of them it matched (more shared words = more
 * likely the same subject), newest breaking ties.
 */
export function briefConversationsForTask(
  list: SearchableConversation[],
  task: string,
  opts: ConversationBriefOptions = {}
): string {
  const terms = keywordsOf(task)
  if (terms.length === 0) return ''
  const exclude = opts.excludeId ?? null
  const max =
    opts.maxConversations && opts.maxConversations > 0 ? Math.floor(opts.maxConversations) : 5

  const agg = new Map<string, { hit: ConversationHit; score: number }>()
  for (const term of terms) {
    for (const hit of searchConversations(list, term)) {
      if (hit.id === exclude) continue
      const prev = agg.get(hit.id)
      if (prev) {
        prev.score += 1
        // Prefer a hit that carries a snippet (body match) over a bare title one.
        if (!prev.hit.snippet && hit.snippet) prev.hit = hit
      } else {
        agg.set(hit.id, { hit, score: 1 })
      }
    }
  }
  if (agg.size === 0) return ''

  const ranked = [...agg.values()]
    .sort((a, b) => b.score - a.score || b.hit.updatedAt.localeCompare(a.hit.updatedAt))
    .slice(0, max)

  const header =
    '## Conversas anteriores relevantes\n' +
    'Trechos de chats passados com este usuário que mencionam este assunto — podem ' +
    'conter decisões, escolhas e armadilhas já discutidas. Leve-os em conta; não os ' +
    'repita de volta ao usuário sem necessidade.'
  const line = ({ hit }: { hit: ConversationHit }): string => {
    const when = hit.updatedAt.slice(0, 10)
    const snip = hit.snippet ? ` — ${hit.snippet}` : ''
    return `- [${hit.title}] (${when})${snip}`
  }
  return `${header}\n\n${ranked.map(line).join('\n')}`
}
