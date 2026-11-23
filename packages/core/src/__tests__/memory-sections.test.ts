import { describe, expect, it } from 'vitest'
import { replaceMemorySection } from '../memory'

const BODY = 'Intro\n\n## Decisão\nUsar A.\n\n### Detalhe\nporque X\n\n## Outras\nresto'

describe('replaceMemorySection', () => {
  it('troca só o conteúdo da seção, com as subseções, e preserva o resto', () => {
    expect(replaceMemorySection(BODY, 'Decisão', 'Usar B.')).toEqual({
      body: 'Intro\n\n## Decisão\nUsar B.\n\n## Outras\nresto'
    })
  })

  it('acha o título sem acento, sem maiúsculas, com espaços e com # no parâmetro', () => {
    const expected = { body: 'Intro\n\n## Decisão\nX\n\n## Outras\nresto' }
    for (const section of ['decisao', '  DECISÃO ', '## Decisão', '#  decisao'])
      expect(replaceMemorySection(BODY, section, 'X')).toEqual(expected)
  })

  it('o # no fim do título faz parte dele quando não há espaço antes', () => {
    expect(replaceMemorySection('## Notas sobre C#\nx', 'notas sobre c#', 'y')).toEqual({
      body: '## Notas sobre C#\ny'
    })
    expect(replaceMemorySection('## A ##\nx', 'A', 'y')).toEqual({ body: '## A ##\ny' })
  })

  it('a última seção sem quebra final', () => {
    expect(replaceMemorySection('# T\na', 'T', 'b')).toEqual({ body: '# T\nb' })
  })

  it('um título dentro de bloco cercado não conta', () => {
    const body = '## A\n```\n## B\n```\nx'
    expect(replaceMemorySection(body, 'B', 'y')).toEqual({ error: 'not-found' })
    expect(replaceMemorySection(body, 'A', 'y')).toEqual({ body: '## A\ny' })
  })

  it('título repetido ou inexistente', () => {
    expect(replaceMemorySection('## A\n1\n## A\n2', 'A', 'x')).toEqual({ error: 'ambiguous' })
    expect(replaceMemorySection(BODY, 'Inexistente', 'x')).toEqual({ error: 'not-found' })
    expect(replaceMemorySection(BODY, '##', 'x')).toEqual({ error: 'not-found' })
  })

  it('normaliza \\r\\n no corpo inteiro e aceita conteúdo vazio', () => {
    expect(replaceMemorySection('## A\r\n1\r\n## B\r\n2', 'A', 'x')).toEqual({
      body: '## A\nx\n## B\n2'
    })
    expect(replaceMemorySection('## A\n1\n\n## B\n2', 'A', '')).toEqual({
      body: '## A\n\n## B\n2'
    })
  })

  it('a seção termina no próximo título de nível igual ou menor', () => {
    expect(replaceMemorySection('## A\n1\n# Z\n2', 'A', 'x')).toEqual({ body: '## A\nx\n# Z\n2' })
    expect(replaceMemorySection('### D\n1\n## O\n2', 'D', 'x')).toEqual({
      body: '### D\nx\n## O\n2'
    })
    // uma subseção mais funda não encerra a seção
    expect(replaceMemorySection('## A\n1\n### S\n2\n## B\n3', 'A', 'x')).toEqual({
      body: '## A\nx\n## B\n3'
    })
  })

  it('recusa conteúdo com título de nível igual ou menor, mas aceita subseção e bloco cercado', () => {
    expect(replaceMemorySection(BODY, 'Decisão', '## Decisão\nx')).toEqual({
      error: 'heading-in-content'
    })
    expect(replaceMemorySection(BODY, 'Decisão', '# Z\nx')).toEqual({ error: 'heading-in-content' })
    expect(replaceMemorySection('## A\n1', 'A', '### Sub\nx')).toEqual({
      body: '## A\n### Sub\nx'
    })
    expect(replaceMemorySection('## A\n1', 'A', '```\n## nao titulo\n```')).toEqual({
      body: '## A\n```\n## nao titulo\n```'
    })
  })

  it('recusa conteúdo que deixa um bloco de código aberto, que engoliria as outras seções', () => {
    const body = '## A\n1\n\n## B\n2'
    expect(replaceMemorySection(body, 'A', 'Exemplo:\n```ts\nconst x = 1')).toEqual({
      error: 'unclosed-fence'
    })
    expect(replaceMemorySection(body, 'A', '```\n## Z')).toEqual({ error: 'unclosed-fence' })
    expect(replaceMemorySection(body, 'A', '~~~\nx')).toEqual({ error: 'unclosed-fence' })
    // um bloco fechado é aceito, e a seção seguinte continua achável
    const ok = replaceMemorySection(body, 'A', '```ts\nconst x = 1\n```') as { body: string }
    expect(ok.body).toBe('## A\n```ts\nconst x = 1\n```\n\n## B\n2')
    expect(replaceMemorySection(ok.body, 'B', 'novo')).toEqual({
      body: '## A\n```ts\nconst x = 1\n```\n\n## B\nnovo'
    })
  })

  it('o resto do corpo fica igual, linha a linha', () => {
    const out = replaceMemorySection(BODY, 'Outras', 'novo') as { body: string }
    expect(
      out.body.startsWith('Intro\n\n## Decisão\nUsar A.\n\n### Detalhe\nporque X\n\n## Outras')
    ).toBe(true)
    expect(out.body.endsWith('## Outras\nnovo')).toBe(true)
  })
})
