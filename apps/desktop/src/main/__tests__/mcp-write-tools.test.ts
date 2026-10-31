// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MCP_APPROVAL_REQUIRED,
  MCP_DENIAL_MESSAGE,
  MCP_NO_APPROVAL,
  MCP_WRITE_TOOLS,
  MCP_WRITE_TOOL_NAMES,
  autoApprovesPending,
  mcpWriteResult,
  prepareMemoryWrite,
  type McpMemoryDeps
} from '../modules/agent/mcp-write-tools'
import { MCP_MEMORY_WRITE_TOOLS, MCP_RENDERER_WRITE_TOOLS } from '../modules/agent/mcp-write-types'
import { MCP_PERMISSIONS } from '../modules/agent/sagyou-mcp'
import type { AiMemory } from '../modules/ai/memory'

const APPROVAL_LIST = [
  'archive_project',
  'delete_project',
  'delete_column',
  'delete_task',
  'delete_goal',
  'delete_note',
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'create_financial_table',
  'remove_financial_category',
  'create_financial_profile',
  'rename_financial_profile',
  'delete_memory'
]

describe('MCP write tool classification', () => {
  it('classifies every write tool exactly once and matches the approved card list', () => {
    const names = MCP_WRITE_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual([...MCP_WRITE_TOOL_NAMES].sort())
    for (const name of names)
      expect(Number(MCP_APPROVAL_REQUIRED.has(name)) + Number(MCP_NO_APPROVAL.has(name))).toBe(1)
    expect([...MCP_APPROVAL_REQUIRED].sort()).toEqual([...APPROVAL_LIST].sort())
    expect(MCP_APPROVAL_REQUIRED.size + MCP_NO_APPROVAL.size).toBe(38)
  })

  it('declares the task timer tools without an approval card', () => {
    const byName = (name: string): Record<string, unknown> | undefined =>
      MCP_WRITE_TOOLS.find((tool) => tool.name === name)?.inputSchema
    for (const name of ['start_task_timer', 'stop_task_timer', 'add_time_spent']) {
      expect(MCP_NO_APPROVAL.has(name)).toBe(true)
      expect(Object.keys((byName(name)?.properties as object) ?? {})).toEqual(
        expect.arrayContaining(['projectId', 'id', 'title'])
      )
    }
    const addTime = byName('add_time_spent')
    expect((addTime?.properties as Record<string, unknown>).seconds).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 86400,
      description: 'Segundos a somar ao tempo da tarefa (1 a 86400).'
    })
    expect(addTime?.required).toEqual(['seconds'])
  })

  it('transaction tools expose bank fields and details', () => {
    const schemaOf = (name: string): Record<string, unknown> =>
      MCP_WRITE_TOOLS.find((tool) => tool.name === name)?.inputSchema ?? {}
    const create = schemaOf('create_transaction')
    const update = schemaOf('update_transaction')
    for (const schema of [create, update]) {
      const properties = schema.properties as Record<string, Record<string, unknown>>
      expect(Object.keys(properties)).toEqual(
        expect.arrayContaining(['source', 'counterparty', 'bankReference', 'details'])
      )
      expect(properties.details.type).toBe('array')
      expect(properties.details.maxItems).toBe(200)
      const items = properties.details.items as Record<string, unknown>
      expect(items.required).toEqual(['description', 'amount'])
      expect(items.additionalProperties).toBe(false)
    }
    const itemProps = (schema: Record<string, unknown>): object =>
      ((schema.properties as Record<string, Record<string, Record<string, unknown>>>).details.items
        .properties as object) ?? {}
    expect('id' in itemProps(update)).toBe(true)
    expect('id' in itemProps(create)).toBe(false)
    expect(create.required).toEqual(['tableId', 'type', 'amount', 'description'])
    expect(update.required).toEqual(['tableId', 'id'])
  })

  it('has a denial message for every approval tool', () => {
    for (const name of MCP_APPROVAL_REQUIRED)
      expect(MCP_DENIAL_MESSAGE[name]).toMatch(/não aprovad/)
  })

  it('grants every write tool to code executors through MCP_PERMISSIONS', () => {
    for (const name of MCP_WRITE_TOOL_NAMES) expect(MCP_PERMISSIONS).toContain(name)
  })

  it('renderer mirror lists the same renderer tool names', () => {
    const mirror = readFileSync(join(__dirname, '../../renderer/src/types/mcp-actions.ts'), 'utf8')
    const block = mirror.slice(
      mirror.indexOf('MCP_RENDERER_WRITE_TOOLS = ['),
      mirror.indexOf('] as const')
    )
    const listed = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
    expect(listed).toEqual([...MCP_RENDERER_WRITE_TOOLS])
  })
})

describe('mcpWriteResult', () => {
  it('maps a denied card to the tool denial message', () => {
    expect(mcpWriteResult('delete_task', { approved: false })).toEqual({
      ok: false,
      error: 'Exclusão não aprovada pelo usuário.'
    })
    expect(mcpWriteResult('create_transaction', { approved: false })).toEqual({
      ok: false,
      error: 'Lançamento não aprovado pelo usuário.'
    })
  })

  it('passes a prepare refusal through unchanged', () => {
    const refusal = { ok: false as const, error: 'Projeto não encontrado.' }
    expect(
      mcpWriteResult('delete_project', { approved: false, refused: true, value: refusal })
    ).toBe(refusal)
  })

  it('reports an ended run as a refusal', () => {
    expect(mcpWriteResult('update_task', { approved: false, ended: true })).toEqual({
      ok: false,
      error: 'A execução MCP foi encerrada.'
    })
  })

  it('returns the applied result', () => {
    const value = { ok: true as const, id: 'p1' }
    expect(mcpWriteResult('create_project', { approved: true, value })).toBe(value)
  })
})

describe('prepareMemoryWrite', () => {
  const NOW = '2026-10-25T12:00:00.000Z'
  const memory = (over: Partial<AiMemory> = {}): AiMemory => ({
    id: 'm1',
    projectId: 'p1',
    type: 'decisao',
    title: 'Banco',
    body: 'Usar SQLite.',
    tags: [],
    pinned: false,
    source: 'modelo',
    sourceConversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    accessCount: 3,
    archivedAt: null,
    ...over
  })
  const deps = (memories: AiMemory[]): McpMemoryDeps => ({
    getMemory: (id: string) => memories.find((item) => item.id === id) ?? null,
    listMemories: () => memories,
    now: NOW
  })

  it('update_memory scrubs a secret, keeps pinned and reports redaction', () => {
    const result = prepareMemoryWrite(
      'update_memory',
      { id: 'm1', body: 'Chave sk-abcdefghijklmnopqrstuvwxyz0123456789 no .env' },
      deps([memory({ pinned: true })])
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.op.kind).toBe('upsert')
    if (result.op.kind !== 'upsert') return
    expect(result.op.memory.pinned).toBe(true)
    expect(result.op.memory.body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789')
    expect(result.op.redacted).toBe(true)
    expect(result.op.memory.updatedAt).toBe(NOW)
  })

  it('handoff memory cannot be updated or resolved', () => {
    const handoff = memory({ id: 'h1', type: 'handoff' })
    const refusal = { ok: false, error: 'Memórias de handoff não podem ser alteradas pelo MCP.' }
    expect(prepareMemoryWrite('update_memory', { id: 'h1', body: 'x' }, deps([handoff]))).toEqual(
      refusal
    )
    expect(
      prepareMemoryWrite(
        'resolve_memory_conflict',
        { keepId: 'h1', archiveId: 'm1' },
        deps([handoff, memory()])
      )
    ).toEqual(refusal)
  })

  it('archived or missing memory gives the same refusal on update', () => {
    const refusal = { ok: false, error: 'Memória indisponível nesta sessão MCP.' }
    const archived = memory({ archivedAt: '2026-05-01T00:00:00.000Z' })
    expect(prepareMemoryWrite('update_memory', { id: 'm1', body: 'x' }, deps([archived]))).toEqual(
      refusal
    )
    expect(prepareMemoryWrite('update_memory', { id: 'zz', body: 'x' }, deps([]))).toEqual(refusal)
  })

  it('update_memory enforces the save_memory limits and types', () => {
    const d = deps([memory()])
    expect(
      prepareMemoryWrite('update_memory', { id: 'm1', body: 'x'.repeat(2001) }, d)
    ).toMatchObject({ ok: false })
    expect(prepareMemoryWrite('update_memory', { id: 'm1', type: 'handoff' }, d)).toMatchObject({
      ok: false
    })
    expect(prepareMemoryWrite('update_memory', { id: 'm1' }, d)).toEqual({
      ok: false,
      error: 'Nada para alterar.'
    })
  })

  it('archive, unarchive and delete produce the matching operations', () => {
    const active = memory()
    const archived = memory({ id: 'm2', archivedAt: '2026-05-01T00:00:00.000Z' })
    const d = deps([active, archived])
    expect(prepareMemoryWrite('archive_memory', { id: 'm1' }, d)).toMatchObject({
      ok: true,
      op: { kind: 'archive', id: 'm1' }
    })
    const restored = prepareMemoryWrite('unarchive_memory', { id: 'm2' }, d)
    expect(restored).toMatchObject({ ok: true, op: { kind: 'upsert' } })
    if (restored.ok && restored.op.kind === 'upsert')
      expect(restored.op.memory.archivedAt).toBeNull()
    expect(prepareMemoryWrite('unarchive_memory', { id: 'm1' }, d)).toMatchObject({
      ok: true,
      op: { kind: 'none' }
    })
    expect(prepareMemoryWrite('delete_memory', { id: 'm1' }, d)).toMatchObject({
      ok: true,
      resumo: 'Excluir memória "Banco"',
      op: { kind: 'delete', id: 'm1' }
    })
  })

  it('resolve_memory_conflict archives the loser and never deletes', () => {
    const keep = memory({ id: 'k', body: 'Usar SQLite.' })
    const lose = memory({ id: 'l', body: 'Usar Postgres.' })
    const result = prepareMemoryWrite(
      'resolve_memory_conflict',
      { keepId: 'k', archiveId: 'l', body: 'Usar SQLite (decidido em out/2026).' },
      deps([keep, lose])
    )
    expect(result).toMatchObject({ ok: true, op: { kind: 'resolve', archiveId: 'l' } })
    if (result.ok && result.op.kind === 'resolve')
      expect(result.op.keep?.body).toBe('Usar SQLite (decidido em out/2026).')
  })

  it('resolve refuses a pair that is not a conflict', () => {
    const a = memory({ id: 'a', title: 'Banco' })
    const b = memory({ id: 'b', title: 'Outro assunto', body: 'x' })
    expect(
      prepareMemoryWrite('resolve_memory_conflict', { keepId: 'a', archiveId: 'b' }, deps([a, b]))
    ).toEqual({
      ok: false,
      error: 'Essas memórias não formam uma contradição apontada por check_memories.'
    })
  })

  it('only delete_memory requires approval among memory tools', () => {
    expect(MCP_MEMORY_WRITE_TOOLS.filter((name) => MCP_APPROVAL_REQUIRED.has(name))).toEqual([
      'delete_memory'
    ])
  })
})

describe('autoApprovesPending', () => {
  it('never lets the run auto toggle answer a risky MCP card or the final delivery', () => {
    for (const name of MCP_APPROVAL_REQUIRED) expect(autoApprovesPending(`mcp:${name}`)).toBe(false)
    expect(autoApprovesPending('aplicar_alteracoes_externas')).toBe(false)
  })

  it('keeps auto-approving the cards it approved before', () => {
    expect(autoApprovesPending('mcp:criar_task')).toBe(true)
    expect(autoApprovesPending('mcp:save_memory')).toBe(true)
    expect(autoApprovesPending('escrever_arquivo')).toBe(true)
  })
})
