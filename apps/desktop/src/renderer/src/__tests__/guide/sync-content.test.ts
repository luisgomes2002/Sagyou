import { describe, expect, it } from 'vitest'
import { SYNC_BEHAVIOR_ARTICLE, SYNC_KEYS_ARTICLE } from '@sagyou/core/sync/guide'
import { GUIDE_CHAPTERS, searchGuide } from '../../guide/content'
import type { GuideArticle, GuideBlock } from '../../guide/types'

const chapter = GUIDE_CHAPTERS.find((c) => c.id === 'sincronizacao')!
const article = (id: string): GuideArticle => chapter.articles.find((a) => a.id === id)!
const blocksOf = <T extends GuideBlock['type']>(
  a: GuideArticle,
  type: T
): Extract<GuideBlock, { type: T }>[] =>
  a.blocks.filter((b): b is Extract<GuideBlock, { type: T }> => b.type === type)

describe('sync chapter', () => {
  it('has the thirteen articles in order', () => {
    expect(chapter.articles.map((a) => [a.id, a.title])).toEqual([
      ['sync-o-que-e', 'O que é e o que o servidor vê'],
      ['sync-servidor', 'Criar o servidor na Cloudflare'],
      ['sync-ativar', 'Ativar no primeiro PC'],
      ['sync-autenticador', 'Cadastrar o autenticador'],
      ['sync-parear-pc', 'Parear outro PC'],
      ['sync-parear-celular', 'Parear o celular'],
      ['sync-comportamento', 'Como a sincronização se comporta'],
      ['sync-chaves', 'As chaves da sincronização'],
      ['sync-conflitos', 'Conflitos'],
      ['sync-perdi-aparelho', 'Perdi um aparelho'],
      ['sync-perdi-todos', 'Perdi todos os aparelhos'],
      ['sync-restaurar-backup', 'Restaurar um backup com a sincronização ligada'],
      ['sync-problemas', 'Problemas comuns']
    ])
  })

  it('says exactly what the phone says about behavior and keys', () => {
    expect(article('sync-comportamento').blocks).toEqual(SYNC_BEHAVIOR_ARTICLE.blocks)
    expect(article('sync-chaves').blocks).toEqual(SYNC_KEYS_ARTICLE.blocks)
    expect(article('sync-chaves').target).toEqual({ view: 'settings', section: 'sincronizacao' })
  })

  // Spec 2026-11-03-acesso-remoto: the phone generates invites too.
  it('says the pairing code may come from a PC or from the phone', () => {
    for (const id of ['sync-parear-pc', 'sync-parear-celular'])
      expect([
        id,
        blocksOf(article(id), 'steps')
          .flatMap((s) => s.items)
          .join(' ')
      ]).toEqual([
        id,
        expect.stringContaining('um PC ou do celular (Ajustes → Parear outro aparelho)')
      ])
  })

  it('no longer tells the phone to resolve on the PC', () => {
    const conflicts = article('sync-conflitos')
      .blocks.map((b) => JSON.stringify(b))
      .join(' ')
    expect(conflicts).not.toMatch(/resolva no PC/)
    expect(conflicts).toMatch(/fecha sozinho/)
  })

  it('opens with the diagram', () => {
    expect(article('sync-o-que-e').blocks[0]).toEqual({ type: 'diagram', id: 'sync' })
  })

  it('lists the server commands exactly as the README, in a runnable order', () => {
    expect(blocksOf(article('sync-servidor'), 'command').map((b) => b.command)).toEqual([
      'npm install',
      'npx wrangler login',
      'npx wrangler d1 create sagyou-sync',
      'npx wrangler d1 execute sagyou-sync --remote --file schema.sql',
      'npx wrangler secret put SETUP_TOKEN',
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      'npx wrangler secret put TOTP_ENC_KEY',
      'npx wrangler deploy'
    ])
  })

  it('warns about the secrets and the recovery code', () => {
    const serverWarning = blocksOf(article('sync-servidor'), 'callout').find(
      (b) => b.tone === 'warning'
    )
    expect(serverWarning?.text).toMatch(/SETUP_TOKEN/)
    expect(serverWarning?.text).toMatch(/TOTP_ENC_KEY/)
    const danger = blocksOf(article('sync-ativar'), 'callout').find((b) => b.tone === 'danger')
    expect(danger?.text).toMatch(/código de recuperação/)
  })

  it('is found by searching for the authenticator', () => {
    const ids = searchGuide(GUIDE_CHAPTERS, 'autenticador').flatMap((c) =>
      c.articles.map((a) => a.id)
    )
    expect(ids).toContain('sync-autenticador')
  })
})
