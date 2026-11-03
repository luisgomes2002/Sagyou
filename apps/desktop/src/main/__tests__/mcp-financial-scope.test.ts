// @vitest-environment node
//
// Financial reads over MCP: a Fleet run stays in its captured profile; the
// external token reads every profile (spec 2026-11-03-acesso-remoto).
import { describe, expect, it } from 'vitest'
import { mcpFinancialTables } from '../modules/agent/mcp-financial-scope'

const data = {
  lists: [
    { id: 'conta', profileId: 'personal', transactions: [] },
    { id: 'empresa', profileId: 'trabalho', transactions: [] },
    { id: 'antiga', transactions: [] }
  ],
  financialProfiles: [
    { id: 'personal', name: 'Minhas finanças' },
    { id: 'trabalho', name: 'Trabalho' }
  ]
}

describe('mcpFinancialTables', () => {
  it('sem perfil na sessão (acesso externo) devolve todos, com o nome do perfil', () => {
    expect(mcpFinancialTables(data, null).map((t) => [t.id, t.profileId, t.profileName])).toEqual([
      ['conta', 'personal', 'Minhas finanças'],
      ['empresa', 'trabalho', 'Trabalho'],
      ['antiga', 'personal', 'Minhas finanças']
    ])
  })

  it('o acesso externo pode filtrar por profileId', () => {
    expect(mcpFinancialTables(data, null, 'trabalho').map((t) => t.id)).toEqual(['empresa'])
    expect(mcpFinancialTables(data, null, 'nao-existe')).toEqual([])
  })

  it('uma run do Fleet fica no perfil capturado e ignora o filtro', () => {
    expect(mcpFinancialTables(data, 'personal', 'trabalho').map((t) => t.id)).toEqual([
      'conta',
      'antiga'
    ])
  })
})
