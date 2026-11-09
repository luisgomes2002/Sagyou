// Which `claude remote-control` servers are running on this PC. Part of "PC
// pronto": the Sagyou is up AND every configured server is up.
//
// Windows does not expose another process's working folder easily, but it does
// expose its command line, and every server is started with `--name "<projeto>"`
// (roadmap, "Um servidor de Remote Control por projeto"). So the configured list
// is of names, matched against the command lines of running processes.
import { win32 } from 'path'
import { log } from '../logs/logger'
import { systemExe } from './shutdown'

export type ExecText = (file: string, args: string[]) => Promise<string>

const NAME_FLAG = /--name(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/gi

/** Names given with --name on lines that run `remote-control`. */
function namesIn(line: string): string[] {
  if (!/\bremote-control\b/i.test(line)) return []
  const out: string[] = []
  for (const m of line.matchAll(NAME_FLAG)) out.push((m[1] ?? m[2] ?? m[3] ?? '').trim())
  return out
}

// `remote-control` as a word of its own (not part of a path or a file name)...
const RC_ARG = /(?:^|[\s"'])remote-control(?=[\s"']|$)/i
// ...on a line that runs the Claude CLI: claude, claude.exe/.cmd/.ps1, or the
// npm package's script.
const CLAUDE_CLI =
  /(?:^|[\s"'\\/])claude(?:\.exe|\.cmd|\.ps1)?(?=[\s"']|$)|[\\/]@anthropic-ai[\\/]claude-code[\\/]/i

/**
 * Names on a line that really runs a `claude remote-control` server: the same
 * test as the kill, so another process that merely carries
 * "remote-control --name X" on its line never counts as a server.
 */
function serverNamesIn(line: string): string[] {
  if (!RC_ARG.test(line) || !CLAUDE_CLI.test(line)) return []
  return namesIn(line)
}

/** Exact name match, case-insensitive, in the configured order. */
export function matchServers(
  commandLines: string[],
  names: string[]
): { name: string; up: boolean }[] {
  const running = new Set(commandLines.flatMap(serverNamesIn).map((n) => n.toLowerCase()))
  return names.map((name) => ({ name, up: running.has(name.trim().toLowerCase()) }))
}

const PS_SCRIPT =
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'remote-control' } | Select-Object -ExpandProperty CommandLine"

/** Command lines that mention remote-control; [] off Windows or on any error. */
export async function listCommandLines(
  exec: ExecText,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  if (platform !== 'win32') return []
  try {
    // Absolute path: never a powershell.exe found in the working folder or on PATH.
    const powershell = systemExe(win32.join('WindowsPowerShell', 'v1.0', 'powershell.exe'), env)
    const out = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT])
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    log.warn('remote', 'rc_scan_failed')
    return []
  }
}

/**
 * The --name of every `claude remote-control` process running on this PC, as
 * written on its command line, one per process: a name repeats when several
 * processes carry it (servers this Sagyou started included: the manager tells
 * them apart and counts them). [] off Windows or on any error.
 */
export async function listRemoteControlNames(
  exec: ExecText,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  return (await listCommandLines(exec, platform, env)).flatMap((line) =>
    serverNamesIn(line).slice(0, 1)
  )
}

// Candidates as "pid<TAB>parent<TAB>command line", never the PowerShell running
// this search; remoteControlTargets decides which ones are really servers.
const KILL_SCAN_SCRIPT =
  'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'remote-control\' -and $_.ProcessId -ne $PID } | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }'

/**
 * PIDs to end for "Cortar acesso": a `claude remote-control` server, or the
 * logon task's shell whose own line runs it. Never this Sagyou process or one
 * of its children (review of PR #48: the old match on "remote-control" alone
 * ended editors, builds and git commands in a folder named so). With `name`,
 * only the lines started with that --name (case-insensitive).
 */
export function remoteControlTargets(rows: string[], selfPid: number, name?: string): string[] {
  const wanted = name === undefined ? null : name.trim().toLowerCase()
  const out: string[] = []
  for (const line of rows) {
    const m = /^(\d+)\t(\d+)\t(.*)$/.exec(line.trim())
    if (!m) continue
    const [, pid, parent, command] = m
    if (Number(pid) === selfPid || Number(parent) === selfPid) continue
    if (!RC_ARG.test(command) || !CLAUDE_CLI.test(command)) continue
    // One server only: its own line, or the shell whose line runs it, carries
    // that --name (spec 2026-11-09-servidores-remote-control, "Desligar").
    if (wanted !== null && !namesIn(command).some((n) => n.toLowerCase() === wanted)) continue
    out.push(pid)
  }
  return out
}

/**
 * "Cortar acesso" (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md): ends
 * every `claude remote-control` with its process tree, through the System32
 * taskkill (never one found on PATH). Returns how many were ended; 0 off
 * Windows or when the search fails. A process that is already gone is skipped.
 */
export async function killRemoteControlServers(
  exec: ExecText,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  selfPid: number = process.pid
): Promise<number> {
  return killTargets(exec, platform, env, selfPid)
}

/**
 * "Desligar" on a server the Sagyou did not start (spec
 * docs/specs/2026-11-09-servidores-remote-control.md): the same safe search as
 * the cut, but only the processes started with that --name. Never this Sagyou
 * process or its children.
 */
export async function killRemoteControlServerNamed(
  exec: ExecText,
  name: string,
  selfPid: number = process.pid,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  if (!name.trim()) return 0
  return killTargets(exec, platform, env, selfPid, name)
}

async function killTargets(
  exec: ExecText,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  selfPid: number,
  name?: string
): Promise<number> {
  if (platform !== 'win32') return 0
  let pids: string[]
  try {
    const powershell = systemExe(win32.join('WindowsPowerShell', 'v1.0', 'powershell.exe'), env)
    const out = await exec(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      KILL_SCAN_SCRIPT
    ])
    pids = remoteControlTargets(out.split(/\r?\n/), selfPid, name)
  } catch {
    log.warn('remote', 'rc_kill_failed')
    return 0
  }
  const taskkill = systemExe('taskkill.exe', env)
  let killed = 0
  for (const pid of pids) {
    try {
      await exec(taskkill, ['/PID', pid, '/T', '/F'])
      killed += 1
    } catch {
      // Ended between the search and the kill, or a child of one already killed.
    }
  }
  return killed
}
