import type { IpcMain } from 'electron'
import type { LogArea, LogData } from '../modules/logs/logger'
import {
  externalMcpCommand,
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
  /** The token changed (created, replaced, revoked): writes queued by the old one are refused. */
  onTokenChanged?: () => void
  log: { info: LogFn; warn: LogFn }
}

export type McpExternalIssued =
  | { ok: true; token: string; command: string; status: McpExternalStatus }
  | { ok: false; error: string }

/**
 * `mcp-external:*`. Register after protectDataIpc. The token leaves main only
 * in the answer to create, once; status never carries it or its hash. The
 * token has no scope and no expiry (spec docs/specs/2026-11-03-acesso-remoto.md):
 * "Gerar novo token" is create again, which replaces the current one.
 */
export function registerMcpExternalHandlers(ipcMain: IpcMain, deps: McpExternalHandlerDeps): void {
  ipcMain.handle('mcp-external:status', (): McpExternalStatus => deps.store.status())

  ipcMain.handle('mcp-external:create', (): McpExternalIssued => {
    try {
      deps.writeBridge()
      const { token, status } = deps.store.create()
      deps.onTokenChanged?.()
      deps.log.info('mcp', 'external_token_created')
      return {
        ok: true,
        token,
        command: externalMcpCommand(token, deps.execPath, deps.bridgePath, deps.portFile),
        status
      }
    } catch {
      deps.log.warn('mcp', 'external_token_failed')
      return { ok: false, error: 'Não foi possível gerar o acesso MCP externo.' }
    }
  })

  ipcMain.handle('mcp-external:set-allow-locked', (_event, value: unknown): McpExternalStatus => {
    if (typeof value !== 'boolean') return deps.store.status()
    const status = deps.store.setAllowWhileLocked(value)
    if (status.state === 'active') deps.log.info('mcp', 'external_allow_locked', { value })
    return status
  })

  ipcMain.handle('mcp-external:revoke', (): McpExternalStatus => {
    deps.store.revoke()
    deps.onTokenChanged?.()
    deps.log.info('mcp', 'external_token_revoked')
    return deps.store.status()
  })
}
