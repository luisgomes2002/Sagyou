import { isAgentTerminalInput, isAgentTerminalSize, type AgentPty } from './agent-pty'

export interface InteractiveAgentRun {
  interactive: boolean
  externalChild: AgentPty | null
  log: string
  terminalCols?: number
  terminalRows?: number
}

export interface TerminalResult {
  success: boolean
  error?: string
}

type Runs = ReadonlyMap<string, InteractiveAgentRun>

const UNAVAILABLE = 'Sessão interativa indisponível.'

/** Narrow, renderer-facing PTY operations; handlers must not grow their own policy. */
export function writeTerminalInput(runs: Runs, runId: unknown, input: unknown): TerminalResult {
  const run = typeof runId === 'string' ? runs.get(runId) : undefined
  if (!run?.interactive || !run.externalChild)
    return { success: false, error: UNAVAILABLE }
  if (!isAgentTerminalInput(input))
    return { success: false, error: 'Entrada de terminal inválida.' }
  run.externalChild.write(input)
  return { success: true }
}

export function resizeTerminal(
  runs: Runs,
  runId: unknown,
  cols: unknown,
  rows: unknown
): TerminalResult {
  const run = typeof runId === 'string' ? runs.get(runId) : undefined
  if (!run?.interactive || !run.externalChild)
    return { success: false, error: UNAVAILABLE }
  if (!isAgentTerminalSize(cols, rows))
    return { success: false, error: 'Tamanho de terminal inválido.' }
  const columns = cols as number
  const lines = rows as number
  run.externalChild.resize(columns, lines)
  run.terminalCols = columns
  run.terminalRows = lines
  return { success: true }
}

/** Reconnection can expose the existing bounded buffer, never a process handle. */
export function reconnectTerminal(
  runs: Runs,
  runId: unknown
): TerminalResult & { log?: string; cols?: number; rows?: number } {
  const run = typeof runId === 'string' ? runs.get(runId) : undefined
  if (!run?.interactive || !run.externalChild)
    return { success: false, error: UNAVAILABLE }
  return { success: true, log: run.log, cols: run.terminalCols, rows: run.terminalRows }
}
