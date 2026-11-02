import { useMemo, useState, type JSX } from 'react'
import type { FeatureId } from '../../types'
import { isViewEnabled, type NavTarget } from '../../navigation'
import { GUIDE_CHAPTERS, findArticle, searchGuide } from '../../guide/content'
import type { GuideArticle } from '../../guide/types'
import { SectionedPage, type SectionedPageItem } from '../layout/SectionedPage'
import { SECTION_ICONS } from '../layout/sectionIcons'
import { GuideArticleView } from '../guide/GuideArticleView'

interface GuideViewProps {
  initialArticleId?: string
  enabledFeatures: FeatureId[]
  onNavigate: (target: NavTarget) => void
}

const FIRST_ARTICLE_ID = GUIDE_CHAPTERS[0].articles[0].id

export function GuideView({
  initialArticleId,
  enabledFeatures,
  onNavigate
}: GuideViewProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [articleId, setArticleId] = useState(() =>
    initialArticleId && findArticle(initialArticleId) ? initialArticleId : FIRST_ARTICLE_ID
  )
  // Bumped only on an explicit pick, so typing in the search keeps its focus.
  const [picks, setPicks] = useState(0)

  const results = useMemo(() => searchGuide(GUIDE_CHAPTERS, query), [query])
  const items: SectionedPageItem<string>[] = results.flatMap((chapter) =>
    chapter.articles.map((article) => ({
      id: article.id,
      label: article.title,
      group: chapter.label
    }))
  )
  // The open article drops out of the results → show the first result instead.
  const visibleId =
    items.length === 0 || items.some((item) => item.id === articleId) ? articleId : items[0].id
  const current = findArticle(visibleId) ?? findArticle(FIRST_ARTICLE_ID)!

  const pick = (id: string): void => {
    setArticleId(id)
    setPicks((n) => n + 1)
  }
  // Leaving a search keeps the article it showed, instead of jumping back to
  // the one open before typing.
  const changeQuery = (next: string): void => {
    if (!next.trim()) setArticleId(visibleId)
    setQuery(next)
  }
  const clearSearch = (): void => changeQuery('')

  const openArticle = (id: string): void => {
    setQuery('')
    pick(id)
  }

  const search = (
    <label className="flex items-center gap-2 rounded-lg border border-[#2b2b31] bg-[#101014] px-2.5 py-1.5 text-[#999999] focus-within:border-[#6d5bb8]">
      {SECTION_ICONS.search}
      <input
        type="search"
        value={query}
        aria-label="Buscar no guia"
        placeholder="Buscar no guia"
        onChange={(event) => changeQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            clearSearch()
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-[#d4d4d4] outline-none placeholder:text-[#999999]"
      />
    </label>
  )

  const empty = (
    <div className="space-y-2 px-2 py-3">
      <p className="text-sm text-[#999999]">Nada encontrado para &quot;{query.trim()}&quot;.</p>
      <button
        type="button"
        onClick={clearSearch}
        className="rounded-lg bg-[#2a2a30] px-3 py-1.5 text-sm text-[#d4d4d4] hover:bg-[#303036]"
      >
        Limpar busca
      </button>
    </div>
  )

  return (
    <SectionedPage
      title="Como funciona"
      items={items}
      activeId={visibleId}
      onSelect={pick}
      navTop={search}
      emptyNav={empty}
      heading={current.article.title}
      description={current.chapter.label}
      focusKey={picks}
    >
      <GuideArticleView blocks={current.article.blocks} />
      <ArticleTarget
        article={current.article}
        enabledFeatures={enabledFeatures}
        onNavigate={onNavigate}
        onOpenArticle={openArticle}
      />
    </SectionedPage>
  )
}

function ArticleTarget({
  article,
  enabledFeatures,
  onNavigate,
  onOpenArticle
}: {
  article: GuideArticle
  enabledFeatures: FeatureId[]
  onNavigate: (target: NavTarget) => void
  onOpenArticle: (id: string) => void
}): JSX.Element | null {
  const target = article.target
  if (!target) return null

  if (target.view === 'guide') {
    const related = target.articleId ? findArticle(target.articleId) : null
    if (!related) return null
    return (
      <div className="mt-6 border-t border-[#2b2b31] pt-4">
        <button
          type="button"
          onClick={() => onOpenArticle(related.article.id)}
          className="text-sm text-[#a080f0] hover:underline"
        >
          Ler também: {related.article.title}
        </button>
      </div>
    )
  }

  const enabled = target.view === 'settings' || isViewEnabled(target.view, enabledFeatures)
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#2b2b31] pt-4">
      <button
        type="button"
        disabled={!enabled}
        onClick={() => onNavigate(target)}
        className="rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm font-medium text-white hover:bg-[#7b69c6] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Abrir esta tela
      </button>
      {!enabled && (
        <>
          <span className="text-sm text-[#999999]">Esta área está oculta na barra lateral.</span>
          <button
            type="button"
            onClick={() => onNavigate({ view: 'settings', section: 'barra-lateral' })}
            className="text-sm text-[#a080f0] hover:underline"
          >
            Mostrar em Configurações
          </button>
        </>
      )}
    </div>
  )
}
