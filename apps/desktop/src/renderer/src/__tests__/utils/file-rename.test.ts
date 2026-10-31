import { describe, it, expect } from 'vitest'
import { fileStem, validateFileRename } from '../../utils/file-rename'
import type { StoredFile } from '../../types'

const file = (id: string, name: string, ext = '.pdf'): StoredFile => ({
  id,
  name,
  ext,
  size: 10,
  createdAt: '2026-10-27T00:00:00.000Z'
})

describe('fileStem', () => {
  it('drops the stored extension only', () => {
    expect(fileStem(file('a', 'Balancete (2025).pdf'))).toBe('Balancete (2025)')
    expect(fileStem(file('a', 'notas.tar.gz', '.gz'))).toBe('notas.tar')
    expect(fileStem(file('a', 'LEIAME', ''))).toBe('LEIAME')
  })
})

describe('validateFileRename', () => {
  const target = file('a', 'IMG_1422.jpg', '.jpg')

  it('trims and keeps the original extension', () => {
    expect(validateFileRename(target, '  Comprovante luz outubro  ', [target])).toEqual({
      ok: true,
      name: 'Comprovante luz outubro.jpg',
      unchanged: false
    })
  })

  it('reports an unchanged name', () => {
    expect(validateFileRename(target, 'IMG_1422', [target])).toEqual({
      ok: true,
      name: 'IMG_1422.jpg',
      unchanged: true
    })
  })

  it('allows changing only the case of its own name', () => {
    expect(validateFileRename(target, 'img_1422', [target])).toMatchObject({
      ok: true,
      name: 'img_1422.jpg',
      unchanged: false
    })
  })

  it('refuses each invalid name with the spec message', () => {
    const cases: [string, string][] = [
      ['   ', 'Digite um nome.'],
      ['x'.repeat(201), 'O nome pode ter até 200 caracteres.'],
      ['a/b', 'O nome não pode ter \\ / : * ? " < > |.'],
      ['a\\b', 'O nome não pode ter \\ / : * ? " < > |.'],
      ['a:b', 'O nome não pode ter \\ / : * ? " < > |.'],
      ['a?b', 'O nome não pode ter \\ / : * ? " < > |.'],
      ['a\u0007b', 'O nome não pode ter \\ / : * ? " < > |.'],
      ['nome.', 'O nome não pode terminar com ponto ou espaço.']
    ]
    for (const [stem, error] of cases)
      expect(validateFileRename(target, stem, [target])).toEqual({ ok: false, error })
    expect(validateFileRename(target, 'x'.repeat(200), [target]).ok).toBe(true)
  })

  it('refuses the name of another file in the same scope, ignoring case', () => {
    const other = file('b', 'Recibo.jpg', '.jpg')
    expect(validateFileRename(target, 'recibo', [target, other])).toEqual({
      ok: false,
      error: 'Já existe um arquivo com esse nome aqui.'
    })
    expect(validateFileRename(target, 'recibo', [target]).ok).toBe(true)
  })
})
