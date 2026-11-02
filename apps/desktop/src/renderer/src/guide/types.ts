import type { NavTarget } from '../navigation'

export type GuideVisualId =
  | 'board'
  | 'planejamento'
  | 'meta-habito'
  | 'perfis'
  | 'compras'
  | 'saldo'
  | 'vinculos'
  | 'leitura'
  | 'sessoes'

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: 'tip' | 'warning' | 'danger'; text: string }
  | { type: 'command'; command: string; label?: string }
  | { type: 'diagram'; id: 'sync' }
  | { type: 'visual'; id: GuideVisualId }

export interface GuideArticle {
  id: string
  title: string
  blocks: GuideBlock[]
  target?: NavTarget
}

export type GuideChapterId =
  | 'primeiros-passos'
  | 'projetos'
  | 'organizacao'
  | 'metas-habitos'
  | 'financeiro'
  | 'sessoes-codigo'
  | 'sincronizacao'
  | 'dados-seguranca'

export interface GuideChapter {
  id: GuideChapterId
  label: string
  articles: GuideArticle[]
}
