// IPC of the Remote Control servers the Sagyou manages (spec
// docs/specs/2026-11-09-servidores-remote-control.md). Registered after
// protectDataIpc: the screen that lists them and the Fleet tab of each server
// only exist with the Sagyou unlocked. The phone reaches the same manager
// through the remote-service, not through here.
//
// The renderer never picks a command, a folder or a process: it names a project
// (the manager resolves its folder) or a terminal it already shows, and the
// bytes it may send to that terminal are bounded like the Fleet's.
import type { IpcMain } from 'electron'
import { isAgentTerminalInput, isAgentTerminalSize } from '../modules/agent/agent-pty'
import type {
  RcManager,
  RcServerView,
  RcStartResult,
  RcStopResult
} from '../modules/remote/rc-manager'

export const RC_SERVER_TEXT = {
  invalidProject: 'Projeto inválido.',
  invalidTerminal: 'Terminal de servidor indisponível.',
  invalidInput: 'Entrada de terminal inválida.',
  invalidSize: 'Tamanho de terminal inválido.'
} as const

/** Same bound as a project id in a phone's request (parseServerRequest). */
export const MAX_PROJECT_ID = 64

export interface RcServerList {
  /** Windows only; elsewhere the screen hides the section. */
  supported: boolean
  servers: RcServerView[]
}

export type RcServerResult = { success: true } | { success: false; error: string }

export interface RcServerHandlerDeps {
  manager: Pick<
    RcManager,
    'list' | 'configure' | 'start' | 'stop' | 'input' | 'resize' | 'snapshot'
  >
  platform: NodeJS.Platform
}

export function validProjectId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PROJECT_ID
}

const validTerminalId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.startsWith('server:') &&
  validProjectId(value.slice('server:'.length))

export function rcServerList(deps: RcServerHandlerDeps): RcServerList {
  return { supported: deps.platform === 'win32', servers: deps.manager.list() }
}

export function registerRcServerHandlers(ipcMain: IpcMain, deps: RcServerHandlerDeps): void {
  const { manager } = deps
  const badProject = { success: false as const, error: RC_SERVER_TEXT.invalidProject }

  ipcMain.handle('rc-server:list', (): RcServerList => rcServerList(deps))

  ipcMain.handle('rc-server:configure', (_, projectId: unknown, patch: unknown): RcServerResult => {
    if (!validProjectId(projectId)) return badProject
    const raw = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
    const clean: { enabled?: boolean; autostart?: boolean } = {}
    if (typeof raw.enabled === 'boolean') clean.enabled = raw.enabled
    if (typeof raw.autostart === 'boolean') clean.autostart = raw.autostart
    manager.configure(projectId, clean)
    return { success: true }
  })

  // "Ligar" at the PC: the only origin that can confirm a project.
  ipcMain.handle(
    'rc-server:start',
    async (
      _,
      projectId: unknown
    ): Promise<{ success: boolean; result?: RcStartResult; error?: string }> => {
      if (!validProjectId(projectId)) return badProject
      const result = await manager.start(projectId, 'pc')
      return { success: result === 'ok', result }
    }
  )

  ipcMain.handle(
    'rc-server:stop',
    async (
      _,
      projectId: unknown
    ): Promise<{ success: boolean; result?: RcStopResult; error?: string }> => {
      if (!validProjectId(projectId)) return badProject
      const result = await manager.stop(projectId)
      return { success: result === 'ok', result }
    }
  )

  ipcMain.handle('rc-server:terminal-input', (_, id: unknown, data: unknown): RcServerResult => {
    if (!validTerminalId(id)) return { success: false, error: RC_SERVER_TEXT.invalidTerminal }
    if (!isAgentTerminalInput(data)) return { success: false, error: RC_SERVER_TEXT.invalidInput }
    return manager.input(id, data)
      ? { success: true }
      : { success: false, error: RC_SERVER_TEXT.invalidTerminal }
  })

  ipcMain.handle(
    'rc-server:terminal-resize',
    (_, id: unknown, cols: unknown, rows: unknown): RcServerResult => {
      if (!validTerminalId(id)) return { success: false, error: RC_SERVER_TEXT.invalidTerminal }
      if (!isAgentTerminalSize(cols, rows)) {
        return { success: false, error: RC_SERVER_TEXT.invalidSize }
      }
      return manager.resize(id, cols as number, rows as number)
        ? { success: true }
        : { success: false, error: RC_SERVER_TEXT.invalidTerminal }
    }
  )

  // Read-only: the bounded buffer of a terminal that exists, never a process.
  ipcMain.handle(
    'rc-server:terminal-reconnect',
    (
      _,
      id: unknown
    ): { success: boolean; log?: string; cols?: number; rows?: number; error?: string } => {
      if (!validTerminalId(id)) return { success: false, error: RC_SERVER_TEXT.invalidTerminal }
      const snap = manager.snapshot(id)
      if (!snap) return { success: false, error: RC_SERVER_TEXT.invalidTerminal }
      return { success: true, log: snap.log, cols: snap.cols, rows: snap.rows }
    }
  )
}
