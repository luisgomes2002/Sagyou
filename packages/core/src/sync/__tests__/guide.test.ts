import { describe, expect, it } from 'vitest'
import { fromRecoveryCode } from '../crypto'
import { MAX_BACKOFF_MS, POLL_MS, PUSH_DEBOUNCE_MS } from '../engine'
import {
  EXAMPLE_BACKUP_CODE,
  EXAMPLE_RECOVERY_CODE,
  KEY_LINE_LABELS,
  SYNC_BEHAVIOR_ARTICLE,
  SYNC_GUIDE_ARTICLES,
  SYNC_KEYS_ARTICLE,
  exampleA11yLabel,
  type SyncGuideBlock
} from '../guide'

const textOf = (blocks: SyncGuideBlock[]): string =>
  blocks
    .map((b) =>
      b.type === 'p' || b.type === 'callout'
        ? b.text
        : b.type === 'steps'
          ? b.items.join(' ')
          : b.type === 'keyExample'
            ? b.lines.map((l) => l.text).join(' ')
            : b.rows.flat().join(' ')
    )
    .join(' ')

describe('guia do sync', () => {
  it('tem os dois artigos, nesta ordem', () => {
    expect(SYNC_GUIDE_ARTICLES.map((a) => [a.id, a.title])).toEqual([
      ['sync-comportamento', 'Como a sincronização se comporta'],
      ['sync-chaves', 'As chaves da sincronização']
    ])
    expect(SYNC_BEHAVIOR_ARTICLE.blocks).toHaveLength(9)
  })

  it('os tempos do texto batem com os do motor', () => {
    expect(PUSH_DEBOUNCE_MS).toBe(5000)
    expect(POLL_MS).toBe(60000)
    expect(MAX_BACKOFF_MS).toBe(15 * 60000)
    const text = textOf(SYNC_BEHAVIOR_ARTICLE.blocks)
    for (const fragment of ['5 s', '60 s', '15 min', '30 dias', '1 min'])
      expect(text).toContain(fragment)
    expect(textOf(SYNC_KEYS_ARTICLE.blocks)).toContain('10 min')
  })

  it('cada chave tem exemplo e as seis linhas na ordem', () => {
    const keys = SYNC_KEYS_ARTICLE.blocks.filter(
      (b): b is Extract<SyncGuideBlock, { type: 'keyExample' }> => b.type === 'keyExample'
    )
    expect(keys.map((k) => k.name)).toEqual([
      'Código de recuperação',
      'Código do autenticador',
      'Códigos reserva',
      'Senha de configuração do Worker',
      'Código de pareamento / QR'
    ])
    for (const key of keys) {
      expect(key.example).not.toBe('')
      expect(key.lines.map((l) => l.label)).toEqual([...KEY_LINE_LABELS])
      expect(key.lines.every((l) => l.text.trim().length > 0)).toBe(true)
    }
    expect(exampleA11yLabel('Código de recuperação')).toBe(
      'Exemplo de Código de recuperação, não é um valor real'
    )
  })

  it('o código de recuperação de exemplo tem o formato real e nunca é válido', () => {
    const [line, url] = EXAMPLE_RECOVERY_CODE.split('\n')
    expect(line.split('-')).toHaveLength(14)
    expect(line.split('-').every((g) => g.length === 4)).toBe(true)
    expect(url).toBe('https://exemplo.workers.dev')
    expect(() => fromRecoveryCode(EXAMPLE_RECOVERY_CODE)).toThrow()
  })

  it('o código reserva de exemplo tem o formato do Worker', () => {
    expect(EXAMPLE_BACKUP_CODE).toMatch(/^[0-9A-F]{20}$/)
  })

  it('a tabela Perdeu → Usa cobre as seis perdas', () => {
    const table = SYNC_KEYS_ARTICLE.blocks.find(
      (b): b is Extract<SyncGuideBlock, { type: 'table' }> => b.type === 'table'
    )
    expect(table?.head).toEqual(['Perdeu…', 'Usa…'])
    expect(table?.rows.map(([lost]) => lost)).toEqual([
      'Um aparelho',
      'O celular com o autenticador',
      'Todos os aparelhos',
      'O código de recuperação',
      'Os códigos reserva',
      'A senha de configuração'
    ])
  })
})
