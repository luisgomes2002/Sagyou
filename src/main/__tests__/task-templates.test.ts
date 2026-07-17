/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  saveTemplate,
  removeTemplate,
  normalizeTemplates,
  type PromptTemplate
} from '../task-templates'

const NOW = '2026-07-16T12:00:00.000Z'
let n = 0
const newId = (): string => `id${++n}`

const tpl = (over: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: 'a',
  name: 'Dev',
  body: 'gere tasks de dev',
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

const ok = (r: ReturnType<typeof saveTemplate>): { list: PromptTemplate[]; template: PromptTemplate } => {
  if ('error' in r) throw new Error(`expected success, got: ${r.error}`)
  return r
}

describe('saveTemplate', () => {
  it('adds a new template with an id and timestamps', () => {
    const { list, template } = ok(saveTemplate([], { name: 'Dev', body: 'corpo' }, NOW, newId))

    expect(list).toHaveLength(1)
    expect(template).toMatchObject({ name: 'Dev', body: 'corpo', createdAt: NOW, updatedAt: NOW })
    expect(template.id).toBeTruthy()
  })

  it('updates in place, keeping the id and the creation time', () => {
    const existing = tpl({ createdAt: '2026-01-01T00:00:00.000Z' })
    const later = '2026-08-01T00:00:00.000Z'

    const { list, template } = ok(
      saveTemplate([existing], { id: 'a', name: 'Dev v2', body: 'novo corpo' }, later, newId)
    )

    expect(list).toHaveLength(1) // updated, not appended
    expect(template).toMatchObject({
      id: 'a',
      name: 'Dev v2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: later
    })
  })

  it('trims the name and the body', () => {
    const { template } = ok(saveTemplate([], { name: '  Dev  ', body: '  corpo  ' }, NOW, newId))
    expect(template).toMatchObject({ name: 'Dev', body: 'corpo' })
  })

  it('refuses a nameless template — it would be unpickable', () => {
    expect(saveTemplate([], { name: '   ', body: 'corpo' }, NOW, newId)).toMatchObject({
      error: expect.stringContaining('nome')
    })
  })

  it('refuses an empty body', () => {
    // The project description is appended to the body; with no body the model
    // gets a description and no instructions.
    expect(saveTemplate([], { name: 'Dev', body: '  ' }, NOW, newId)).toMatchObject({
      error: expect.stringContaining('vazio')
    })
  })

  it('refuses a duplicate name, however it is cased', () => {
    const list = [tpl({ name: 'Dev' })]
    expect(saveTemplate(list, { name: 'dev', body: 'x' }, NOW, newId)).toMatchObject({
      error: expect.stringContaining('Já existe')
    })
  })

  it('lets a template keep its own name when edited', () => {
    // The clash check must not trip over the row being edited.
    const list = [tpl({ id: 'a', name: 'Dev' })]
    expect(ok(saveTemplate(list, { id: 'a', name: 'Dev', body: 'outro' }, NOW, newId)).template.body).toBe(
      'outro'
    )
  })

  it('refuses to update something that is gone', () => {
    expect(saveTemplate([], { id: 'sumiu', name: 'X', body: 'y' }, NOW, newId)).toMatchObject({
      error: expect.stringContaining('não encontrado')
    })
  })

  it('caps a runaway name', () => {
    const { template } = ok(saveTemplate([], { name: 'x'.repeat(200), body: 'c' }, NOW, newId))
    expect(template.name.length).toBeLessThanOrEqual(60)
  })

  it('does not mutate the list it was given', () => {
    const list = [tpl()]
    const copy = structuredClone(list)
    saveTemplate(list, { name: 'Outro', body: 'x' }, NOW, newId)
    expect(list).toEqual(copy)
  })
})

describe('removeTemplate', () => {
  it('drops just that one', () => {
    const list = [tpl({ id: 'a' }), tpl({ id: 'b', name: 'Estudo' })]
    expect(removeTemplate(list, 'a').map((t) => t.id)).toEqual(['b'])
  })

  it('is a no-op for an unknown id', () => {
    const list = [tpl({ id: 'a' })]
    expect(removeTemplate(list, 'nope')).toHaveLength(1)
  })
})

describe('normalizeTemplates', () => {
  it('keeps well-formed templates', () => {
    expect(normalizeTemplates([tpl()])).toHaveLength(1)
  })

  it('drops entries that would break the picker', () => {
    // The file is user-editable and outlives versions; one bad row must not
    // take the dropdown down with it.
    const raw = [
      tpl({ id: 'good' }),
      { id: 'x', name: '', body: 'sem nome' },
      { id: 'y', name: 'Sem corpo', body: '   ' },
      { name: 'Sem id', body: 'x' },
      null,
      'não é um objeto'
    ]
    expect(normalizeTemplates(raw).map((t) => t.id)).toEqual(['good'])
  })

  it('survives a file that is not a list at all', () => {
    for (const raw of [null, undefined, {}, 'texto', 42]) {
      expect(normalizeTemplates(raw)).toEqual([])
    }
  })
})
