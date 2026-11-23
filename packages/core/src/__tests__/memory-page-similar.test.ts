import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  memoryTerms,
  readMemoryPage,
  similarMemories,
  READ_PAGE_DEFAULT,
  READ_PAGE_MAX,
  READ_PAGE_MIN,
  type AiMemory
} from '../memory'

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as T

interface PageCase {
  name: string
  body: string
  offset: number
  limit: number
  expect: { body: string; totalChars: number; truncated: boolean; nextOffset?: number }
}

describe('readMemoryPage (fixture memory-page-vectors.json)', () => {
  const { cases } = load<{ cases: PageCase[] }>('memory-page-vectors.json')
  for (const c of cases)
    it(c.name, () => {
      expect(readMemoryPage(c.body, c.offset, c.limit)).toEqual(c.expect)
    })

  it('as constantes da spec', () => {
    expect([READ_PAGE_DEFAULT, READ_PAGE_MIN, READ_PAGE_MAX]).toEqual([6_000, 500, 12_000])
  })

  it('seguir nextOffset reconstrói o corpo, sem partir um emoji', () => {
    const body = 'a😀b😀cd😀😀ef'
    let offset = 0
    let rebuilt = ''
    for (let guard = 0; guard < 20; guard++) {
      const page = readMemoryPage(body, offset, 3)
      rebuilt += page.body
      if (page.nextOffset === undefined) break
      offset = page.nextOffset
    }
    expect(rebuilt).toBe(body)
    expect(rebuilt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('memoryTerms', () => {
  it('palavras do título e das tags, sem acento, 3+ letras, sem repetição, ordenadas', () => {
    expect(
      memoryTerms({ title: 'Decisão: usar SQLite no app', tags: ['Banco', 'sqlite'] })
    ).toEqual(['app', 'banco', 'decisao', 'sqlite', 'usar'])
  })
})

interface SimilarCase {
  name: string
  memories: {
    id: string
    title: string
    tags: string[]
    body: string
    type?: AiMemory['type']
    archived?: boolean
  }[]
  expect: { a: string; b: string; shared: number; total: number; similarity: number }[]
}

const memory = (m: SimilarCase['memories'][number]): AiMemory => ({
  id: m.id,
  projectId: 'p1',
  type: m.type ?? 'fato',
  title: m.title,
  body: m.body,
  tags: m.tags,
  pinned: false,
  source: 'modelo',
  sourceConversationId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  lastAccessedAt: '2026-11-01T00:00:00.000Z',
  accessCount: 0,
  archivedAt: m.archived ? '2026-11-02T00:00:00.000Z' : null
})

describe('similarMemories (fixture memory-similar-vectors.json)', () => {
  const { cases } = load<{ cases: SimilarCase[] }>('memory-similar-vectors.json')
  for (const c of cases)
    it(c.name, () => {
      expect(similarMemories(c.memories.map(memory))).toEqual(c.expect)
    })

  it('500 memórias ativas terminam e devolvem uma lista', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      memory({
        id: `m${String(i).padStart(3, '0')}`,
        title: `alpha${i % 7} beta${i % 11} gamma delta${i}`,
        tags: ['comum'],
        body: `corpo ${i}`
      })
    )
    expect(Array.isArray(similarMemories(many))).toBe(true)
  })
})
