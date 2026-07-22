// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildMemory,
  normalizeMemory,
  scrubSecrets,
  decayTtlDays,
  isStale,
  selectStale,
  summarizeMemories,
  findConflicts,
  formatMemoriesForPrompt,
  shortMemoryId,
  handoffId,
  titleKey,
  MEMORY_DECAY_BASE_DAYS,
  MEMORY_MAX,
  type AiMemory
} from '../memory'

const NOW = '2026-07-21T12:00:00.000Z'

const mem = (over: Partial<AiMemory> = {}): AiMemory => ({
  id: over.id ?? 'm1',
  projectId: null,
  type: 'fato',
  title: 'titulo',
  body: 'corpo',
  tags: [],
  pinned: false,
  source: 'modelo',
  createdAt: NOW,
  updatedAt: NOW,
  lastAccessedAt: NOW,
  accessCount: 0,
  archivedAt: null,
  ...over
})

const daysAgo = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()

describe('buildMemory (create)', () => {
  it('builds a well-formed memory from input, defaulting the type', () => {
    const res = buildMemory(null, { title: 'usa decimal', body: 'não number', type: 'x' }, 'id1', NOW)
    expect('memory' in res).toBe(true)
    if ('error' in res) throw new Error('unexpected error')
    expect(res.memory).toMatchObject({
      id: 'id1',
      type: 'fato', // 'x' is not a valid type → fallback
      title: 'usa decimal',
      body: 'não number',
      accessCount: 0,
      archivedAt: null
    })
  })

  it('rejects a memory with no title and no body', () => {
    const res = buildMemory(null, { title: '   ', body: '' }, 'id1', NOW)
    expect('error' in res).toBe(true)
  })

  it('dedupes and trims tags, coerces pinned to a strict boolean', () => {
    const res = buildMemory(
      null,
      { title: 't', tags: [' a ', 'a', 'b', ''], pinned: 1 as unknown as boolean },
      'id1',
      NOW
    )
    if ('error' in res) throw new Error('unexpected error')
    expect(res.memory.tags).toEqual(['a', 'b'])
    expect(res.memory.pinned).toBe(false) // only an explicit true pins
  })
})

describe('buildMemory (edit)', () => {
  it('applies only the keys present, preserving counters and createdAt', () => {
    const existing = mem({ id: 'm1', title: 'old', body: 'old body', accessCount: 9, createdAt: daysAgo(30) })
    const res = buildMemory(existing, { title: 'new' }, 'ignored', NOW)
    if ('error' in res) throw new Error('unexpected error')
    expect(res.memory.id).toBe('m1') // keeps its id, ignores the fresh one
    expect(res.memory.title).toBe('new')
    expect(res.memory.body).toBe('old body') // untouched key preserved
    expect(res.memory.accessCount).toBe(9)
    expect(res.memory.createdAt).toBe(existing.createdAt)
    expect(res.memory.updatedAt).toBe(NOW)
  })

  it('reactivates an archived memory on edit', () => {
    const archived = mem({ archivedAt: daysAgo(1) })
    const res = buildMemory(archived, { body: 'revisado' }, 'x', NOW)
    if ('error' in res) throw new Error('unexpected error')
    expect(res.memory.archivedAt).toBeNull()
  })
})

describe('scrubSecrets', () => {
  it('redacts provider keys, AWS ids, github tokens and PEM blocks', () => {
    const dirty = [
      'key sk-abcdef1234567890ABCDEF here',
      'aws AKIAIOSFODNN7EXAMPLE end',
      'gh ghp_0123456789abcdef0123456789abcdef0000',
      '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----'
    ].join('\n')
    const { text, redacted } = scrubSecrets(dirty)
    expect(redacted).toBe(true)
    expect(text).not.toMatch(/sk-abcdef/)
    expect(text).not.toMatch(/AKIA/)
    expect(text).not.toMatch(/ghp_/)
    expect(text).not.toMatch(/BEGIN PRIVATE KEY/)
  })

  it('redacts .env-style secret assignments but leaves ordinary prose', () => {
    const r1 = scrubSecrets('DATABASE_PASSWORD=hunter2')
    expect(r1.redacted).toBe(true)
    const r2 = scrubSecrets('o botão fica azul quando ativo')
    expect(r2.redacted).toBe(false)
    expect(r2.text).toBe('o botão fica azul quando ativo')
  })

  it('is wired into buildMemory so no save can persist a secret', () => {
    const res = buildMemory(null, { title: 'config', body: 'a chave é sk-abcdef1234567890ABCDEF' }, 'id', NOW)
    if ('error' in res) throw new Error('unexpected error')
    expect(res.redacted).toBe(true)
    expect(res.memory.body).not.toMatch(/sk-abcdef/)
  })
})

describe('decay', () => {
  it('scales TTL up with access count, landing on the base at zero', () => {
    expect(decayTtlDays(0)).toBe(MEMORY_DECAY_BASE_DAYS)
    expect(decayTtlDays(20)).toBeGreaterThan(decayTtlDays(1))
  })

  it('marks a cold unpinned memory stale, spares pinned and warm ones', () => {
    const now = Date.parse(NOW)
    const cold = mem({ id: 'cold', lastAccessedAt: daysAgo(120), accessCount: 0 })
    const warm = mem({ id: 'warm', lastAccessedAt: daysAgo(10), accessCount: 0 })
    const pinnedCold = mem({ id: 'pin', lastAccessedAt: daysAgo(120), pinned: true })
    const usedCold = mem({ id: 'used', lastAccessedAt: daysAgo(120), accessCount: 50 })
    expect(isStale(cold, now)).toBe(true)
    expect(isStale(warm, now)).toBe(false)
    expect(isStale(pinnedCold, now)).toBe(false)
    expect(isStale(usedCold, now)).toBe(false) // heavy use extends the TTL past 120d
  })

  it('selectStale returns cold ids and never a pinned one', () => {
    const now = Date.parse(NOW)
    const list = [
      mem({ id: 'cold', lastAccessedAt: daysAgo(200) }),
      mem({ id: 'pin', lastAccessedAt: daysAgo(200), pinned: true }),
      mem({ id: 'warm', lastAccessedAt: daysAgo(1) })
    ]
    expect(selectStale(list, now)).toEqual(['cold'])
  })

  it('enforces the cap by retiring the coldest unpinned survivors', () => {
    const now = Date.parse(NOW)
    // All warm (none stale by time), but over the cap by 2.
    const list: AiMemory[] = []
    for (let i = 0; i < MEMORY_MAX + 2; i++) {
      list.push(mem({ id: `w${i}`, lastAccessedAt: daysAgo(i % 5) }))
    }
    const stale = selectStale(list, now)
    expect(stale.length).toBe(2)
  })
})

describe('summarizeMemories', () => {
  it('counts active vs archived, pinned, and by type', () => {
    const s = summarizeMemories([
      mem({ id: 'a', type: 'decisao', pinned: true }),
      mem({ id: 'b', type: 'gotcha' }),
      mem({ id: 'c', type: 'gotcha', archivedAt: NOW })
    ])
    expect(s.total).toBe(3)
    expect(s.active).toBe(2)
    expect(s.archived).toBe(1)
    expect(s.pinned).toBe(1)
    expect(s.byType).toContainEqual({ type: 'gotcha', count: 1 }) // archived one excluded
    expect(s.byType).toContainEqual({ type: 'decisao', count: 1 })
  })
})

describe('findConflicts', () => {
  it('flags same-subject memories with different bodies', () => {
    const c = findConflicts([
      mem({ id: 'a', title: 'Campo amount', body: 'usa number' }),
      mem({ id: 'b', title: 'campo amount', body: 'usa decimal string' }), // same title, accent/case aside
      mem({ id: 'c', title: 'outra coisa', body: 'x' })
    ])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ a: 'a', b: 'b' })
  })

  it('does not flag identical duplicates or archived pages', () => {
    const c = findConflicts([
      mem({ id: 'a', title: 'x', body: 'same' }),
      mem({ id: 'b', title: 'x', body: 'same' }),
      mem({ id: 'z', title: 'x', body: 'different', archivedAt: NOW })
    ])
    expect(c).toHaveLength(0)
  })

  it('ignores handoffs (per-project breadcrumbs share a title by design)', () => {
    const c = findConflicts([
      mem({ id: 'h1', type: 'handoff', title: 'Última sessão', body: 'projeto A' }),
      mem({ id: 'h2', type: 'handoff', title: 'Última sessão', body: 'projeto B' })
    ])
    expect(c).toHaveLength(0)
  })
})

describe('formatMemoriesForPrompt', () => {
  it('returns empty for no active memories', () => {
    expect(formatMemoriesForPrompt([])).toBe('')
    expect(formatMemoriesForPrompt([mem({ archivedAt: NOW })])).toBe('')
  })

  it('renders the full form under the inject cap, with body, tags, pin and scope', () => {
    const text = formatMemoriesForPrompt([
      mem({ projectId: 'p', type: 'decisao', title: 'Usar SQLite', body: 'satélite', tags: ['db'], pinned: true }),
      mem({ id: 'g', projectId: null, type: 'fato', title: 'Prefere PT-BR', body: 'sempre' })
    ])
    expect(text).toContain('## Memória')
    expect(text).toContain('📌 [decisao] Usar SQLite — satélite {db}')
    expect(text).toContain('[fato] Prefere PT-BR (global) — sempre')
    expect(text).not.toContain('títulos') // full form, no index note
  })

  it('degrades to titles only above the inject cap', () => {
    const list: AiMemory[] = []
    for (let i = 0; i < 5; i++) list.push(mem({ id: `m${i}`, title: `t${i}`, body: `corpo ${i}` }))
    const text = formatMemoriesForPrompt(list, 3) // cap below the count
    expect(text).toContain('mostrando só os títulos')
    expect(text).toContain('buscar_memoria')
    expect(text).not.toContain('corpo 0') // bodies are dropped in index mode
  })

  it('shows the id in title-only mode so the model can target one, but not in full mode', () => {
    const idFull = 'b3789488-1111-2222-3333-444455556666'
    // Title-only mode (cap below count): id prefix appears in brackets.
    const many: AiMemory[] = [mem({ id: idFull, title: 'DAG' })]
    for (let i = 0; i < 3; i++) many.push(mem({ id: `x${i}`, title: `t${i}` }))
    const idx = formatMemoriesForPrompt(many, 2)
    expect(idx).toContain('[b3789488]')
    // Full mode (under cap): body is shown, so no id — it would be tokens for nothing.
    const full = formatMemoriesForPrompt([mem({ id: idFull, title: 'DAG', body: 'corpo' })])
    expect(full).toContain('corpo')
    expect(full).not.toContain('b3789488')
  })
})

describe('shortMemoryId', () => {
  it('takes the first 8 chars of a uuid', () => {
    expect(shortMemoryId('b3789488-1111-2222-3333-444455556666')).toBe('b3789488')
  })
  it('keeps a handoff id whole (already short and meaningful)', () => {
    expect(shortMemoryId('handoff:global')).toBe('handoff:global')
    expect(shortMemoryId(handoffId('proj-1'))).toBe('handoff:proj-1')
  })

  it('excludes archived memories from the briefing', () => {
    const text = formatMemoriesForPrompt([
      mem({ title: 'viva', body: 'x' }),
      mem({ id: 'z', title: 'morta', body: 'y', archivedAt: NOW })
    ])
    expect(text).toContain('viva')
    expect(text).not.toContain('morta')
  })
})

describe('normalizeMemory / titleKey', () => {
  it('coerces a malformed row to a safe shape', () => {
    const m = normalizeMemory(
      { id: 'x', type: 'bogus' as never, accessCount: -3 as never, tags: 'no' as never },
      NOW
    )
    expect(m.type).toBe('fato')
    expect(m.accessCount).toBe(0)
    expect(m.tags).toEqual([])
    expect(m.lastAccessedAt).toBe(NOW)
  })

  it('titleKey strips accents and case', () => {
    expect(titleKey('Hábito  Diário')).toBe(titleKey('habito diario'))
  })

  it('handoffId is deterministic per project, with a global fallback', () => {
    expect(handoffId('p1')).toBe('handoff:p1')
    expect(handoffId(null)).toBe('handoff:global')
    expect(handoffId('p1')).toBe(handoffId('p1')) // stable → upsert, not pile-up
  })
})
