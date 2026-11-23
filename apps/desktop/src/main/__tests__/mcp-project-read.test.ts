// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  PROJECT_NOT_FOUND,
  PROJECT_READ_REFUSED,
  ProjectReadGrants,
  crossProjectTarget,
  projectReadResumo,
  type ProjectReadDecision
} from '../modules/agent/mcp-project-read'

describe('crossProjectTarget', () => {
  it('devolve o outro projeto e nada nos demais casos', () => {
    expect(crossProjectTarget('A', 'B')).toBe('B')
    expect(crossProjectTarget('A', 'A')).toBeNull()
    expect(crossProjectTarget('A', undefined)).toBeNull()
    expect(crossProjectTarget('A', null)).toBeNull()
    expect(crossProjectTarget('A', '')).toBeNull()
    // sessão sem projeto (geral ou acesso externo) lê todos, sem cartão
    expect(crossProjectTarget(null, 'B')).toBeNull()
  })
})

describe('projectReadResumo', () => {
  it('é o texto do cartão e deixa o nome em uma linha só', () => {
    expect(projectReadResumo('Murasaki')).toBe('Ler memórias do projeto "Murasaki"?')
    expect(projectReadResumo('A "B"\nC')).toBe(`Ler memórias do projeto "A 'B' C"?`)
    const long = projectReadResumo('x'.repeat(200))
    expect(long).toBe(`Ler memórias do projeto "${'x'.repeat(80)}"?`)
  })
})

function grants(decide: (token: string, projectId: string) => Promise<ProjectReadDecision>): {
  grants: ProjectReadGrants
  ask: ReturnType<typeof vi.fn>
} {
  const ask = vi.fn(decide)
  return { grants: new ProjectReadGrants(ask), ask }
}

describe('ProjectReadGrants', () => {
  it('aprovado vale para o token e o projeto, sem perguntar de novo', async () => {
    const { grants: g, ask } = grants(async () => 'approved')
    expect(await g.check('t1', 'B')).toEqual({ ok: true })
    expect(await g.check('t1', 'B')).toEqual({ ok: true })
    expect(ask).toHaveBeenCalledTimes(1)
    await g.check('t1', 'C')
    await g.check('t2', 'B')
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('recusa nunca é lembrada: a chamada seguinte pergunta de novo', async () => {
    const { grants: g, ask } = grants(async () => 'refused')
    const refused = { ok: false, error: PROJECT_READ_REFUSED, reason: 'refused' }
    expect(await g.check('t1', 'B')).toEqual(refused)
    expect(await g.check('t1', 'B')).toEqual(refused)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('projeto inexistente não é lembrado', async () => {
    const { grants: g, ask } = grants(async () => 'not-found')
    const missing = { ok: false, error: PROJECT_NOT_FOUND, reason: 'not-found' }
    expect(await g.check('t1', 'B')).toEqual(missing)
    expect(await g.check('t1', 'B')).toEqual(missing)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('duas chamadas ao mesmo tempo compartilham uma só pergunta', async () => {
    let answer: (decision: ProjectReadDecision) => void = () => {}
    const { grants: g, ask } = grants(() => new Promise((resolve) => (answer = resolve)))
    const first = g.check('t1', 'B')
    const second = g.check('t1', 'B')
    answer('approved')
    expect(await first).toEqual({ ok: true })
    expect(await second).toEqual({ ok: true })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('falha fechado quando a pergunta lança ou rejeita', async () => {
    const { grants: g } = grants(async () => {
      throw new Error('boom')
    })
    expect(await g.check('t1', 'B')).toMatchObject({ ok: false, error: PROJECT_READ_REFUSED })
  })

  it('drop apaga as concessões daquele token e não dos outros', async () => {
    const { grants: g, ask } = grants(async () => 'approved')
    await g.check('t1', 'B')
    await g.check('t2', 'B')
    g.drop('t1')
    await g.check('t1', 'B')
    await g.check('t2', 'B')
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('uma aprovação que chega depois do drop não deixa concessão', async () => {
    let answer: (decision: ProjectReadDecision) => void = () => {}
    const { grants: g, ask } = grants(() => new Promise((resolve) => (answer = resolve)))
    const open = g.check('t1', 'B')
    g.drop('t1')
    answer('approved')
    expect(await open).toMatchObject({ ok: false, error: PROJECT_READ_REFUSED })
    ask.mockImplementation(async () => 'approved')
    expect(await g.check('t1', 'B')).toEqual({ ok: true })
    expect(ask).toHaveBeenCalledTimes(2) // perguntou de novo: nada ficou concedido
  })
})
