import { accessSync, constants, existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, relative, resolve } from 'path'

export type HarnessId = 'codex' | 'claude-code' | 'opencode'
export type HarnessAvailability = 'available' | 'unavailable' | 'unknown'

export interface HarnessCapabilities {
  interactiveTerminal: HarnessAvailability
  createSession: HarnessAvailability
  resumeSession: HarnessAvailability
  modelSelection: HarnessAvailability
  modelStatus: HarnessAvailability
  permissionPrompts: HarnessAvailability
  cancellation: HarnessAvailability
  mcp: HarnessAvailability
  localInstructionDiscovery: HarnessAvailability
}

export interface HarnessStatus {
  id: HarnessId
  label: string
  command: string
  installed: boolean
  path: string | null
  version: string | null
  authentication: 'authenticated' | 'unauthenticated' | 'unknown'
  /** An empty list is not an invented list: none of these CLIs has one stable safe probe. */
  models: string[]
  capabilities: HarnessCapabilities
}

export interface HarnessLaunch {
  label: string
  args: string[]
}

/** Metadata only: never read or surface instruction/skill bodies to the UI. */
export interface HarnessLocalContext {
  instructions: string[]
  skills: string[]
}

/**
 * Finds conventional local guidance inside the worktree, bounded to names and
 * paths. The CLI still owns interpretation; this only gives it an explicit,
 * secret-free pointer and lets the UI report what was actually present.
 */
export function discoverHarnessLocalContext(worktree: string): HarnessLocalContext {
  const root = resolve(worktree)
  const inside = (path: string): boolean => {
    const rel = relative(root, path)
    return rel !== '' && !rel.startsWith('..') && !rel.includes('..\\') && !rel.includes('../')
  }
  const instructions = ['AGENTS.md', 'CLAUDE.md'].flatMap((name) => {
    const path = join(root, name)
    return existsSync(path) && statSync(path).isFile() && inside(path) ? [name] : []
  })
  const skills: string[] = []
  for (const folder of ['.agents/skills', '.claude/skills', '.opencode/skills']) {
    const base = join(root, folder)
    if (!existsSync(base) || !statSync(base).isDirectory() || !inside(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true }).slice(0, 50)) {
      if (!entry.isDirectory()) continue
      const skill = join(base, entry.name, 'SKILL.md')
      if (existsSync(skill) && statSync(skill).isFile() && inside(skill))
        skills.push(relative(root, skill))
    }
  }
  return { instructions, skills }
}

interface HarnessDefinition {
  id: HarnessId
  label: string
  command: string
  capabilities: HarnessCapabilities
  authenticationCommand?: string[]
  launch(task: string, cwd: string): HarnessLaunch
}

const terminalCapabilities: HarnessCapabilities = {
  interactiveTerminal: 'available',
  createSession: 'available',
  resumeSession: 'unknown',
  // Model flags exist in some versions, but there is no version-independent
  // safe query for a list or current model. The UI must not fabricate either.
  modelSelection: 'unknown',
  modelStatus: 'unknown',
  permissionPrompts: 'available',
  cancellation: 'available',
  mcp: 'available',
  localInstructionDiscovery: 'unknown'
}

const definitions: readonly HarnessDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    capabilities: terminalCapabilities,
    authenticationCommand: ['login', 'status'],
    launch: (task, cwd) => ({
      label: 'Codex',
      args: [
        '--cd',
        cwd,
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'on-request',
        ...(task ? [task] : [])
      ]
    })
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    capabilities: terminalCapabilities,
    launch: (task) => ({ label: 'Claude Code', args: ['--permission-mode', 'manual', ...(task ? [task] : [])] })
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    capabilities: terminalCapabilities,
    // OpenCode uses the worktree as cwd. Its documented --prompt flag preserves
    // the normal TUI instead of pretending its batch mode is an interactive one.
    launch: (task) => ({ label: 'OpenCode', args: task ? ['--prompt', task] : [] })
  }
]

export function harnessDefinition(id: HarnessId): HarnessDefinition {
  const definition = definitions.find((item) => item.id === id)
  if (!definition) throw new Error(`Harness desconhecido: ${id}`)
  return definition
}

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && definitions.some((item) => item.id === value)
}

export function fallbackBinDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.SAGYOU_DISABLE_BIN_FALLBACK) return []
  const home = homedir()
  const dirs = [
    env.NVM_BIN,
    join(home, '.npm-global/bin'),
    join(home, '.local/bin'),
    join(home, '.local/share/npm/bin'),
    join(home, '.volta/bin'),
    join(home, '.bun/bin')
  ]
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  return dirs.filter((dir): dir is string => Boolean(dir))
}

/** Resolves only known harness binaries; callers never pass a renderer command. */
export function resolveHarnessExecutable(
  command: string,
  extraDirs: string[] = fallbackBinDirs(),
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform
): string | null {
  const windows = platform === 'win32'
  const extensions = windows ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathDirs = (env.PATH || '').split(windows ? ';' : ':')
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue
    for (const extension of extensions) {
      const full = join(dir, command + extension)
      if (!existsSync(full)) continue
      if (windows) return full
      try {
        accessSync(full, constants.X_OK)
        return full
      } catch {
        // An existing but non-executable file is not an installed CLI.
      }
    }
  }
  return null
}

export type HarnessCommand = (
  command: string,
  args: string[]
) => Promise<{ code: number; stdout: string; stderr: string }>

export async function discoverHarnesses(
  runCommand: HarnessCommand,
  resolveExecutable: (command: string) => string | null = resolveHarnessExecutable
): Promise<HarnessStatus[]> {
  return Promise.all(
    definitions.map(async (definition) => {
      const path = resolveExecutable(definition.command)
      if (!path) {
        return {
          id: definition.id,
          label: definition.label,
          command: definition.command,
          installed: false,
          path: null,
          version: null,
          authentication: 'unknown',
          models: [],
          capabilities: unavailableCapabilities()
        }
      }
      const version = await runCommand(path, ['--version'])
      const authentication = definition.authenticationCommand
        ? await runCommand(path, definition.authenticationCommand)
        : null
      const output = (version.stdout || version.stderr).trim().replace(/\s+/g, ' ')
      return {
        id: definition.id,
        label: definition.label,
        command: definition.command,
        installed: true,
        path,
        version: output ? output.slice(0, 120) : null,
        authentication:
          authentication === null
            ? 'unknown'
            : authentication.code === 0
              ? 'authenticated'
              : 'unauthenticated',
        models: [],
        capabilities: { ...definition.capabilities }
      }
    })
  )
}

export function buildHarnessLaunch(harness: HarnessId, task: string, cwd: string): HarnessLaunch {
  return harnessDefinition(harness).launch(task, cwd)
}

function unavailableCapabilities(): HarnessCapabilities {
  return {
    interactiveTerminal: 'unavailable',
    createSession: 'unavailable',
    resumeSession: 'unavailable',
    modelSelection: 'unavailable',
    modelStatus: 'unavailable',
    permissionPrompts: 'unavailable',
    cancellation: 'unavailable',
    mcp: 'unavailable',
    localInstructionDiscovery: 'unavailable'
  }
}
