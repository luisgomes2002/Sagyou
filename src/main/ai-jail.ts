// ai-jail integration — an OS-level sandbox that confines the code agent's shell
// commands to the project folder (https://github.com/akitaonrails/ai-jail).
//
// Why it matters: the native code agent (./code-agent) runs `executar_comando`
// with no OS confinement of its own — `confineToRoot` guards the read/write
// tools, but a shell command can touch anything the user can. ai-jail closes
// that: on Linux it wraps the command in bubblewrap (+ Landlock/seccomp), on
// macOS in `sandbox-exec` (seatbelt), masking SSH keys, cloud credentials and
// everything outside the project. Windows has no native support — ai-jail only
// runs inside WSL2 — so on Windows the sandbox is reported unavailable and the
// agent's command tool is blocked until the user installs WSL2 + ai-jail (or
// turns the sandbox off, accepting the risk).
//
// The IO here (detection, download, install) is injectable so the pure logic —
// which platform asset, how a command is wrapped, whether a failure looks like a
// sandbox block — is tested without a network or a real binary.

import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { chmodSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'

/** The tool's home, shown to the user in the onboarding dialog. */
export const AI_JAIL_REPO = 'https://github.com/akitaonrails/ai-jail'

/**
 * The release we install and verify against. Pinned rather than "latest": the
 * asset names and the sha256 layout are part of the contract, and a silent
 * upstream rename would turn a security install into a broken download. Bump it
 * deliberately, re-checking the asset names.
 */
export const AI_JAIL_VERSION = 'v1.15.0'

/** A release asset for the current platform, or null when there is no binary. */
export interface JailAsset {
  file: string
  url: string
  /** The `.sha256` sidecar — present for every published tarball. */
  shaUrl: string
}

/**
 * Which release tarball fits this platform/arch, or null when none is published
 * (Windows always; macOS on Intel — both fall back to brew / WSL2).
 *
 * ⚠️ Only two binaries exist upstream: `ai-jail-linux-x86_64.tar.gz` and
 * `ai-jail-macos-aarch64.tar.gz`. Do not invent a Windows `.exe` or a
 * macos-x86_64 asset — the download would 404.
 */
export function assetFor(platform: NodeJS.Platform, arch: string): JailAsset | null {
  let file: string | null = null
  if (platform === 'linux' && arch === 'x64') file = 'ai-jail-linux-x86_64.tar.gz'
  else if (platform === 'darwin' && arch === 'arm64') file = 'ai-jail-macos-aarch64.tar.gz'
  if (!file) return null
  const base = `${AI_JAIL_REPO}/releases/download/${AI_JAIL_VERSION}`
  return { file, url: `${base}/${file}`, shaUrl: `${base}/${file}.sha256` }
}

/** Extract the hex digest from a `.sha256` sidecar ("<hex>  <filename>\n"). */
export function parseSha256(content: string): string | null {
  const m = /\b([0-9a-f]{64})\b/i.exec(content)
  return m ? m[1].toLowerCase() : null
}

/** Single-quote a string for a POSIX shell, escaping embedded quotes. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Wrap a shell command so it runs confined to `projectDir`.
 *
 * `ai-jail --rw-map <dir> -- /bin/sh -c '<command>'`: `--rw-map` makes the
 * project writable, and ai-jail confines/masks everything else by default. The
 * model's command is free-form shell, so it goes through an inner `sh -c`;
 * `aiJailBin` is the ABSOLUTE path from detection, because the app's PATH may
 * not include `~/.local/bin` (the same gap documented for codex).
 *
 * ⚠️ There is no `--workdir` flag (the task's original assumption). Confinement
 * is expressed as mounts; `--rw-map <projectDir>` is the read-write project root.
 */
export function wrapCommand(aiJailBin: string, projectDir: string, command: string): string {
  return `${shQuote(aiJailBin)} --rw-map ${shQuote(projectDir)} -- /bin/sh -c ${shQuote(command)}`
}

/**
 * Translate a Windows path to the WSL view: `C:\Users\x\proj` → `/mnt/c/Users/x/proj`.
 * Used on Windows, where ai-jail runs inside WSL2 and sees the project through
 * the `/mnt/<drive>` mount rather than its Windows path.
 */
export function winToWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m) return p.replace(/\\/g, '/')
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

/**
 * argv for `wsl` that runs `command` sandboxed inside WSL2.
 *
 * `wsl -e <ai-jail-abs-path> --rw-map <wsl-project> -- bash -c 'cd <wsl-project>
 * && <command>'`. Passed as an argv array (never a shell string) so nothing has
 * to survive cmd.exe → wsl → bash quoting; only the inner `bash -c` payload is
 * a string, and the project path in it is single-quoted. `aiJailWslPath` is the
 * ABSOLUTE path detection found inside WSL — `wsl -e` runs it directly, so the
 * non-login PATH inside WSL doesn't matter.
 */
export function wslJailArgv(aiJailWslPath: string, projectDir: string, command: string): string[] {
  const wp = winToWslPath(projectDir)
  const inner = `cd '${wp.replace(/'/g, `'\\''`)}' && ${command}`
  return ['-e', aiJailWslPath, '--rw-map', wp, '--', 'bash', '-c', inner]
}

/**
 * Whether a failed command looks like ai-jail blocked it (vs. an ordinary
 * error). Best-effort and advisory: it only decorates the output with a hint, so
 * a false positive is a slightly-wrong note, never a wrong result. Narrow on
 * purpose — a bare "Permission denied" is far too common to claim as a block.
 */
export function looksLikeSandboxBlock(output: string): boolean {
  return /ai-jail|bwrap:|sandbox denied|denied by sandbox|landlock|seccomp|operation not permitted \(sandbox\)/i.test(
    output
  )
}

/**
 * Whether a bwrap failure is the restricted-user-namespaces case: Ubuntu 23.10+
 * defaults `kernel.apparmor_restrict_unprivileged_userns=1`, which blocks the
 * unprivileged user namespaces bubblewrap needs. The symptom is a `bwrap:` line
 * with "Permission denied"/"Operation not permitted" while creating the
 * namespace — distinct from a sandbox that ran and *denied a file*, which is the
 * sandbox working as intended.
 */
export function looksLikeUserNsBlock(output: string): boolean {
  return (
    /bwrap:/i.test(output) &&
    /(permission denied|operation not permitted|creating new namespace failed|user namespaces?|setting up uid map|clone)/i.test(
      output
    )
  )
}

/**
 * The fix for the restricted-user-namespaces case, surfaced to the user. It
 * weakens the kernel's AppArmor hardening, so — like the codex hint — we only
 * ever *show* the command, never run it.
 */
export const APPARMOR_USERNS_REASON =
  'ai-jail e bubblewrap estão instalados, mas o kernel bloqueia os user namespaces não privilegiados que o sandbox precisa ' +
  '(padrão no Ubuntu 23.10+). Rode: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'

/**
 * Smoke-test the sandbox: run a trivial command *through* ai-jail and confirm it
 * actually confines rather than merely responding to `--version`. Having ai-jail
 * + bwrap on PATH is not proof the sandbox runs (see `looksLikeUserNsBlock`), and
 * a sandbox that can't start is worse than knowing it can't — the run handler
 * refuses to start when the sandbox is required but unavailable, so this turning
 * `available` false is the point.
 *
 * `ai-jail --rw-map <tmp> -- /bin/sh -c 'true'`: a no-op that succeeds iff the
 * namespace can be created. Uses the injected `exec` (with the ABSOLUTE binary
 * path), so it is driven from tests without a real bwrap.
 */
export async function sandboxSmokeTest(
  exec: Exec,
  aiJailBin: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { code, stdout, stderr } = await exec(aiJailBin, ['--rw-map', tmpdir(), '--', '/bin/sh', '-c', 'true'])
    if (code === 0) return { ok: true }
    const out = `${stdout}\n${stderr}`
    if (looksLikeUserNsBlock(out)) return { ok: false, reason: APPARMOR_USERNS_REASON }
    const detail = (stderr.trim() || stdout.trim()).slice(0, 300)
    return {
      ok: false,
      reason: `ai-jail está instalado, mas o teste do sandbox falhou (código ${code}).${detail ? ` ${detail}` : ''}`
    }
  } catch (e) {
    return { ok: false, reason: `Falha ao testar o sandbox do ai-jail: ${e instanceof Error ? e.message : 'erro'}` }
  }
}

/** `~/.local/bin` — the user-writable install target (no sudo). */
export function localBinDir(): string {
  return join(homedir(), '.local', 'bin')
}

/**
 * Where `ai-jail` might live, in the order we try. PATH first (a bare name),
 * then the dirs a GUI-launched app's PATH tends to miss — the same list-then-
 * absolute-path approach `resolveExecutable` uses for codex.
 */
export function candidatePaths(): string[] {
  return [
    'ai-jail',
    join(localBinDir(), 'ai-jail'),
    '/opt/homebrew/bin/ai-jail',
    '/usr/local/bin/ai-jail'
  ]
}

/** Run a program capturing stdout/stderr; injectable so detection is testable. */
export type Exec = (
  cmd: string,
  args: string[]
) => Promise<{ code: number; stdout: string; stderr: string }>

/** Default exec via child_process.execFile (no shell — args are passed as-is). */
export const defaultExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number }) | null
      resolve({ code: e && typeof e.code === 'number' ? e.code : e ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })

/** The version string from `ai-jail --version` output, or null. */
export function parseVersion(stdout: string): string | null {
  const m = /(\d+\.\d+\.\d+)/.exec(stdout)
  return m ? m[1] : null
}

/** Cap on a sandboxed command's captured output, matching the agent's runner. */
const WSL_MAX_BUFFER = 20000 * 4

/**
 * Run `cmd args...` capturing output, with a real timeout — the CommandRunner
 * shape the code agent expects. Unlike `defaultExec` (fixed 15s, for detection),
 * this honours the command's own budget, so a long `npm test` isn't cut short.
 */
export function execArgv(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut?: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: WSL_MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number; killed?: boolean; signal?: string }) | null
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        code: e && typeof e.code === 'number' ? e.code : e ? 1 : 0,
        timedOut: !!(e && (e.killed || e.signal === 'SIGTERM'))
      })
    })
  })
}

/**
 * Run `command` sandboxed inside WSL2 (Windows path). The CommandRunner the
 * run handler plugs in for `viaWsl` status — the counterpart of `wrapCommand`
 * + the plain runner on Linux/macOS.
 */
export function runSandboxedWsl(
  aiJailWslPath: string,
  projectDir: string,
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut?: boolean }> {
  return execArgv('wsl', wslJailArgv(aiJailWslPath, projectDir, command), timeoutMs)
}

export interface JailStatus {
  available: boolean
  version: string | null
  /** The absolute path detection found (used to wrap commands), or null. */
  path: string | null
  platform: NodeJS.Platform
  /** Whether this platform can install ai-jail directly (false on Windows). */
  installable: boolean
  /** Linux only: is bubblewrap present (ai-jail needs it)? Undefined elsewhere. */
  bubblewrap?: boolean
  /** Windows only: is WSL2 available? Undefined elsewhere. */
  wsl2?: boolean
  /**
   * Windows only: the sandbox runs *inside* WSL2, so `path` is a WSL path and
   * commands go through `wsl -e` (see runSandboxedWsl). Undefined elsewhere.
   */
  viaWsl?: boolean
  /** A short note on why it's unavailable / not installable, for the UI. */
  reason?: string
}

/**
 * Find ai-jail and gather the prerequisites for this platform. Never throws.
 */
export async function detectAiJail(exec: Exec = defaultExec): Promise<JailStatus> {
  const platform = process.platform
  const base: JailStatus = { available: false, version: null, path: null, platform, installable: platform !== 'win32' }

  // Native lookup — Linux/macOS only. On Windows ai-jail lives inside WSL, not
  // on the native PATH, so the WSL branch below does the finding instead.
  if (platform !== 'win32') {
    for (const cand of candidatePaths()) {
      // Skip absolute candidates that don't exist, so we don't spawn for nothing.
      if (cand.includes('/') && !existsSync(cand)) continue
      try {
        const { code, stdout } = await exec(cand, ['--version'])
        if (code === 0) {
          base.available = true
          base.version = parseVersion(stdout)
          base.path = cand
          break
        }
      } catch {
        /* try the next candidate */
      }
    }
  }

  if (platform === 'linux') {
    base.bubblewrap = await which(exec, 'bwrap')
    if (base.available && !base.bubblewrap) {
      base.reason = 'ai-jail está instalado, mas o bubblewrap (bwrap) não — instale-o pelo gerenciador de pacotes.'
    } else if (base.available && base.bubblewrap && base.path) {
      // Both are present, but that doesn't prove the sandbox can start — Ubuntu
      // 23.10+ restricts the user namespaces bwrap needs. Actually run something
      // through it; a namespace failure flips `available` off so the run handler
      // refuses rather than running a command it can't confine.
      const smoke = await sandboxSmokeTest(exec, base.path)
      if (!smoke.ok) {
        base.available = false
        base.reason = smoke.reason
      }
    }
  } else if (platform === 'win32') {
    base.wsl2 = await hasWsl2(exec)
    if (!base.wsl2) {
      base.reason = 'O ai-jail só roda dentro do WSL2 no Windows. Instale o WSL2 (precisa de admin e reinício).'
    } else {
      // Find ai-jail INSIDE the default WSL distro, in a login shell so
      // ~/.local/bin is on PATH. `command -v` prints its absolute path, which we
      // keep to run it directly later (wsl -e <abs-path>), PATH-independent.
      try {
        const r = await exec('wsl', ['-e', 'bash', '-lc', 'command -v ai-jail && ai-jail --version'])
        const wslPath = r.stdout
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('/'))
        if (r.code === 0 && wslPath) {
          base.available = true
          base.viaWsl = true
          base.path = wslPath
          base.version = parseVersion(r.stdout)
        }
      } catch {
        /* not installed in WSL */
      }
      if (base.available) {
        try {
          const b = await exec('wsl', ['-e', 'bash', '-lc', 'command -v bwrap'])
          base.bubblewrap = b.code === 0
        } catch {
          base.bubblewrap = false
        }
        if (!base.bubblewrap) {
          base.reason = 'ai-jail está no WSL, mas falta o bubblewrap — no WSL rode: sudo apt install bubblewrap.'
        }
      } else {
        base.reason = 'WSL2 encontrado, mas o ai-jail precisa ser instalado dentro dele.'
      }
    }
  }
  return base
}

/** Whether `bin` resolves on PATH (via `command -v`), best-effort. */
async function which(exec: Exec, bin: string): Promise<boolean> {
  try {
    const { code } = await exec('/bin/sh', ['-c', `command -v ${bin}`])
    return code === 0
  } catch {
    return false
  }
}

/** Whether WSL2 is present (`wsl -l -v` lists at least one v2 distro). */
async function hasWsl2(exec: Exec): Promise<boolean> {
  try {
    const { code, stdout } = await exec('wsl', ['-l', '-v'])
    // wsl.exe emits UTF-16; the injected/default exec decodes as utf8, so match
    // loosely on the version column rather than exact text.
    return code === 0 && /\b2\b/.test(stdout)
  } catch {
    return false
  }
}

/** Progress of an install, 0..1 when known (null while indeterminate). */
export type InstallProgress = (p: { phase: string; fraction: number | null }) => void

export interface InstallResult {
  success: boolean
  version?: string
  path?: string
  error?: string
}

/** IO the installer needs, injected so the orchestration is testable. */
export interface InstallDeps {
  exec: Exec
  /** Download a URL to `dest`, reporting byte progress; returns bytes written. */
  download: (url: string, dest: string, onBytes: (received: number, total: number | null) => void) => Promise<number>
  /** Fetch a small text file (the .sha256 sidecar). */
  fetchText: (url: string) => Promise<string>
}

/**
 * Install ai-jail for the current platform.
 *
 * - **macOS**: Homebrew first (`brew tap akitaonrails/tap && brew install
 *   ai-jail`), the upstream-recommended path; if brew is missing, the aarch64
 *   tarball (Intel Macs have no binary and must use brew).
 * - **Linux**: the x86_64 tarball, sha256-verified, into `~/.local/bin`.
 * - **Windows**: not installable here — ai-jail needs WSL2. Returns an error
 *   asking the user to install WSL2 first (the onboarding offers the command).
 *
 * The download is checksum-verified before anything is placed on PATH — this
 * puts an executable in a directory the shell runs from, so an unverified byte
 * stream is not acceptable.
 */
export async function installAiJail(deps: InstallDeps, onProgress: InstallProgress): Promise<InstallResult> {
  const platform = process.platform
  if (platform === 'win32') {
    return { success: false, error: 'No Windows o ai-jail roda dentro do WSL2 — instale o WSL2 primeiro.' }
  }

  // macOS: prefer Homebrew.
  if (platform === 'darwin' && (await which(deps.exec, 'brew'))) {
    onProgress({ phase: 'Instalando via Homebrew…', fraction: null })
    const tap = await deps.exec('/bin/sh', ['-c', 'brew tap akitaonrails/tap && brew install ai-jail'])
    if (tap.code !== 0) {
      // Fall through to the binary path rather than giving up on brew's failure.
      onProgress({ phase: 'Homebrew falhou; tentando o binário…', fraction: null })
    } else {
      return verify(deps.exec)
    }
  }

  const asset = assetFor(platform, process.arch)
  if (!asset) {
    return {
      success: false,
      error:
        platform === 'darwin'
          ? 'Sem binário para Mac Intel — instale o Homebrew e tente de novo (brew install akitaonrails/tap/ai-jail).'
          : `Sem binário para ${platform}/${process.arch}.`
    }
  }

  try {
    onProgress({ phase: 'Verificando checksum…', fraction: null })
    const expected = parseSha256(await deps.fetchText(asset.shaUrl))
    if (!expected) return { success: false, error: 'Não foi possível ler o checksum da release.' }

    const tarball = join(tmpdir(), asset.file)
    onProgress({ phase: 'Baixando ai-jail…', fraction: 0 })
    await deps.download(asset.url, tarball, (received, total) =>
      onProgress({ phase: 'Baixando ai-jail…', fraction: total ? received / total : null })
    )

    onProgress({ phase: 'Conferindo integridade…', fraction: null })
    const actual = createHash('sha256').update(await readFileBuffer(tarball)).digest('hex')
    if (actual !== expected) {
      return { success: false, error: 'Checksum não confere — download corrompido ou adulterado. Nada foi instalado.' }
    }

    onProgress({ phase: 'Extraindo…', fraction: null })
    const extractDir = join(tmpdir(), `ai-jail-${Date.now()}`)
    mkdirSync(extractDir, { recursive: true })
    // system `tar` exists on Linux/macOS (the only platforms that reach here).
    const un = await deps.exec('tar', ['-xzf', tarball, '-C', extractDir])
    if (un.code !== 0) return { success: false, error: `Falha ao extrair: ${un.stderr || 'tar'}` }

    const bin = findBinary(extractDir, 'ai-jail')
    if (!bin) return { success: false, error: 'Binário ai-jail não encontrado no pacote.' }

    onProgress({ phase: 'Instalando em ~/.local/bin…', fraction: null })
    mkdirSync(localBinDir(), { recursive: true })
    const dest = join(localBinDir(), 'ai-jail')
    copyFileSync(bin, dest)
    chmodSync(dest, 0o755)

    return verify(deps.exec, dest)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Falha na instalação' }
  }
}

/** Confirm the install by running `--version`, reporting the path that worked. */
async function verify(exec: Exec, preferred?: string): Promise<InstallResult> {
  const cands = preferred ? [preferred, ...candidatePaths()] : candidatePaths()
  for (const p of cands) {
    if (p.includes('/') && !existsSync(p)) continue
    try {
      const { code, stdout } = await exec(p, ['--version'])
      if (code === 0) return { success: true, version: parseVersion(stdout) ?? undefined, path: p }
    } catch {
      /* next */
    }
  }
  return { success: false, error: 'Instalado, mas "ai-jail --version" não respondeu. Verifique se ~/.local/bin está no PATH.' }
}

/** First file named `name` (recursively) under `dir`, or null. */
function findBinary(dir: string, name: string): string | null {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop() as string
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === name && statSync(full).isFile()) return full
    }
  }
  return null
}

/** Read a file into a Buffer (kept async-friendly for the hash step). */
async function readFileBuffer(path: string): Promise<Buffer> {
  const { readFile } = await import('fs/promises')
  return readFile(path)
}

/**
 * The WSL2 install command shown/offered on Windows. Not run silently: it needs
 * administrator rights and a reboot, so the UI surfaces it for the user to run.
 */
export const WSL_INSTALL_COMMAND = 'wsl --install'

/**
 * Commands to install ai-jail INSIDE an already-set-up WSL2 distro (Ubuntu).
 * Shown in onboarding once WSL2 exists but ai-jail doesn't — the sudo/apt steps
 * are interactive, so the user runs them in the WSL terminal themselves.
 */
export const WSL_AI_JAIL_INSTALL_COMMANDS = [
  'sudo apt update && sudo apt install -y bubblewrap',
  `curl -L ${AI_JAIL_REPO}/releases/download/${AI_JAIL_VERSION}/ai-jail-linux-x86_64.tar.gz | tar xz`,
  'mkdir -p ~/.local/bin && mv ai-jail ~/.local/bin/ && ai-jail --version'
].join('\n')
