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
  mcpWriteResult
} from '../modules/agent/mcp-write-tools'
import { MCP_RENDERER_WRITE_TOOLS } from '../modules/agent/mcp-write-types'
import { MCP_PERMISSIONS } from '../modules/agent/sagyou-mcp'

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
    expect(MCP_APPROVAL_REQUIRED.size + MCP_NO_APPROVAL.size).toBe(34)
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
