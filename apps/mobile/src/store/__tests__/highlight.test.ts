import { highlightParts } from '../highlight'

describe('destaque do termo buscado', () => {
  it('destaca a palavra sem ligar para maiúsculas', () => {
    expect(highlightParts('Conta de Luz', 'luz')).toEqual([
      { text: 'Conta de ', match: false },
      { text: 'Luz', match: true }
    ])
  })

  it('ignora acento e devolve o trecho original do título', () => {
    const parts = highlightParts('Hábito diário', 'habito')
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Hábito'])
    expect(parts.map((p) => p.text).join('')).toBe('Hábito diário')
  })

  it('destaca cada palavra da busca e todas as ocorrências', () => {
    const parts = highlightParts('Pagar conta de luz e conta de água', 'conta agua')
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['conta', 'conta', 'água'])
  })

  it('busca vazia ou só com palavras de uma letra não destaca nada', () => {
    expect(highlightParts('Comprar pão', '')).toEqual([{ text: 'Comprar pão', match: false }])
    expect(highlightParts('Comprar pão', 'a')).toEqual([{ text: 'Comprar pão', match: false }])
  })
})
