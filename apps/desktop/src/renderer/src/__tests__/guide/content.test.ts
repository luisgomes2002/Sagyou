import { describe, expect, it } from 'vitest'
import { GUIDE_CHAPTERS, articleText, findArticle } from '../../guide/content'
import type { AppView, SettingsSectionId } from '../../navigation'

const APP_VIEWS: AppView[] = [
  'home',
  'board',
  'canvas',
  'done',
  'goals',
  'habits',
  'financial',
  'upcoming',
  'reports',
  'files',
  'ai',
  'memory',
  'planejamento',
  'graph',
  'guide',
  'settings'
]
const SETTINGS_SECTIONS: SettingsSectionId[] = [
  'geral',
  'aparencia',
  'barra-lateral',
  'seguranca',
  'sincronizacao',
  'sistema',
  'sobre'
]
const allArticles = GUIDE_CHAPTERS.flatMap((chapter) => chapter.articles)

describe('guide content', () => {
  it('has the eight chapters in order', () => {
    expect(GUIDE_CHAPTERS.map((c) => [c.id, c.label])).toEqual([
      ['primeiros-passos', 'Primeiros passos'],
      ['projetos', 'Projetos e tarefas'],
      ['organizacao', 'Organização'],
      ['metas-habitos', 'Metas e hábitos'],
      ['financeiro', 'Financeiro'],
      ['sessoes-codigo', 'Sessões de código'],
      ['sincronizacao', 'Sincronização e celular'],
      ['dados-seguranca', 'Dados e segurança']
    ])
  })

  it('gives every chapter at least one article', () => {
    for (const chapter of GUIDE_CHAPTERS) expect(chapter.articles.length).toBeGreaterThan(0)
  })

  it('uses unique article ids across the whole guide', () => {
    const ids = allArticles.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points every "Abrir esta tela" at a screen that exists', () => {
    for (const article of allArticles) {
      const target = article.target
      if (!target) continue
      expect(APP_VIEWS).toContain(target.view)
      if (target.view === 'settings') expect(SETTINGS_SECTIONS).toContain(target.section)
      if (target.view === 'guide' && target.articleId) {
        expect(findArticle(target.articleId)).not.toBeNull()
      }
    }
  })

  it('no longer talks about the removed chat', () => {
    for (const article of allArticles) {
      const text = articleText(article)
      expect(text, article.id).not.toMatch(/\bchat\b/i)
      expect(text, article.id).not.toMatch(/\bconversas?\b/i)
      expect(text, article.id).not.toMatch(/conta online/i)
    }
  })

  it('puts Excel under Dados e segurança', () => {
    const dados = GUIDE_CHAPTERS.find((c) => c.id === 'dados-seguranca')!
    expect(dados.articles.some((a) => /excel/i.test(articleText(a)))).toBe(true)
  })

  it('finds an article and its chapter by id', () => {
    expect(findArticle('sync-o-que-e')?.chapter.id).toBe('sincronizacao')
    expect(findArticle('nao-existe')).toBeNull()
  })
})
