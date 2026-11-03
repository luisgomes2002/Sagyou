// Which `claude remote-control` servers are running on this PC. Part of "PC
// pronto": the Sagyou is up AND every configured server is up.
//
// Windows does not expose another process's working folder easily, but it does
// expose its command line, and every server is started with `--name "<projeto>"`
// (roadmap, "Um servidor de Remote Control por projeto"). So the configured list
// is of names, matched against the command lines of running processes.
import { log } from '../logs/logger'

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
  platform: NodeJS.Platform = process.platform
): Promise<string[]> {
  if (platform !== 'win32') return []
  try {
    const out = await exec('powershell.exe', [
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
