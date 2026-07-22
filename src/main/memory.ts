// AI memory — durable facts the assistant carries across conversations
// (decisions, tradeoffs, gotchas, per-session handoffs). No Electron or SQL in
// here, so the rules are testable in isolation; store.ts owns the SQLite CRUD
// and index.ts the IPC. Sibling of ./usage and ./run-metrics.
//
// This file is the pure core: it validates input, scrubs secrets before
// anything durable is written, scores decay, and flags conflicting pages. The
// persistence (the `memory` satellite table, written outside persistAll so a
// touch doesn't rewrite the whole DB) lives in store.ts.

export type MemoryType = 'decisao' | 'tradeoff' | 'gotcha' | 'fato' | 'handoff'

export const MEMORY_TYPES: MemoryType[] = ['decisao', 'tradeoff', 'gotcha', 'fato', 'handoff']

export type MemorySource = 'modelo' | 'usuario'

/** What a caller sends to create or edit a memory (crosses IPC — untrusted). */
export interface MemoryInput {
  projectId?: string | null
  type?: string
  title?: string
  body?: string
  tags?: string[]
  pinned?: boolean
  source?: string
}

/** A stored memory. `archivedAt` is set (not deleted) when decay retires it. */
export interface AiMemory {
  id: string
  projectId: string | null // null = global (facts about the user / their style)
  type: MemoryType
  title: string
  body: string
  tags: string[]
  pinned: boolean
  source: MemorySource
  createdAt: string
  updatedAt: string
  lastAccessedAt: string // bumped on every read/injection → feeds decay
  accessCount: number
  archivedAt: string | null
}

export interface MemorySummary {
  total: number
  active: number
  archived: number
  pinned: number
  byType: { type: MemoryType; count: number }[]
}

/** A pair of active memories that look like they say different things about the same subject. */
export interface MemoryConflict {
  a: string // id
  b: string // id
  title: string
}

// ── Tuning ─────────────────────────────────────────────────────────────────

/** Base time-to-live for a memory nobody re-reads. Scaled up by access count. */
export const MEMORY_DECAY_BASE_DAYS = 45

/** Hard ceiling on active memories per store, so the corpus can't grow forever. */
export const MEMORY_MAX = 500

/** How many memories are injected into a run's system prompt before it switches
 *  to an index-only briefing. Load-bearing for token cost. */
export const MEMORY_INJECT_MAX = 40

const DAY_MS = 86_400_000

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function coerceType(v: unknown): MemoryType {
  return (MEMORY_TYPES as string[]).includes(str(v)) ? (v as MemoryType) : 'fato'
}

function coerceSource(v: unknown): MemorySource {
  return v === 'usuario' ? 'usuario' : 'modelo'
}

function coerceTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of v) {
    const s = str(t).trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** Accent-stripped, lowercased key for comparing titles (a Portuguese app). */
export function titleKey(s: string): string {
  return str(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

// ── Sanitisation (security-critical: memory persists and is re-injected) ─────

const REDACTED = '[REDIGIDO]'

// Patterns for things that must never be written into a durable, re-uploaded
// store. Order matters only in that PEM blocks are matched before generic keys.
const SECRET_PATTERNS: RegExp[] = [
  // PEM private keys (any label).
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // Provider API keys: OpenAI (sk-…), Anthropic (sk-ant-…), etc.
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_).
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Google API key.
  /\bAIza[0-9A-Za-z_-]{24,}\b/g,
  // Bearer tokens in prose.
  /\b[Bb]earer\s+[A-Za-z0-9._-]{20,}/g,
  // .env-style secret assignments (KEY=value where the key name smells secret).
  /^[ \t]*[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Za-z0-9_]*[ \t]*[:=][ \t]*\S+/gim
]

/** Redact secret-looking substrings. Returns the cleaned text and whether it touched anything. */
export function scrubSecrets(text: string): { text: string; redacted: boolean } {
  let out = str(text)
  let redacted = false
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      redacted = true
      return REDACTED
    })
  }
  return { text: out, redacted }
}

/**
 * Deterministic id for a project's handoff breadcrumb, so each run upserts the
 * one row instead of piling up (one handoff per project; null = global).
 */
export function handoffId(projectId: string | null): string {
  return `handoff:${projectId ?? 'global'}`
}

// ── Build / normalise ────────────────────────────────────────────────────────

/**
 * Build the memory to persist from a create-or-edit input.
 *
 * `existing` is the current row when editing (null when creating). Only the keys
 * present in `input` are applied over it; timestamps/counters are preserved.
 * Editing an archived memory reactivates it (`archivedAt` → null) — you don't
 * edit something you meant to forget. Secrets are scrubbed here, so every write
 * path is covered rather than each caller remembering to.
 *
 * Returns `{ error }` when the result would be empty (no title and no body),
 * since a blank memory is noise re-uploaded every step.
 */
export function buildMemory(
  existing: AiMemory | null,
  input: MemoryInput,
  id: string,
  now: string
): { memory: AiMemory; redacted: boolean } | { error: string } {
  const has = <K extends keyof MemoryInput>(k: K): boolean =>
    input[k] !== undefined

  const rawTitle = has('title') ? str(input.title).trim() : existing?.title ?? ''
  const rawBody = has('body') ? str(input.body).trim() : existing?.body ?? ''

  const t = scrubSecrets(rawTitle)
  const b = scrubSecrets(rawBody)
  const title = t.text.trim()
  const body = b.text.trim()

  if (!title && !body) return { error: 'memória vazia' }

  const projectId =
    has('projectId') ? (input.projectId == null ? null : str(input.projectId) || null)
      : existing?.projectId ?? null

  const memory: AiMemory = {
    id: existing?.id ?? id,
    projectId,
    type: has('type') ? coerceType(input.type) : existing?.type ?? 'fato',
    title,
    body,
    tags: has('tags') ? coerceTags(input.tags) : existing?.tags ?? [],
    pinned: has('pinned') ? input.pinned === true : existing?.pinned ?? false,
    source: existing?.source ?? coerceSource(input.source),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastAccessedAt: existing?.lastAccessedAt ?? now,
    accessCount: existing?.accessCount ?? 0,
    archivedAt: null // create, or reactivate on edit
  }

  return { memory, redacted: t.redacted || b.redacted }
}

/** Defensive coercion of a loaded row/object into a well-formed AiMemory. */
export function normalizeMemory(raw: Partial<AiMemory> & { id: string }, now: string): AiMemory {
  return {
    id: raw.id,
    projectId: raw.projectId == null ? null : str(raw.projectId) || null,
    type: coerceType(raw.type),
    title: str(raw.title),
    body: str(raw.body),
    tags: coerceTags(raw.tags),
    pinned: raw.pinned === true,
    source: coerceSource(raw.source),
    createdAt: str(raw.createdAt) || now,
    updatedAt: str(raw.updatedAt) || now,
    lastAccessedAt: str(raw.lastAccessedAt) || str(raw.createdAt) || now,
    accessCount: typeof raw.accessCount === 'number' && raw.accessCount >= 0 ? raw.accessCount : 0,
    archivedAt: raw.archivedAt ? str(raw.archivedAt) : null
  }
}

// ── Decay ──────────────────────────────────────────────────────────────────

/**
 * Effective TTL in days, scaled by how often the memory has been used. A memory
 * read many times is effectively permanent; one touched once fades near the
 * base. `log1p` makes accessCount 0 land exactly on the base.
 */
export function decayTtlDays(accessCount: number): number {
  const n = typeof accessCount === 'number' && accessCount > 0 ? accessCount : 0
  return MEMORY_DECAY_BASE_DAYS * (1 + Math.log1p(n))
}

function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : (now - t) / DAY_MS
}

/** Is this active, unpinned memory cold enough to archive? */
export function isStale(m: AiMemory, now: number): boolean {
  if (m.pinned || m.archivedAt) return false
  return daysSince(m.lastAccessedAt, now) > decayTtlDays(m.accessCount)
}

/**
 * Ids to archive: every stale memory, plus — if the active count is over
 * MEMORY_MAX — the coldest unpinned survivors down to the cap. Pinned memories
 * are never selected. Pure: the caller applies the archive.
 */
export function selectStale(memories: AiMemory[], now: number): string[] {
  const active = memories.filter((m) => !m.archivedAt)
  const stale = new Set(active.filter((m) => isStale(m, now)).map((m) => m.id))

  // Cap enforcement: if what's left after decay still exceeds MEMORY_MAX, retire
  // the coldest unpinned survivors until it fits.
  const survivors = active.filter((m) => !stale.has(m.id))
  const overflow = survivors.length - MEMORY_MAX
  if (overflow > 0) {
    survivors
      .filter((m) => !m.pinned)
      .sort((a, b) => Date.parse(a.lastAccessedAt) - Date.parse(b.lastAccessedAt)) // coldest first
      .slice(0, overflow)
      .forEach((m) => stale.add(m.id))
  }
  return [...stale]
}

// ── Briefing (the run-start system-prompt block) ─────────────────────────────

/**
 * A compact id for the briefing: a random-uuid memory shows its first 8 chars
 * (enough to target one, `buscar_memoria` matches by prefix); a handoff's id is
 * already short and meaningful (`handoff:global`), so it's kept whole.
 */
export function shortMemoryId(id: string): string {
  return id.includes(':') ? id : id.slice(0, 8)
}

/**
 * Render active memories as a system-prompt briefing, or '' when there are none.
 *
 * Under `injectMax` it's the full form (type, title, body, tags). Above it, it
 * degrades to titles only plus a note to pull specifics with buscar_memoria — a
 * large corpus mustn't blow the per-step token budget, since the whole prompt is
 * re-sent every step. Order is whatever the caller passed (the store sorts
 * pinned-first, most-recently-touched next).
 *
 * ⚠️ This block is decay-NEUTRAL on purpose: surfacing a memory here does not
 * touch it. Only an explicit buscar_memoria bumps access — otherwise every run
 * would keep the whole corpus warm and nothing would ever decay.
 */
export function formatMemoriesForPrompt(
  memories: AiMemory[],
  injectMax: number = MEMORY_INJECT_MAX
): string {
  const active = memories.filter((m) => !m.archivedAt)
  if (active.length === 0) return ''
  const full = active.length <= injectMax
  const line = (m: AiMemory): string => {
    const pin = m.pinned ? '📌 ' : ''
    const scope = m.projectId ? '' : ' (global)'
    // In title-only mode the body isn't shown, so the model must fetch it — the
    // id lets it target one exactly (titles collide). In full mode the body is
    // already here, so no id: it would be tokens re-sent every step for nothing.
    if (!full) return `- [${shortMemoryId(m.id)}] ${pin}[${m.type}] ${m.title}${scope}`
    const tags = m.tags.length ? ` {${m.tags.join(', ')}}` : ''
    const body = m.body ? ` — ${m.body}` : ''
    return `- ${pin}[${m.type}] ${m.title}${scope}${body}${tags}`
  }
  const header =
    '## Memória (o que você registrou em conversas anteriores)\n' +
    'São fatos seus, de outras conversas com este usuário — leve-os em conta. ' +
    'Se algo aqui contradiz o estado atual, atualize com salvar_memoria. ' +
    'Não os repita de volta ao usuário sem necessidade.'
  const note = full
    ? ''
    : `\n(mostrando só os títulos de ${active.length} memórias; use buscar_memoria com o id em [colchetes], ou um termo, para ler o conteúdo de uma específica)`
  return `${header}${note}\n\n${active.map(line).join('\n')}`
}

// ── Summary / lint ───────────────────────────────────────────────────────────

export function summarizeMemories(memories: AiMemory[]): MemorySummary {
  const active = memories.filter((m) => !m.archivedAt)
  const byType = MEMORY_TYPES.map((type) => ({
    type,
    count: active.filter((m) => m.type === type).length
  })).filter((r) => r.count > 0)
  return {
    total: memories.length,
    active: active.length,
    archived: memories.length - active.length,
    pinned: active.filter((m) => m.pinned).length,
    byType
  }
}

/**
 * Flag pairs of active memories that share a subject (same accent-stripped
 * title) but say different things (different body). Best-effort — a heuristic
 * for "these two may contradict each other", not a proof. Same-title-same-body
 * duplicates are not flagged (harmless); it's the divergent pairs that rot the
 * store ("uses number" vs. a later "uses decimal string").
 */
export function findConflicts(memories: AiMemory[]): MemoryConflict[] {
  // Handoffs are auto-generated breadcrumbs (one per project, all titled the
  // same), not durable knowledge — auditing them for contradiction is noise.
  const active = memories.filter((m) => !m.archivedAt && m.type !== 'handoff')
  const byTitle = new Map<string, AiMemory[]>()
  for (const m of active) {
    const k = titleKey(m.title)
    if (!k) continue
    const bucket = byTitle.get(k)
    if (bucket) bucket.push(m)
    else byTitle.set(k, [m])
  }
  const out: MemoryConflict[] = []
  for (const group of byTitle.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].body.trim() !== group[j].body.trim()) {
          out.push({ a: group[i].id, b: group[j].id, title: group[i].title })
        }
      }
    }
  }
  return out
}
