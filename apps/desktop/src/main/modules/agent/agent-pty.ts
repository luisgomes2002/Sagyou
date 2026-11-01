import { spawn, type IPty } from 'node-pty'

export interface AgentPty {
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export interface AgentPtyOptions {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  onData: (data: string) => void
  onExit: (exitCode: number) => void
}

export type AgentPtySpawner = (
  command: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }
) => IPty

/** The renderer can only send terminal bytes to a PTY it already owns. */
export function isAgentTerminalInput(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= 8_000
}

/** Keep hostile or accidental resize values away from the native terminal. */
export function isAgentTerminalSize(cols: unknown, rows: unknown): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    (cols as number) >= 20 &&
    (rows as number) >= 5 &&
    (cols as number) <= 500 &&
    (rows as number) <= 300
  )
}

/** Starts and wires one executor terminal without knowing which agent owns it. */
export function startAgentPty(
  options: AgentPtyOptions,
  spawnPty: AgentPtySpawner = spawn
): AgentPty {
  const terminal = spawnPty(options.command, options.args, {
    name: 'xterm-256color',
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
    cwd: options.cwd,
    env: options.env
  })
  terminal.onData(options.onData)
  terminal.onExit(({ exitCode }) => options.onExit(exitCode))
  return terminal
}
