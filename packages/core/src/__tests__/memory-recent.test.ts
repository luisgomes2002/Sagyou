import { describe, expect, it } from 'vitest'
import { selectRecentMemories, type AiMemory, type RecentMemoryFilter } from '../memory'

const memory = (id: string, updatedAt: string): AiMemory => ({
  id,
  projectId: 'p1',
  type: 'handoff',
  title: id,
  body: 'corpo',
  tags: [],
  pinned: false,
  source: 'modelo',
  createdAt: updatedAt,
  updatedAt,
  lastAccessedAt: updatedAt,
  accessCount: 0,
  archivedAt: null
})

const filter: RecentMemoryFilter = {
  projectId: 'p1',
  allProjects: false,
  status: 'active',
  offset: 0,
  limit: 10
}

describe('selectRecentMemories ordena pelo instante, não pelo texto', () => {
  it('formatos de data misturados (offset e sem milissegundos) ficam na ordem certa', () => {
    const items = selectRecentMemories(
      [
        // 14:00+14:00 é 00:00Z: o mais antigo, embora o texto "14:00" pareça o mais novo.
        memory('a-offset', '2026-11-23T14:00:00+14:00'),
        memory('b-ms', '2026-11-23T10:00:00.000Z'),
        // Sem milissegundos, às 11:00Z: o mais novo.
        memory('c-sem-ms', '2026-11-23T11:00:00Z')
      ],
      filter
    ).items
    expect(items.map((m) => m.id)).toEqual(['c-sem-ms', 'b-ms', 'a-offset'])
  })

  it('o mesmo instante em formatos diferentes desempata pelo id', () => {
    const items = selectRecentMemories(
      [
        memory('z', '2026-11-23T10:00:00.000Z'),
        memory('a', '2026-11-23T10:00:00Z'),
        memory('m', '2026-11-23T07:00:00-03:00')
      ],
      filter
    ).items
    expect(items.map((m) => m.id)).toEqual(['a', 'm', 'z'])
  })

  it('a paginação segue a mesma ordem', () => {
    const all = [
      memory('a-offset', '2026-11-23T14:00:00+14:00'),
      memory('b-ms', '2026-11-23T10:00:00.000Z'),
      memory('c-sem-ms', '2026-11-23T11:00:00Z')
    ]
    const page = selectRecentMemories(all, { ...filter, offset: 1, limit: 1 })
    expect(page.total).toBe(3)
    expect(page.items.map((m) => m.id)).toEqual(['b-ms'])
  })
})
