import type { IpcMain } from 'electron'
import type { LogArea, LogData } from '../modules/logs/logger'
import {
  externalMcpCommand,
  type McpExternalMode,
  type McpExternalScope,
  type McpExternalStatus,
  type McpExternalStore
} from '../modules/agent/mcp-external'

type LogFn = (area: LogArea, event: string, data?: LogData) => void

export interface McpExternalHandlerDeps {
  store: McpExternalStore
  execPath: string
  bridgePath: string
  portFile: string
  /** Writes the bridge source next to the token (idempotent). */
  writeBridge: () => void
  log: { info: LogFn; warn: LogFn }
}

export type McpExternalIssued =
  | { ok: true; token: string; command: string; status: McpExternalStatus }
  | { ok: false; error: string }

const MODES: readonly McpExternalMode[] = ['read', 'read-write']

function scopeOf(input: unknown): McpExternalScope | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const projectId =
    value.projectId === null || value.projectId === undefined
      ? null
      : typeof value.projectId === 'string' && value.projectId.trim()
        ? value.projectId.trim()
        : undefined
  if (projectId === undefined) return null
  if (typeof value.financialProfileId !== 'string' || !value.financialProfileId.trim()) return null
  if (!MODES.includes(value.mode as McpExternalMode)) return null
  return {
    projectId,
    financialProfileId: value.financialProfileId.trim(),
    mode: value.mode as McpExternalMode
  }
}

/**
 * `mcp-external:*`. Register after protectDataIpc. The token leaves main only
 * in the answer to create/renew, once; status never carries it or its hash.
 */
export function registerMcpExternalHandlers(ipcMain: IpcMain, deps: McpExternalHandlerDeps): void {
  const issued = (token: string, status: McpExternalStatus): McpExternalIssued => ({
    ok: true,
    token,
    command: externalMcpCommand(token, deps.execPath, deps.bridgePath, deps.portFile),
    status
  })

  const fail = (error: string): McpExternalIssued => ({ ok: false, error })

  ipcMain.handle('mcp-external:status', (): McpExternalStatus => deps.store.status())

  ipcMain.handle('mcp-external:create', (_event, input: unknown): McpExternalIssued => {
    const scope = scopeOf(input)
    if (!scope) return fail('Escolha o perfil financeiro e o tipo de acesso.')
    try {
      deps.writeBridge()
      const { token, status } = deps.store.create(scope)
      deps.log.info('mcp', 'external_token_created', { mode: scope.mode })
      return issued(token, status)
    } catch {
      deps.log.warn('mcp', 'external_token_failed')
      return fail('Não foi possível gerar o acesso MCP externo.')
    }
  })

  ipcMain.handle('mcp-external:renew', (): McpExternalIssued => {
    try {
      deps.writeBridge()
      const renewed = deps.store.renew()
      if (!renewed) return fail('Nenhum acesso externo para renovar.')
      deps.log.info('mcp', 'external_token_created', { mode: renewed.status.scope?.mode ?? '' })
      return issued(renewed.token, renewed.status)
    } catch {
      deps.log.warn('mcp', 'external_token_failed')
      return fail('Não foi possível renovar o acesso MCP externo.')
    }
  })

  ipcMain.handle('mcp-external:revoke', (): McpExternalStatus => {
    deps.store.revoke()
    deps.log.info('mcp', 'external_token_revoked')
    return deps.store.status()
  })
}
