/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  searchConversations,
  briefConversationsForTask,
  briefCurrentConversation,
  type SearchableConversation
} from '../conversation-search'

const conv = (
  id: string,
  title: string,
  messages: { role: 'user' | 'assistant' | 'status'; content: string }[] = [],
  updatedAt = '2026-07-16T10:00:00.000Z'
): SearchableConversation => ({
  id,
  title,
  messages,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt
})

const ids = (hits: { id: string }[]): string[] => hits.map((h) => h.id)

describe('searchConversations', () => {
  it('returns the whole history, newest first, for an empty term', () => {
    const list = [
      conv('old', 'Antiga', [], '2026-07-01T10:00:00.000Z'),
      conv('new', 'Nova', [], '2026-07-16T10:00:00.000Z')
    ]
    // The dropdown shows this before anything is typed — it is not a filter.
    expect(ids(searchConversations(list, ''))).toEqual(['new', 'old'])
    expect(ids(searchConversations(list, '   '))).toEqual(['new', 'old'])
  })

  it('matches the title, case-insensitively', () => {
    const list = [conv('a', 'Planejar Sprint'), conv('b', 'Outra coisa')]
    expect(ids(searchConversations(list, 'sprint'))).toEqual(['a'])
    expect(ids(searchConversations(list, 'PLANEJAR'))).toEqual(['a'])
  })

  it('matches what was said, not just the title', () => {
    const list = [
      conv('a', 'Conversa', [{ role: 'user', content: 'como faço deploy no servidor?' }]),
      conv('b', 'Outra', [{ role: 'user', content: 'nada a ver' }])
    ]
    expect(ids(searchConversations(list, 'deploy'))).toEqual(['a'])
  })

  it('ignores accents, since nobody types them mid-search', () => {
    // The whole app is in Portuguese; "habito" must find "hábito".
    const list = [
      conv('a', 'Hábitos diários'),
      conv('b', 'Conversa', [{ role: 'assistant', content: 'a reunião é amanhã' }])
    ]
    expect(ids(searchConversations(list, 'habitos'))).toEqual(['a'])
    expect(ids(searchConversations(list, 'diarios'))).toEqual(['a'])
    expect(ids(searchConversations(list, 'reuniao'))).toEqual(['b'])
    // …and an accented query still finds the unaccented text.
    expect(ids(searchConversations([conv('c', 'habito')], 'hábito'))).toEqual(['c'])
  })

  it('skips the agent’s own trace lines', () => {
    // Status lines are the tool trace. Matching them would surface every chat
    // that happened to read a file, not the ones that discussed it.
    const list = [conv('a', 'Conversa', [{ role: 'status', content: 'Lendo src/App.tsx' }])]
    expect(searchConversations(list, 'App.tsx')).toEqual([])
  })

  it('returns a snippet for a body match, so the hit explains itself', () => {
    const list = [
      conv('a', 'Conversa', [
        { role: 'assistant', content: 'Para fazer o deploy você precisa rodar o build antes.' }
      ])
    ]
    const [hit] = searchConversations(list, 'deploy')
    expect(hit.snippet).toContain('deploy')
    expect(hit.snippet).toContain('rodar o build')
  })

  it('elides a snippet taken from the middle of a long message', () => {
    const long = `${'contexto '.repeat(30)}a palavra-chave está aqui ${'mais '.repeat(30)}`
    const [hit] = searchConversations(list1(long), 'palavra-chave')

    expect(hit.snippet).toContain('palavra-chave')
    expect(hit.snippet?.startsWith('…')).toBe(true)
    expect(hit.snippet?.endsWith('…')).toBe(true)
    // A snippet is a hint, not the message.
    expect(hit.snippet!.length).toBeLessThan(long.length)
  })

  it('flattens newlines so a snippet stays one line', () => {
    const [hit] = searchConversations(list1('linha um\n\n  linha dois com alvo\nlinha três'), 'alvo')
    expect(hit.snippet).not.toContain('\n')
    expect(hit.snippet).toContain('linha dois com alvo')
  })

  it('gives no snippet when the title is what matched', () => {
    const list = [conv('a', 'Deploy', [{ role: 'user', content: 'nada' }])]
    expect(searchConversations(list, 'deploy')[0].snippet).toBeUndefined()
  })

  it('reports each conversation once, however many times it matches', () => {
    const list = [
      conv('a', 'Deploy', [
        { role: 'user', content: 'deploy?' },
        { role: 'assistant', content: 'deploy!' }
      ])
    ]
    expect(searchConversations(list, 'deploy')).toHaveLength(1)
  })

  it('sorts hits newest first', () => {
    const list = [
      conv('old', 'Deploy antigo', [], '2026-07-01T10:00:00.000Z'),
      conv('new', 'Deploy novo', [], '2026-07-16T10:00:00.000Z')
    ]
    expect(ids(searchConversations(list, 'deploy'))).toEqual(['new', 'old'])
  })

  it('returns nothing when nothing matches', () => {
    expect(searchConversations([conv('a', 'Nada')], 'inexistente')).toEqual([])
  })

  it('survives a conversation with no messages array', () => {
    // Older files, or one hand-edited: a search must not take the app down.
    const broken = { id: 'a', title: 'X', createdAt: '', updatedAt: '' } as SearchableConversation
    expect(() => searchConversations([broken], 'x')).not.toThrow()
    expect(ids(searchConversations([broken], 'x'))).toEqual(['a'])
  })
})

/** One conversation whose only message is `content`. */
function list1(content: string): SearchableConversation[] {
  return [conv('a', 'Sem relação', [{ role: 'assistant', content }])]
}

describe('briefConversationsForTask', () => {
  it('surfaces past conversations that share the task’s keywords', () => {
    const list = [
      conv('a', 'Backup do kanban', [
        { role: 'user', content: 'como funciona o exportBackup?' }
      ]),
      conv('b', 'Assunto sem relação', [{ role: 'user', content: 'nada a ver' }])
    ]
    const brief = briefConversationsForTask(list, 'Corrigir o exportBackup do kanban')
    expect(brief).toContain('## Conversas anteriores relevantes')
    expect(brief).toContain('Backup do kanban')
    expect(brief).not.toContain('Assunto sem relação')
  })

  it('returns an empty string when nothing matches', () => {
    const list = [conv('a', 'Outra coisa', [{ role: 'user', content: 'nada a ver' }])]
    expect(briefConversationsForTask(list, 'implementar decimais nas transações')).toBe('')
  })

  it('returns an empty string when the task has no searchable keyword', () => {
    // All tokens are stopwords or too short — nothing to search on.
    const list = [conv('a', 'Qualquer', [{ role: 'user', content: 'texto qualquer' }])]
    expect(briefConversationsForTask(list, 'faz o que deve para mim')).toBe('')
  })

  it('excludes the conversation that fired the run', () => {
    const list = [
      conv('self', 'Refatorar timers', [{ role: 'user', content: 'refatorar os timers' }]),
      conv('other', 'Timers antigos', [{ role: 'assistant', content: 'os timers giram' }])
    ]
    const brief = briefConversationsForTask(list, 'refatorar os timers do cronometro', {
      excludeId: 'self'
    })
    expect(brief).toContain('Timers antigos')
    expect(brief).not.toContain('Refatorar timers')
  })

  it('ranks a conversation matching more keywords ahead of one matching fewer', () => {
    const list = [
      conv('one', 'Sprint', [{ role: 'user', content: 'planejar a sprint' }]),
      conv('both', 'Sprint financeiro', [
        { role: 'user', content: 'planejar a sprint do modulo financeiro' }
      ])
    ]
    const brief = briefConversationsForTask(list, 'planejar sprint financeiro')
    // The two-keyword hit ('sprint' + 'financeiro') must appear before the one-keyword hit.
    expect(brief.indexOf('Sprint financeiro')).toBeLessThan(brief.indexOf('- [Sprint]'))
  })

  it('ignores accents when matching the task against history', () => {
    const list = [conv('a', 'Hábitos', [{ role: 'user', content: 'marcar o hábito de hoje' }])]
    const brief = briefConversationsForTask(list, 'automatizar os habitos diarios')
    expect(brief).toContain('Hábitos')
  })

  it('caps how many conversations it surfaces', () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      conv(`c${i}`, `Deploy ${i}`, [{ role: 'user', content: 'sobre deploy' }])
    )
    const brief = briefConversationsForTask(list, 'melhorar o deploy', { maxConversations: 3 })
    expect(brief.match(/- \[/g)).toHaveLength(3)
  })
})

describe('briefCurrentConversation', () => {
  it('keeps the original request when the latest user reply is only a confirmation', () => {
    const list = [
      conv('current', 'Landing page', [
        {
          role: 'user',
          content: 'Crie landing-minimal.html para anunciar a pausa do projeto Murasaki.'
        },
        {
          role: 'assistant',
          content: 'Posso tentar novamente sem tocar em landing-dark.html.'
        },
        { role: 'user', content: 'sim' }
      ])
    ]

    const brief = briefCurrentConversation(list, 'current')
    expect(brief).toContain('CONTEXTO OBRIGATÓRIO')
    expect(brief).toContain('landing-minimal.html')
    expect(brief).toContain('projeto Murasaki')
    expect(brief).toContain('Usuário: sim')
  })

  it('omits status traces and caps a large transcript', () => {
    const list = [
      conv('current', 'Longa', [
        { role: 'user', content: 'pedido original' },
        { role: 'status', content: 'Lendo arquivo enorme' },
        { role: 'assistant', content: 'x'.repeat(10_000) }
      ])
    ]

    const brief = briefCurrentConversation(list, 'current')
    expect(brief).not.toContain('Lendo arquivo enorme')
    expect(brief.length).toBeLessThan(6400)
  })

  it('returns empty when the conversation is unavailable', () => {
    expect(briefCurrentConversation([], 'missing')).toBe('')
    expect(briefCurrentConversation([], null)).toBe('')
  })
})
