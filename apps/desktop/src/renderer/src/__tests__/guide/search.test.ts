import { describe, expect, it } from 'vitest'
import { GUIDE_CHAPTERS } from '../../guide/content'
import { normalizeForSearch, searchGuide } from '../../guide/search'
import type { GuideChapter } from '../../guide/types'

const ids = (chapters: GuideChapter[]) => chapters.flatMap((c) => c.articles.map((a) => a.id))

describe('searchGuide', () => {
  it('returns the same chapters for an empty or blank query', () => {
    expect(searchGuide(GUIDE_CHAPTERS, '')).toBe(GUIDE_CHAPTERS)
    expect(searchGuide(GUIDE_CHAPTERS, '   ')).toBe(GUIDE_CHAPTERS)
  })

  it('ignores accents', () => {
    expect(normalizeForSearch('Sincronização')).toBe('sincronizacao')
    // sync-o-que-e only spells it "sincronização", with the accent.
    expect(ids(searchGuide(GUIDE_CHAPTERS, 'sincronizacao'))).toContain('sync-o-que-e')
  })

  it('ignores case', () => {
    expect(ids(searchGuide(GUIDE_CHAPTERS, 'BACKUP'))).toEqual(
      ids(searchGuide(GUIDE_CHAPTERS, 'backup'))
    )
    expect(ids(searchGuide(GUIDE_CHAPTERS, 'backup')).length).toBeGreaterThan(0)
  })

  it('returns nothing for a word that is nowhere', () => {
    expect(searchGuide(GUIDE_CHAPTERS, 'xyzzy')).toEqual([])
  })

  it('requires every word of the query', () => {
    const chapters: GuideChapter[] = [
      {
        id: 'projetos',
        label: 'P',
        articles: [
          { id: 'um', title: 'Tarefa e prazo', blocks: [] },
          { id: 'dois', title: 'Tarefa', blocks: [{ type: 'p', text: 'sem data' }] }
        ]
      }
    ]
    expect(ids(searchGuide(chapters, 'tarefa prazo'))).toEqual(['um'])
    expect(ids(searchGuide(chapters, 'tarefa'))).toEqual(['um', 'dois'])
  })

  it('keeps the original order and drops empty chapters', () => {
    const result = searchGuide(GUIDE_CHAPTERS, 'cronômetro')
    expect(result.every((c) => c.articles.length > 0)).toBe(true)
    const order = GUIDE_CHAPTERS.map((c) => c.id)
    const resultOrder = result.map((c) => c.id)
    expect([...resultOrder].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(
      resultOrder
    )
  })
})
