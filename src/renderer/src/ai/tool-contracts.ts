import {
  getPermission,
  requiresExplicitApproval as permissionRequiresExplicitApproval,
  type PermissionEntry
} from './permission-registry'
import { registryEntries } from './tools/entries'
import type { AITool } from './tools/helpers'
import { validateToolInput, type ValidationResult } from './validators'

/** Complete runtime description of one tool, shared by every caller. */
export interface ToolContract extends AITool {
  name: string
  permission: PermissionEntry
  validate: (args: Record<string, unknown>) => ValidationResult
  requiresExplicitApproval: boolean
}

const fallbackPermission = (name: string, tool: AITool): PermissionEntry => ({
  name,
  level: tool.write ? 'write' : 'read',
  rationale: 'Compatibilidade para ferramenta legada sem registro de permissão.',
  guard: tool.write ? 'Cartão de aprovação.' : 'Nenhum.',
  since: '2026-10'
})

/** The single runtime contract for tool definition, policy, validation and execution. */
export const toolContracts: Record<string, ToolContract> = Object.fromEntries(
  Object.entries(registryEntries).map(([name, tool]) => [
    name,
    {
      ...tool,
      name,
      permission: getPermission(name) ?? fallbackPermission(name, tool),
      validate: (args: Record<string, unknown>) => validateToolInput(name, args),
      requiresExplicitApproval: permissionRequiresExplicitApproval(name)
    }
  ])
)

const legacyToolAliases: Record<string, string> = {
  buscar_memoria: 'search_memory',
  salvar_memoria: 'save_memory',
  verificar_memorias: 'check_memories',
  buscar_conversas: 'search_conversations',
  ler_conversa: 'read_conversation',
  rodar_agente_codigo: 'run_code_agent'
}

const canonical = (name: string): string => legacyToolAliases[name] ?? name

export function getToolContract(name: string): ToolContract | undefined {
  return toolContracts[canonical(name)]
}

export function validateToolCall(name: string, args: Record<string, unknown>): ValidationResult {
  return (
    toolContracts[canonical(name)]?.validate(args) ?? {
      valid: false,
      errors: ['Ferramenta desconhecida'],
      warnings: []
    }
  )
}

export function requiresExplicitApproval(name: string): boolean {
  return toolContracts[canonical(name)]?.requiresExplicitApproval === true
}
