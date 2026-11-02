import type { GuideArticle } from './types'

export const SYNC_ARTICLES: GuideArticle[] = [
  {
    id: 'sync-o-que-e',
    title: 'O que é e o que o servidor vê',
    blocks: [
      {
        type: 'p',
        text: 'A sincronização mantém seus PCs e o celular com os mesmos dados, por meio de um servidor seu na Cloudflare.'
      }
    ],
    target: { view: 'settings', section: 'sincronizacao' }
  }
]
