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

/** Exact name match, case-insensitive, in the configured order. */
export function matchServers(
  commandLines: string[],
  names: string[]
): { name: string; up: boolean }[] {
  const running = new Set(commandLines.flatMap(namesIn).map((n) => n.toLowerCase()))
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
    const out = await exec(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      PS_SCRIPT
    ])
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    log.warn('remote', 'rc_scan_failed')
    return []
  }
}

// Every Remote Control process, the logon task's parent shell included, but
// never the PowerShell running this search.
const KILL_SCAN_SCRIPT =
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'remote-control' -and $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId"

/**
 * "Cortar acesso" (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md): ends
 * every `claude remote-control` with its process tree, through the System32
 * taskkill (never one found on PATH). Returns how many were ended; 0 off
 * Windows or when the search fails. A process that is already gone is skipped.
 */
export async function killRemoteControlServers(
  exec: ExecText,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
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
    pids = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l))
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
