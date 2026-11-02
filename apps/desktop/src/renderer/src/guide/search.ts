import type { GuideArticle, GuideChapter } from './types'

/** Title plus every piece of text in the article's blocks. */
export function articleText(article: GuideArticle): string {
  const parts = [article.title]
  for (const block of article.blocks) {
    if (block.type === 'p' || block.type === 'callout') parts.push(block.text)
    else if (block.type === 'steps') parts.push(...block.items)
    else if (block.type === 'command') parts.push(block.command, block.label ?? '')
    // An example's value is fake: searchable by what it is, never by the value.
    else if (block.type === 'keyExample')
      parts.push(block.name, ...block.lines.map((line) => `${line.label} ${line.text}`))
    else if (block.type === 'table') parts.push(...block.head, ...block.rows.flat())
  }
  return parts.join(' ')
}

/** Lowercase, accents removed, whitespace collapsed: "Sincronização" → "sincronizacao". */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Keeps only the articles that contain every word of the query, in their
 * original order, and drops chapters left empty. An empty query returns the
 * chapters untouched.
 */
export function searchGuide(chapters: GuideChapter[], query: string): GuideChapter[] {
  const normalized = normalizeForSearch(query)
  if (!normalized) return chapters
  const words = normalized.split(' ')
  return chapters
    .map((chapter) => ({
      ...chapter,
      articles: chapter.articles.filter((article) => {
        const haystack = normalizeForSearch(articleText(article))
        return words.every((word) => haystack.includes(word))
      })
    }))
    .filter((chapter) => chapter.articles.length > 0)
}
