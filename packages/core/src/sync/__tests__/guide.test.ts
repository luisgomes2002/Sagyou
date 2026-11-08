import { describe, expect, it } from 'vitest'
import { fromRecoveryCode } from '../crypto'
import { MAX_BACKOFF_MS, POLL_MS, PUSH_DEBOUNCE_MS } from '../engine'
import {
  EXAMPLE_BACKUP_CODE,
  EXAMPLE_RECOVERY_CODE,
  KEY_LINE_LABELS,
  SYNC_BEHAVIOR_ARTICLE,
  SYNC_GUIDE_ARTICLES,
  SYNC_SWITCH_PHONE_ARTICLE,
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
  // Spec 2026-11-07-endurecer-acesso-remoto, items 3 and 6.
  it('celular perdido: Cortar acesso; código de pareamento pede o autenticador', () => {
    const table = SYNC_KEYS_ARTICLE.blocks.find((b) => b.type === 'table')
    const row =
      table?.type === 'table' ? table.rows.find((r) => r[0].includes('controlar o PC')) : null
    expect(row?.[1]).toContain('Cortar acesso')
    const pair = SYNC_KEYS_ARTICLE.blocks.find(
      (b) => b.type === 'keyExample' && b.name === 'Código de pareamento / QR'
    )
    expect(textOf(pair ? [pair] : [])).toContain('código do autenticador')
  })

  it('tem os dois artigos, nesta ordem', () => {
    expect(SYNC_GUIDE_ARTICLES.map((a) => [a.id, a.title])).toEqual([
      ['sync-comportamento', 'Como a sincronização se comporta'],
      ['sync-chaves', 'As chaves da sincronização'],
      ['sync-trocar-celular', 'Trocar de celular longe de casa']
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

  it('a tabela Perdeu → Usa cobre as sete perdas', () => {
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
      'A senha de configuração',
      'O celular autorizado a controlar o PC'
    ])
    expect(table?.rows.at(-1)?.[1]).toMatch(
      /código de recuperação.*senha do Worker.*código reserva.*senha do Sagyou/
    )
  })

  it('trocar de celular cita as telas e o que guardar fora do celular', () => {
    const text = JSON.stringify(SYNC_SWITCH_PHONE_ARTICLE.blocks)
    for (const part of [
      'Entrar com código de recuperação',
      'Estou longe do PC',
      'guarde fora do celular',
      'código de recuperação',
      'senha de configuração do Worker',
      'códigos reserva'
    ]) {
      expect(text).toContain(part)
    }
    expect(text).not.toMatch(/chat|conversas/i)
  })
})
