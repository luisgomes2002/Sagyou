import { describe, it, expect } from 'vitest'
import { uniqueCopyName, planImport, repeatedFileIds } from '../../utils/file-duplicates'
import type { StoredFile } from '../../types'

const file = (id: string, name: string, size = 10): StoredFile => ({
  id,
  name,
  ext: name.includes('.') ? name.slice(name.lastIndexOf('.')) : '',
  size,
  createdAt: '2026-10-27T00:00:00.000Z'
})

describe('uniqueCopyName', () => {
  it('appends the first free number', () => {
    expect(uniqueCopyName('relatorio.pdf', ['relatorio.pdf'])).toBe('relatorio (2).pdf')
    expect(uniqueCopyName('relatorio.pdf', ['relatorio.pdf', 'relatorio (2).pdf'])).toBe(
      'relatorio (3).pdf'
    )
  })

  it('compares names ignoring case', () => {
    expect(uniqueCopyName('Relatorio.PDF', ['relatorio.pdf', 'RELATORIO (2).pdf'])).toBe(
      'Relatorio (3).PDF'
    )
  })

  it('handles names without extension and dotfiles', () => {
    expect(uniqueCopyName('LEIAME', ['leiame'])).toBe('LEIAME (2)')
    expect(uniqueCopyName('.env', ['.env'])).toBe('.env (2)')
  })

  it('numbers from the base when the name already ends in (n)', () => {
    expect(uniqueCopyName('nome (2).pdf', ['nome.pdf', 'nome (2).pdf'])).toBe('nome (3).pdf')
  })

  it('keeps a number in parentheses that is part of the name', () => {
    expect(uniqueCopyName('Balancete (2025).pdf', ['balancete (2025).pdf'])).toBe(
      'Balancete (2025) (2).pdf'
    )
  })
})

describe('planImport', () => {
  it('splits staged files into direct imports and duplicates', () => {
    const plan = planImport(
      [
        { token: 'a', name: 'novo.txt', size: 1 },
        { token: 'b', name: 'Relatorio.pdf', size: 1 }
      ],
      ['relatorio.pdf']
    )
    expect(plan.direct).toEqual([{ token: 'a', name: 'novo.txt' }])
    expect(plan.duplicates).toEqual([{ token: 'b', name: 'Relatorio.pdf' }])
  })

  it('treats a second file with the same name in one selection as a duplicate', () => {
    const plan = planImport(
      [
        { token: 'a', name: 'foto.png', size: 1 },
        { token: 'b', name: 'FOTO.png', size: 2 }
      ],
      []
    )
    expect(plan.direct).toEqual([{ token: 'a', name: 'foto.png' }])
    expect(plan.duplicates).toEqual([{ token: 'b', name: 'FOTO.png' }])
  })
})

describe('repeatedFileIds', () => {
  it('marks files with the same name (any case) and size', () => {
    const ids = repeatedFileIds([
      file('1', 'a.pdf', 5),
      file('2', 'A.pdf', 5),
      file('3', 'a.pdf', 6),
      file('4', 'b.pdf', 5)
    ])
    expect([...ids].sort()).toEqual(['1', '2'])
  })

  it('returns an empty set without repeats', () => {
    expect(repeatedFileIds([file('1', 'a.pdf'), file('2', 'a (2).pdf')]).size).toBe(0)
  })
})
