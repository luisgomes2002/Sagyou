process.env.LANG = 'pt_BR.UTF-8'
process.env.LC_ALL = 'pt_BR.UTF-8'
process.env.LC_TIME = 'pt_BR.UTF-8'
process.env.LANGUAGE = 'pt_BR:pt'

import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  type IpcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join, relative, resolve, sep } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  renameSync,
  chmodSync,
  statSync,
  accessSync,
  constants
} from 'fs'
import * as codeFileFs from 'fs'
import { homedir } from 'os'
import { exec as execCallback, execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
const execAsync = promisify(execCallback)
const execFileAsync = promisify(execFile)
import { randomBytes, randomUUID } from 'crypto'
import { partitionConversations, referencedConversationIds } from './conversation-retention'
import type { StoredConversation } from './conversation-types'
import { CodeRunCoordinator } from './code-run-coordinator'
import { McpWriteQueue, RendererMcpActionBridge } from './mcp-write-queue'
import { AgentSessionRegistry } from './agent-session'
import { AgentWorktreeManager } from './agent-worktree'
import {
  isAgentTerminalInput,
  isAgentTerminalSize,
  startAgentPty,
  type AgentPty
} from './agent-pty'
import { collectAgentPatch, agentPatchPreview, validatePatchScope } from './agent-diff'
import { deliverApprovedPatch } from './agent-delivery'
import { CODE_EXECUTOR_MCP_PERMISSIONS, prepareAgentMcpSession } from './agent-mcp-session'
import { buildExternalAgentBrief, scrubExternalBriefSecrets } from './agent-briefing'
import { buildTerminalHandoff } from './terminal-handoff'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import OpenAI from 'openai'
import type { ChatGPTClient } from '@siwc/local'
import {
  loadData,
  saveData,
  eventsForEntity,
  rebuildSearchIndex,
  searchGlobalIndex,
  getGlobalSearchIndexHit,
  syncGlobalSearchConversations
} from './store'
import * as memoryStore from './store'
import { listMemories } from './store'
import * as memoryRules from './memory'
import { registerMemoryHandlers } from './handlers/memory'
import {
  appendEntry,
  newEntry,
  type TokenUsage,
  type UsageLogEntry
} from './usage'
import {
  appendRunMetric,
  newRunMetric,
  summarizeRunMetrics,
  type RunMetric,
  type RunMetricInput
} from './run-metrics'
import {
  getOpenAIClient,
  requestOptions,
  resolveTimeoutMs,
  type ApiProvider
} from './openai-client'
import { confineToRoot } from './code-files'
import * as codeFiles from './code-files'
import {
  briefConversationsForTask,
  briefCurrentConversation,
  searchConversations
} from './conversation-search'
import { fetchWeb } from './web-fetch'
import { renderWeb } from './web-render'
import { getExchangeRate } from './financial-exchange'
import { startSagyouMcpBroker } from './sagyou-mcp'
import { captureBase, diffSince, type AgentBase, type DiffLineItem } from './code-diff'
import { isImageFileName } from './chat-images'
import { safeAttachmentName } from './backup-files'
import {
  diffFileCount,
  isRunId,
  normalizeRuns,
  sortRuns,
  pruneRuns,
  runsForConv,
  taskLabel,
  type AgentRunMeta,
  type AgentRunSnapshot
} from './agent-runs'
import {
  listSkills,
  saveSkill,
  deleteSkill,
  importSkill as importSkillDialog,
  skillsDir
} from './skills'
import { createManagedWindow, registerWindowHandlers, type ManagedWindow } from './handlers/window'
import { registerFilesHandlers } from './handlers/files'
import { registerBackupHandlers } from './handlers/backup'
import { registerCodeFilesHandlers } from './handlers/code-files'
import { registerConversationHandlers } from './handlers/conversations'
import {
  createPasswordConfig,
  parsePasswordConfig,
  verifyPassword,
  type PasswordConfig
} from './security'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let managedWindow: ManagedWindow | null = null

/** Only the app's own renderer may invoke privileged IPC handlers. */
function assertTrustedRenderer(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const expected = mainWindow?.webContents
  const sameDocument =
    typeof event.sender.getURL === 'function' &&
    typeof expected?.getURL === 'function' &&
    event.sender.getURL() === expected.getURL()
  if (!expected || (event.sender !== expected && !sameDocument)) {
    throw new Error('Solicitação IPC recusada.')
  }
}

/** All user data stays unavailable until the password screen unlocks the app. */
function assertUnlockedDataAccess(event: IpcMainInvokeEvent | IpcMainEvent): void {
  assertTrustedRenderer(event)
  if (!passwordUnlocked) throw new Error('Desbloqueie o Sagyou para acessar os dados.')
}

/**
 * From this point onward every registered handler receives the same origin and
 * unlock checks. Keeping the guard at registration avoids a missed check when
 * a new data handler is added in a domain-specific module.
 */
function protectDataIpc(ipc: IpcMain): void {
  const registerHandle = ipc.handle.bind(ipc)
  const registerOn = ipc.on.bind(ipc)
  ipc.handle = ((
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown
  ) =>
    registerHandle(channel, (event, ...args) => {
      assertUnlockedDataAccess(event)
      return listener(event, ...(args as never[]))
    })) as IpcMain['handle']
  ipc.on = ((channel: string, listener: (event: IpcMainEvent, ...args: never[]) => unknown) =>
    registerOn(channel, (event, ...args) => {
      assertUnlockedDataAccess(event)
      return listener(event, ...(args as never[]))
    })) as IpcMain['on']
}
const sagyouMcp = startSagyouMcpBroker({
  readScopedData: (domain, session) => {
    const data = loadData()
    if (domain === 'tasks')
      return session.projectId
        ? data.tasks.filter((item) => item.projectId === session.projectId)
        : []
    if (domain === 'project')
      return session.projectId ? data.projects.filter((item) => item.id === session.projectId) : []
    if (domain === 'notes')
      return session.projectId
        ? data.notes.filter((item) => item.projectId === session.projectId)
        : []
    if (domain === 'goals')
      return session.projectId
        ? data.goals.filter((item) => item.projectId === session.projectId)
        : []
    return data.lists
      .filter((list) => list.profileId === session.financialProfileId)
      .flatMap((list) =>
        list.transactions.map((transaction) => ({
          ...transaction,
          listId: list.id,
          listName: list.name,
          currency: list.currency
        }))
      )
  },
  readTasks: (projectId) => {
    if (!projectId) return []
    const data = loadData()
    return data.tasks
      .filter((task) => task.projectId === projectId)
      .map(({ id, title, description, priority, dueDate, projectId: taskProjectId, columnId }) => ({
        id,
        title,
        description,
        priority,
        dueDate,
        projectId: taskProjectId,
        columnId
      }))
  },
  readFinancial: (profileId) => {
    const data = loadData()
    return data.lists
      .filter((list) => list.profileId === profileId)
      .map(({ id, name, currency, transactions }) => ({ id, name, currency, transactions }))
  },
  readProjectData: (projectId) => {
    if (!projectId) return { metas: [], notas: [] }
    const data = loadData()
    return {
      metas: data.goals.filter((goal) => goal.projectId === projectId),
      notas: data.notes.filter((note) => note.projectId === projectId)
    }
  },
  // FTS stays in the main process. The broker supplies the capability's
  // project id, so an executor cannot widen this to another project's memory.
  searchMemory: (projectId, term) => memoryStore.searchMemories({ projectId, term, limit: 8 }),
  readMemory: (id) => memoryStore.getMemory(id),
  // Keep the existing once-per-hour decay accounting in the store; the broker
  // decides authorization first, so rejected probes never count as a read.
  touchMemory: (id) => memoryStore.touchMemories([id], new Date().toISOString()),
  // Context already limits this to active project + global memories. The pure
  // conflict check below never writes, touches, archives or resolves anything.
  memoriesForConflict: (projectId) => memoryStore.memoriesForContext(projectId),
  searchConversations: (projectId, term) => {
    const scoped = loadConversations().filter((conversation) =>
      projectId === null ? conversation.projectId == null : conversation.projectId === projectId
    )
    return searchConversations(scoped, term)
  },
  readConversation: (id) =>
    loadConversations().find((conversation) => conversation.id === id) ?? null,
  saveMemory: async (session, memory, redacted) => {
    const outcome = await mcpWriteQueue.enqueue(
      {
        runId: session.runId,
        name: 'save_memory',
        args: { tipo: memory.type, titulo: memory.title, corpo: memory.body, tags: memory.tags }
      },
      async () => {
        // Memory is main-owned SQLite data; upsert completes before the reply.
        memoryStore.upsertMemory(memory)
        return { ok: true, id: memory.id, ...(redacted ? { redacted: true } : {}) }
      }
    )
    return outcome.approved
      ? outcome.value!
      : { ok: false, error: 'Salvamento não aprovado pelo usuário.' }
  },
  createTask: async (session, args) => {
    const title = typeof args.titulo === 'string' ? args.titulo.trim().slice(0, 300) : ''
    if (!title) throw new Error('titulo é obrigatório.')
    const data = loadData()
    const project = data.projects.find((item) => item.id === session.projectId)
    const column = project?.columns[0]
    if (!project || !column)
      throw new Error('O projeto autorizado não possui uma coluna para a task.')
    const outcome = await mcpWriteQueue.enqueue(
      { runId: session.runId, name: 'criar_task', args: { titulo: title } },
      async () => {
        const id = await requestRendererMcpTask({
          projectId: project.id,
          columnId: column.id,
          title,
          ...(typeof args.descricao === 'string' && args.descricao.trim()
            ? { description: args.descricao.trim().slice(0, 5000) }
            : {})
        })
        return { ok: true, id, titulo: title }
      }
    )
    return outcome.approved
      ? outcome.value!
      : { ok: false, error: 'Criação não aprovada pelo usuário.' }
  }
})

/**
 * The live state of one code-agent run.
 *
 * Before N-agent support this was a set of module-level singletons — one run
 * at a time. Now the app can host multiple concurrent runs in different
 * directories, each with its own log, base, approval queue, and usage counter.
 */
interface ReadOnlyRoot {
  id: string
  nome: string
  path: string
}

interface CodeRunState {
  id: string
  dir: string
  convId: string | null
  /** Immutable application scope captured when the terminal was created. */
  projectId: string | null
  financialProfileId: string
  codeRoot: string
  /** The real model name this run is using, shown by the panel and picker. */
  agent: string
  task: string
  startedAt: number
  /** Set by stopCodeAgent; the loop checks this between steps. */
  abort: boolean
  /** Buffered output, kept so a remounted panel can catch up. */
  log: string
  /** What the tree looked like before the agent touched it. */
  base: AgentBase | null
  /** A recognised environment failure, surfaced to the panel's hint card. */
  hint: AgentHint | null
  model: string
  /** Tokens accumulated across this run's model calls. */
  usage: TokenUsage
  step: number
  maxSteps: number
  /** Approvals the loop is waiting on, keyed by request id. */
  pendingApprovals: Map<string, PendingCodeApproval>
  /** Questions the loop is waiting on, keyed by request id. */
  pendingQuestions: Map<string, PendingCodeQuestion>
  /** Whether auto-approval mode is on for this run. */
  autoApprove: boolean
  /** Se não-null, o agente roda num git worktree isolado em vez do dir original. */
  worktreeDir: string | null
  /** The isolated run finished, but its patch could not be applied to the original tree. */
  worktreeMergeError: string | null
  /** Child process of an external harness, so Stop can terminate it immediately. */
  /** Exact relative paths this run may write; absent means the project root. */
  allowedWritePaths?: string[]
  /** Read-only references selected for this run; never a write or shell root. */
  readOnlyRoots: ReadOnlyRoot[]
  externalChild: AgentPty | null
  /** A real TTY session accepts user input until the user asks to review its diff. */
  interactive: boolean
  /** User ended an interactive TTY and asked to prepare the worktree diff. */
  finishing: boolean
  /** Last PTY grid reported by xterm; restored when a view reconnects. */
  terminalCols: number
  terminalRows: number
}

interface AgentHint {
  title: string
  detail: string
  command?: string
}

interface CodeApprovalRequest {
  runId: string
  id: string
  name: string
  args: Record<string, unknown>
  resumo: string
  conteudo?: string
  comando?: string
  diff?: DiffLineItem[]
  diffTruncated?: boolean
  irreversivel?: boolean
}

interface PendingCodeApproval {
  resolve: (approved: boolean) => void
  request: CodeApprovalRequest
}

interface CodeQuestionRequest {
  runId: string
  id: string
  question: string
}

interface PendingCodeQuestion {
  resolve: (answer: string | null) => void
  request: CodeQuestionRequest
}

/** Shared executor infrastructure; the native loop is only one temporary caller. */
const codeSessions = new AgentSessionRegistry<CodeRunState>()
const codeRuns = codeSessions.runs
const worktreeManager = new AgentWorktreeManager(codeSessions)

const codeRunCoordinator = new CodeRunCoordinator()

interface McpTaskRequest {
  projectId: string
  columnId: string
  title: string
  description?: string
}

/**
 * The renderer owns Zustand persistence. Keeping MCP mutations on that path
 * prevents a stale renderer autosave from overwriting a task written directly
 * by the main process.
 */
const rendererMcpTasks = new RendererMcpActionBridge<McpTaskRequest, string>(
  ({ requestId, payload }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('A janela do Sagyou precisa estar aberta para criar a task.')
    mainWindow.webContents.send('store:mcp:create-task', { requestId, task: payload })
  }
)

function requestRendererMcpTask(task: McpTaskRequest): Promise<string> {
  return rendererMcpTasks.request(task)
}

/** Routes MCP writes through the exact same approval UI as code-agent actions. */
function requestMcpWriteApproval(
  runId: string,
  name: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const run = codeRuns.get(runId)
  if (!run || run.abort) return Promise.resolve(false)
  return new Promise((resolveApproval) => {
    const id = randomUUID()
    const request: CodeApprovalRequest = {
      runId,
      id,
      name: `mcp:${name}`,
      args,
      resumo: `MCP Sagyou: ${name.replace('_', ' ')}`
    }
    const timeout = setTimeout(() => {
      if (!run.pendingApprovals.delete(id)) return
      resolveApproval(false)
    }, 30_000)
    run.pendingApprovals.set(id, {
      resolve: (approved) => {
        clearTimeout(timeout)
        resolveApproval(approved)
      },
      request
    })
    mainWindow?.webContents.send('ai:code-agent:approve-request', request)
  })
}

const mcpWriteQueue = new McpWriteQueue((request) =>
  requestMcpWriteApproval(request.runId, request.name, request.args)
)

const MAX_AGENT_LOG = 8000
let lastRunLog = ''
let lastRunHint: AgentHint | null = null
let lastRunModel: string | undefined
let lastRunProgress:
  | { step: number; maxSteps: number; promptTokens: number; completionTokens: number }
  | undefined

function appendAgentLog(runId: string, chunk: string): void {
  const run = codeRuns.get(runId)
  if (run) run.log = (run.log + chunk).slice(-MAX_AGENT_LOG)
}

/** The only route from an isolated worktree to the user's project. */
/** Stop one or all running agents: abort the loop and deny any parked approval. */
function stopCodeAgent(runId?: string): void {
  if (runId) {
    const run = codeRuns.get(runId)
    if (run) {
      run.abort = true
      run.externalChild?.kill('SIGTERM')
      mcpWriteQueue.rejectRun(run.id)
      for (const { resolve } of run.pendingApprovals.values()) resolve(false)
      run.pendingApprovals.clear()
      for (const { resolve } of run.pendingQuestions.values()) resolve(null)
      run.pendingQuestions.clear()
    }
  } else {
    for (const run of codeRuns.values()) {
      run.abort = true
      run.externalChild?.kill('SIGTERM')
      mcpWriteQueue.rejectRun(run.id)
      for (const { resolve } of run.pendingApprovals.values()) resolve(false)
      run.pendingApprovals.clear()
      for (const { resolve } of run.pendingQuestions.values()) resolve(null)
      run.pendingQuestions.clear()
    }
  }
}


/**
 * Directories to look in when the agent isn't on PATH — node version managers
 * and custom npm prefixes, which is where a global CLI installed without sudo
 * actually lands.
 *
 * ⚠️ These are a **fallback, never a first choice** — see `resolveExecutable`.
 */
export function fallbackBinDirs(): string[] {
  // ⚠️ The one opt-out, and it exists for a specific hazard. `handlers.test.ts`
  // proves the "not installed" path by emptying PATH — but the agent binary is
  // genuinely installed on a dev machine, and these dirs are exactly where it
  // lives (`~/.npm-global/bin` here, `/usr/local/bin` on a Mac). Without this
  // the test would spawn the real binary, which waits on stdin and never exits,
  // poisoning every test after it — the failure the PATH-replacement guard
  // exists to stop. Set only by tests; unset in the app, where the fallback is
  // the whole point.
  if (process.env.SAGYOU_DISABLE_BIN_FALLBACK) return []
  const home = homedir()
  const dirs = [
    process.env.NVM_BIN, // nvm's currently-active version
    join(home, '.npm-global/bin'), // the `npm config set prefix` convention
    join(home, '.local/bin'),
    join(home, '.local/share/npm/bin'),
    join(home, '.volta/bin'),
    join(home, '.bun/bin')
  ]
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  return dirs.filter((d): d is string => Boolean(d))
}

/**
 * Absolute path to `cmd`, or null if it can't be found.
 *
 * Two different failures, one fix:
 *   • **Windows** — spawn without a shell won't append .exe/.cmd, so
 *     `spawn('binary')` fails even when installed (npm installs a .cmd wrapper).
 *   • **POSIX** — spawn *does* resolve via PATH, but only the PATH this process
 *     was handed, and a GUI-launched Electron app doesn't get the user's shell
 *     PATH. Measured on Ubuntu 24.04 + GNOME/Wayland: apps started from the
 *     launcher inherit the systemd user manager's PATH, which has no
 *     `~/.npm-global/bin` — that lives in `~/.bashrc`, read only by interactive
 *     shells. So `binary --version` works in a terminal while the app reports it
 *     "não encontrado", which is a lie about the cause and sends the user off
 *     reinstalling something that is already there.
 *
 * ⚠️ **PATH is searched first and `extraDirs` only if that finds nothing.** The
 * order is load-bearing for the tests, not a preference: `handlers.test.ts`
 * *replaces* PATH with a dir holding only a stub, precisely so a real binary on
 * the dev machine can't be spawned (it waits on stdin and never exits, poisoning
 * every later test). A fallback dir consulted first — or consulted at all when
 * PATH already matched — would walk straight around that guard and find the real
 * binary. `extraDirs` is injectable for the same reason.
 *
 * Deliberately not `npm prefix -g`: it would be authoritative, but it costs a
 * subprocess on every run and needs npm on PATH — the very thing that is missing
 * in the case this exists to fix.
 */
export function resolveExecutable(
  cmd: string,
  extraDirs: string[] = fallbackBinDirs()
): string | null {
  const win = process.platform === 'win32'
  // '' last: on Windows a bare name (extensionless) is only a match if no
  // real wrapper exists; on POSIX it is the only form there is.
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathDirs = (process.env.PATH || '').split(win ? ';' : ':')
  const runnable = (full: string): boolean => {
    if (!existsSync(full)) return false
    // On POSIX, existing is not enough — a non-executable file of the right name
    // would be picked here and then fail at spawn with EACCES, which reports as
    // a different problem than the one it is.
    if (win) return true
    try {
      accessSync(full, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      if (runnable(full)) return full
    }
  }
  return null
}

type ExternalHarnessId = 'codex' | 'claude-code'

interface HarnessStatus {
  id: ExternalHarnessId
  label: string
  command: string
  installed: boolean
  path: string | null
  version: string | null
  /** Only reported when the CLI has a safe status command; never opens login. */
  authentication: 'authenticated' | 'unauthenticated' | 'unknown'
}

const EXTERNAL_HARNESSES: ReadonlyArray<Pick<HarnessStatus, 'id' | 'label' | 'command'>> = [
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'claude-code', label: 'Claude Code', command: 'claude' }
]

let harnessStatusCache: HarnessStatus[] | null = null

async function runHarnessCommand(
  command: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10_000 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof result.code === 'number' ? result.code : 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? ''
    }
  }
}

/**
 * Checks only the local executable and its version. This is intentionally
 * separate from launching a harness: detection must never start a task, touch
 * a project, or trigger an external provider login.
 */
async function getHarnessStatuses(refresh = false): Promise<HarnessStatus[]> {
  if (harnessStatusCache && !refresh) return harnessStatusCache
  harnessStatusCache = await Promise.all(
    EXTERNAL_HARNESSES.map(async ({ id, label, command }) => {
      const path = resolveExecutable(command)
      if (!path)
        return {
          id,
          label,
          command,
          installed: false,
          path: null,
          version: null,
          authentication: 'unknown' as const
        }
      const result = await runHarnessCommand(path, ['--version'])
      const output = (result.stdout || result.stderr).trim().replace(/\s+/g, ' ')
      // Codex documents `login status` as a non-interactive credential check.
      // The other CLIs do not expose a stable equivalent across their supported
      // login methods, so claiming either state there would be worse than unknown.
      const auth = id === 'codex' ? await runHarnessCommand(path, ['login', 'status']) : null
      return {
        id,
        label,
        command,
        installed: true,
        path,
        version: output ? output.slice(0, 120) : null,
        authentication:
          auth === null ? 'unknown' : auth.code === 0 ? 'authenticated' : 'unauthenticated'
      }
    })
  )
  return harnessStatusCache
}

interface ExternalHarnessLaunch {
  label: string
  args: string[]
}

/**
 * External CLIs run in an isolated worktree. Their flags either make extra
 * directories writable or differ by harness, so never hand them raw reference
 * paths. A bounded snapshot gives them real project context without expanding
 * their filesystem authority.
 */
async function readOnlyReferenceBrief(roots: ReadOnlyRoot[]): Promise<string> {
  const candidates = ['README.md', 'GUIDE.md', 'CLAUDE.md', 'package.json', 'manifest.json']
  const sections: string[] = []
  for (const root of roots) {
    const files: string[] = []
    for (const name of candidates) {
      const file = join(root.path, name)
      if (!existsSync(file) || !statSync(file).isFile()) continue
      try {
        const content = await readFile(file, 'utf-8')
        files.push('### ' + name + '\n' + content.slice(0, 4_000))
      } catch {
        /* unreadable references are simply omitted from the bounded briefing */
      }
    }
    sections.push(
      '## REFERÊNCIA SOMENTE DE LEITURA: ' +
        root.nome +
        '\n' +
        (files.join('\n\n') || 'Sem arquivos-base legíveis.')
    )
  }
  return sections.join('\n\n').slice(0, 18_000)
}

/**
 * An external harness gets no data snapshot. It must request current data from
 * the run-scoped MCP capability, where project/profile boundaries are enforced.
 * Passing `loadData()` here would silently bypass those boundaries in the prompt.
 */
function sagyouContextBrief(projectId: string | null | undefined): string {
  try {
    const project = projectId ? loadData().projects.find((item) => item.id === projectId) : null
    return project
      ? `## ESCOPO DO SAGYOU\nProjeto autorizado: ${project.name}. Consulte dados pelo MCP Sagyou.`
      : '## ESCOPO DO SAGYOU\nNenhum projeto foi autorizado. Consulte apenas o que o MCP Sagyou permitir.'
  } catch {
    return ''
  }
}

/** A persistent terminal uses the harness normal TUI in its isolated worktree. */
function buildTerminalHarnessLaunch(
  harness: ExternalHarnessId,
  task: string,
  cwd: string
): ExternalHarnessLaunch {
  if (harness === 'codex') {
    return {
      label: 'Codex',
      args: ['--cd', cwd, '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', task]
    }
  }
  return { label: 'Claude Code', args: ['--permission-mode', 'manual', task] }
}
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Named API connections make key/model switching explicit and reversible. */
  providerProfiles?: {
    id: string
    name: string
    kind: 'api'
    /** Missing on old profiles means a generic OpenAI-compatible endpoint. */
    provider?: ApiProvider
    baseUrl: string
    apiKey: string
    model: string
    /** Optional stronger model for analysis/code requests in this profile. */
    modelComplex?: string
  }[]
  activeProviderProfileId?: string
  /** Stops an intentionally deleted imported profile from being recreated. */
  legacyProfileMigrated?: boolean
  chatProvider?: 'api' | 'chatgpt'
  /** Preferred form of address for replies from the assistant. */
  userName?: string
  /**
   * Optional heavier model for code/analysis tasks. When set, runAgent routes a
   * message that looks like one (see routeModel in ../renderer/src/ai/agent) to
   * this model and leaves the cheaper `model` for everything else. Absent means
   * "one model for everything", the previous behaviour.
   */
  modelComplex?: string
  /** Optional cap on the agent's tool rounds; absent means the per-mode default. */
  maxSteps?: number
  /**
   * USD per 1M tokens, as charged by whatever provider is configured. There is
   * no sane default: the same app talks to OpenAI and to a free local model, so
   * a built-in price table would invent a number. Absent = show tokens only.
   */
  inputPricePer1M?: number
  outputPricePer1M?: number
  /**
   * How long to wait for the model to start responding, in ms. Absent = the
   * default in ./openai-client (the SDK's own 10min is effectively a hang).
   */
  timeoutMs?: number
  /**
   * The conversation the user last had open, reopened when they come back to
   * the AI view. UI state rather than provider config, but it lives here to
   * ride the ai:config plumbing instead of earning a file of its own.
   */
  lastConversationId?: string
  /** Historic native selections load as the Codex default. */
  codeHarness?: 'codex' | 'claude-code'
  /**
   * DeepSeek reasoning_effort parameter. Controls how much reasoning the model
   * does before answering. One of 'low', 'medium', 'high'. Applied to every
   * model call (chat and code agent) when set.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

const DEFAULT_AI_CONFIG: AIConfig = { baseUrl: '', apiKey: '', model: '' }

function publicAIConfig(config: AIConfig): Omit<AIConfig, 'apiKey' | 'providerProfiles'> & {
  providerProfiles?: Array<
    Omit<NonNullable<AIConfig['providerProfiles']>[number], 'apiKey'> & { hasApiKey: boolean }
  >
  hasApiKey: boolean
} {
  const { apiKey: _apiKey, providerProfiles, ...rest } = config
  return {
    ...rest,
    hasApiKey: Boolean(_apiKey),
    providerProfiles: providerProfiles?.map(({ apiKey, ...profile }) => ({
      ...profile,
      hasApiKey: Boolean(apiKey)
    }))
  }
}

/** Keep an existing credential when the renderer submits its intentionally blank value. */
function mergeAIConfigSecrets(next: AIConfig, previous: AIConfig): AIConfig {
  const previousProfiles = new Map((previous.providerProfiles ?? []).map((p) => [p.id, p]))
  const profiles = next.providerProfiles
  return {
    ...next,
    apiKey: next.apiKey || previous.apiKey,
    providerProfiles: profiles?.map((profile) => ({
      ...profile,
      apiKey: profile.apiKey || previousProfiles.get(profile.id)?.apiKey || ''
    }))
  }
}

/** Resolve the selected API connection entirely in main, where its key stays. */
function resolveChatConfig(
  cfg: AIConfig,
  profileId?: string
): {
  baseUrl: string
  apiKey: string
  model: string
  provider: ApiProvider
} {
  const active = cfg.providerProfiles?.find(
    (profile) => profile.id === (profileId ?? cfg.activeProviderProfileId)
  )
  if (profileId && !active) throw new Error('Perfil de API não encontrado')
  return active
    ? {
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        model: active.model,
        provider: active.provider ?? 'custom'
      }
    : { baseUrl: '', apiKey: '', model: '', provider: 'custom' }
}
const aiConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

let chatGPT: ChatGPTClient | null = null
let siwcModule: Promise<typeof import('@siwc/local')> | null = null

/**
 * electron-vite emits the main process as CommonJS while the official DevKit is
 * ESM-only. A native dynamic import must stay intact at runtime; TypeScript's
 * `import()` expression would otherwise be rewritten to `require()` here.
 */
function loadSiwc(): Promise<typeof import('@siwc/local')> {
  siwcModule ??= new Function('specifier', 'return import(specifier)')('@siwc/local') as Promise<
    typeof import('@siwc/local')
  >
  return siwcModule
}

/**
 * SIWC owns OAuth, PKCE, loopback and refresh. Electron's OS-backed crypto is
 * the only credential-encryption provider accepted here; never fall back to a
 * plaintext file when the platform keychain is unavailable.
 */
async function getChatGPT(): Promise<ChatGPTClient> {
  if (chatGPT) return chatGPT
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O armazenamento protegido do sistema não está disponível.')
  }
  const { createChatGPT } = await loadSiwc()
  chatGPT = createChatGPT({
    appName: 'Sagyou',
    appId: 'sagyou',
    redirectPort: 0,
    storageDir: join(app.getPath('userData'), 'chatgpt'),
    sendHostId: true,
    credentialEncryption: {
      id: 'electron-safe-storage-v1',
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plaintext) => safeStorage.encryptString(plaintext),
      decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext))
    },
    openBrowser: (url) => shell.openExternal(url)
  })
  return chatGPT
}

// Password protection is intentionally separate from the data and backup formats:
// importing a backup must never silently replace the credential that protects this machine.
const passwordConfigPath = (): string => join(app.getPath('userData'), 'password-security.json')
let passwordConfig: PasswordConfig | null = null
let passwordConfigCorrupt = false
let passwordUnlocked = false

function loadPasswordConfig(): { config: PasswordConfig | null; corrupt: boolean } {
  if (!existsSync(passwordConfigPath())) return { config: null, corrupt: false }
  try {
    return parsePasswordConfig(readFileSync(passwordConfigPath(), 'utf-8'))
  } catch {
    // A broken or unreadable config must never look like "no password".
    return { config: null, corrupt: true }
  }
}

function savePasswordConfig(config: PasswordConfig): void {
  writeFileSync(passwordConfigPath(), JSON.stringify(config), { mode: 0o600 })
  // Existing files retain their old mode unless explicitly corrected.
  chmodSync(passwordConfigPath(), 0o600)
}

function passwordStatus(): { enabled: boolean; corrupt: boolean; userName?: string } {
  const userName = loadAIConfig().userName?.trim()
  return {
    enabled: passwordConfig !== null || passwordConfigCorrupt,
    corrupt: passwordConfigCorrupt,
    userName: userName || undefined
  }
}

/**
 * The provider's HTTP status off an SDK error, when there was a response at all.
 * The renderer needs it to tell a transient failure (429/5xx — worth retrying)
 * from a permanent one (401/400 — retrying just delays the real message).
 * Undefined means the call never got a response: DNS, refused connection, etc.
 */
function errorStatus(e: unknown): number | undefined {
  const status = (e as { status?: unknown })?.status
  return typeof status === 'number' ? status : undefined
}

/** The provider's usage block, normalised. Absent when it didn't report one. */
function toUsage(
  raw:
    | {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_cache_hit_tokens?: number // DeepSeek
        prompt_tokens_details?: { cached_tokens?: number } // OpenAI
        completion_tokens_details?: { reasoning_tokens?: number } // DeepSeek reasoning
        reasoning_tokens?: number // some providers at top level
      }
    | undefined
    | null
): TokenUsage | undefined {
  if (!raw) return undefined
  const promptTokens = typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : 0
  const completionTokens = typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0
  if (promptTokens === 0 && completionTokens === 0) return undefined
  const cachedPromptTokens =
    typeof raw.prompt_cache_hit_tokens === 'number'
      ? raw.prompt_cache_hit_tokens
      : typeof raw.prompt_tokens_details?.cached_tokens === 'number'
        ? raw.prompt_tokens_details?.cached_tokens
        : undefined
  // DeepSeek returns reasoning tokens nested in completion_tokens_details;
  // some providers put them at top level. Either is fine.
  const reasoningTokens =
    typeof raw.completion_tokens_details?.reasoning_tokens === 'number'
      ? raw.completion_tokens_details.reasoning_tokens
      : typeof raw.reasoning_tokens === 'number'
        ? raw.reasoning_tokens
        : undefined
  return { promptTokens, completionTokens, cachedPromptTokens, reasoningTokens }
}

/** Expose old top-level API settings as an ordinary profile without discarding them. */
function withImportedAIProfile(config: AIConfig): AIConfig {
  const profiles = Array.isArray(config.providerProfiles) ? config.providerProfiles : []
  const hasOldConnection = Boolean(config.baseUrl?.trim() && config.model?.trim())
  const matching = profiles.find(
    (profile) =>
      profile.baseUrl === config.baseUrl &&
      profile.apiKey === config.apiKey &&
      profile.model === config.model &&
      profile.modelComplex === config.modelComplex
  )
  let imported: NonNullable<AIConfig['providerProfiles']>[number] | undefined
  if (hasOldConnection && !config.legacyProfileMigrated && !matching) {
    let id = 'legacy'
    while (profiles.some((profile) => profile.id === id)) id += '-original'
    imported = {
      id,
      name: 'Minha API',
      kind: 'api',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      modelComplex: config.modelComplex
    }
  }
  const nextProfiles = imported ? [...profiles, imported] : profiles
  const activeProviderProfileId = nextProfiles.some(
    (profile) => profile.id === config.activeProviderProfileId
  )
    ? config.activeProviderProfileId
    : (imported?.id ?? matching?.id ?? nextProfiles[0]?.id)
  return {
    ...config,
    legacyProfileMigrated: true,
    providerProfiles: nextProfiles,
    activeProviderProfileId
  }
}

function loadAIConfig(): AIConfig {
  try {
    return withImportedAIProfile({
      ...DEFAULT_AI_CONFIG,
      ...JSON.parse(readFileSync(aiConfigPath(), 'utf-8'))
    })
  } catch {
    return withImportedAIProfile({ ...DEFAULT_AI_CONFIG })
  }
}

function saveAIConfig(config: AIConfig): void {
  const merged = withImportedAIProfile(mergeAIConfigSecrets(config, loadAIConfig()))
  const userName =
    typeof merged.userName === 'string' ? merged.userName.trim().slice(0, 80) : undefined
  writeFileSync(
    aiConfigPath(),
    JSON.stringify(
      { ...merged, legacyProfileMigrated: true, userName: userName || undefined },
      null,
      2
    ),
    'utf-8'
  )
}

// --- AI usage log (persisted to ai-usage-log.json in userData) ---
//
// Written here rather than in the renderer because every model call funnels
// through this process: a log kept anywhere else could be bypassed by a caller
// that forgets to report. The rules live in ./usage (no Electron, so testable);
// this only does the file IO.

const aiUsagePath = (): string => join(app.getPath('userData'), 'ai-usage-log.json')

function loadUsageLog(): UsageLogEntry[] {
  try {
    const data = JSON.parse(readFileSync(aiUsagePath(), 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Record one billed call. Never throws: losing the log must not fail the chat. */
function appendUsage(model: string, usage: TokenUsage, cfg: AIConfig): void {
  try {
    const next = appendEntry(loadUsageLog(), newEntry(model, usage, cfg))
    writeFileSync(aiUsagePath(), JSON.stringify(next), 'utf-8')
  } catch {
    /* the log is bookkeeping; a failure here must not break the answer */
  }
}

// --- AI run metrics (persisted to ai-run-metrics.json in userData) ---
//
// Per-run efficiency, sent up by the renderer's agent loop (which is the only
// place that can count redundant searches and repeated reads). Rules live in
// ./run-metrics (no Electron, so testable); this only does the file IO.

const aiRunMetricsPath = (): string => join(app.getPath('userData'), 'ai-run-metrics.json')

function loadRunMetrics(): RunMetric[] {
  try {
    const data = JSON.parse(readFileSync(aiRunMetricsPath(), 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Record one finished run. Never throws: metrics are bookkeeping, not the answer. */
function appendRunMetricIO(input: RunMetricInput): void {
  try {
    const next = appendRunMetric(loadRunMetrics(), newRunMetric(input))
    writeFileSync(aiRunMetricsPath(), JSON.stringify(next), 'utf-8')
  } catch {
    /* losing a metric must not affect anything the user sees */
  }
}

// --- Chat images (files under userData/chat-images) ---

const chatImagesDir = (): string => join(app.getPath('userData'), 'chat-images')

// --- Chat documents (files under userData/chat-files) ---

const chatFilesDir = (): string => join(app.getPath('userData'), 'chat-files')

/** Resolve an image id to a path, or null if it isn't one of ours. */
function chatImagePath(id: unknown): string | null {
  if (!isImageFileName(id)) return null
  const full = join(chatImagesDir(), id)
  // The id arrives from the renderer; belt and braces on top of the name check.
  return full.startsWith(chatImagesDir() + sep) ? full : null
}

// --- Task images (files under userData/task-images, named <id><ext>) ---
//
// Same on-disk shape as file attachments (files/), so safeAttachmentName guards
// the id/ext. The bytes were moved off the DB (see migrateTaskImagesToDisk).

const taskImagesDir = (): string => join(app.getPath('userData'), 'task-images')

/** Resolve a task image's id+ext to a path inside task-images/, or null. */
function taskImagePath(id: unknown, ext: unknown): string | null {
  const name = safeAttachmentName(id, ext)
  if (!name) return null
  const full = join(taskImagesDir(), name)
  return full.startsWith(taskImagesDir() + sep) ? full : null
}

// --- Past agent runs (files under userData/agent-runs) ---
//
// See agent-runs.ts for why a run is a frozen snapshot and why the payload is
// out here rather than on the conversation.

const agentRunsDir = (): string => join(app.getPath('userData'), 'agent-runs')
const agentRunsIndexPath = (): string => join(agentRunsDir(), 'index.json')

/** Resolve a run id to its payload path, or null if it isn't one of ours. */
function agentRunPath(id: unknown): string | null {
  if (!isRunId(id)) return null
  const full = join(agentRunsDir(), `${id}.json`)
  // The id arrives from the renderer; belt and braces on top of the name check.
  return full.startsWith(agentRunsDir() + sep) ? full : null
}

function loadRunIndex(): AgentRunMeta[] {
  try {
    if (!existsSync(agentRunsIndexPath())) return []
    const raw = JSON.parse(readFileSync(agentRunsIndexPath(), 'utf-8'))
    const runs = normalizeRuns(raw)
    // Lazy prune: drop runs past their TTL and payload files, even when no new
    // run was just archived. Without this, old runs persist forever in the index
    // until someone happens to fire a new agent.
    const { keep, drop } = pruneRuns(runs)
    if (drop.length > 0) {
      saveRunIndex(keep)
      for (const gone of drop) {
        const p = agentRunPath(gone.id)
        if (p && existsSync(p)) {
          try {
            unlinkSync(p)
          } catch {
            /* best-effort */
          }
        }
      }
    }
    return keep
  } catch {
    return []
  }
}

function saveRunIndex(runs: AgentRunMeta[]): void {
  if (!existsSync(agentRunsDir())) mkdirSync(agentRunsDir(), { recursive: true })
  writeFileSync(agentRunsIndexPath(), JSON.stringify(runs), 'utf-8')
}

/**
 * Freeze a finished run: its log and the diff as computed right now.
 *
 * Called once, from the agent's exit path, because *now* is the only moment the
 * diff means "what the agent did" — every later edit the user makes would be
 * folded into it. Best-effort throughout: a run that can't be archived must
 * never break the run itself, which already did the work the user asked for.
 */
async function archiveAgentRun(runId: string, exitCode: number): Promise<AgentRunSnapshot | null> {
  const run = codeRuns.get(runId)
  if (!run) return null
  try {
    const diff = run.base ? await diffSince(run.base) : null
    const snapshot: AgentRunSnapshot = {
      id: run.id,
      convId: run.convId,
      agent: run.agent,
      dir: run.dir,
      allowedWritePaths: run.allowedWritePaths,
      readOnlyRoots: run.readOnlyRoots,
      task: run.task,
      startedAt: run.startedAt,
      endedAt: Date.now(),
      exitCode,
      ...(run.worktreeDir
        ? { delivery: run.worktreeMergeError ? ('merge_failed' as const) : ('applied' as const) }
        : {}),
      fileCount: diffFileCount(diff),
      // Frozen with the run so the picker can show what a past run cost.
      tokens: { ...run.usage },
      log: run.log,
      diff
    }
    const path = agentRunPath(run.id)
    if (!path) return null
    if (!existsSync(agentRunsDir())) mkdirSync(agentRunsDir(), { recursive: true })
    writeFileSync(path, JSON.stringify(snapshot), 'utf-8')

    // Index last, so a row never points at a payload that was never written.
    // Pruning deletes the dropped payloads too — forgetting a run in the index
    // without unlinking its file leaks that disk for good.
    const { log: _log, diff: _diff, ...meta } = snapshot
    const { keep, drop } = pruneRuns([meta, ...loadRunIndex().filter((r) => r.id !== meta.id)])
    saveRunIndex(keep)
    // Announced separately from 'exit', which fires before this: the archive
    // costs a `git diff`, and the panel must not stay on "rodando" waiting for
    // it. This is what tells the run picker its new row exists.
    mainWindow?.webContents.send('ai:code-agent:archived', {
      runId: run.id,
      id: meta.id,
      convId: run.convId
    })
    for (const gone of drop) {
      const p = agentRunPath(gone.id)
      if (p && existsSync(p)) {
        try {
          unlinkSync(p)
        } catch {
          /* a payload we can't delete is not worth failing the archive over */
        }
      }
    }
    return snapshot
  } catch {
    /* archiving is a convenience; the run itself already happened */
    return null
  }
  // Run state already cleaned from codeRuns in the finally block;
  // survivors (lastRunLog etc.) persist for status() backward compat.
}

/** Persist one bounded breadcrumb per project without copying a terminal log into memory. */
function persistTerminalHandoff(
  run: CodeRunState,
  exitCode: number,
  archived: AgentRunSnapshot | null
): void {
  try {
    const files = Array.isArray((archived?.diff as { files?: unknown } | undefined)?.files)
      ? ((archived?.diff as { files: { path?: unknown }[] }).files
          .map((file) => (typeof file.path === 'string' ? file.path : ''))
          .filter(Boolean) as string[])
      : []
    const status = run.abort
      ? 'cancelled'
      : run.worktreeMergeError
        ? 'not_applied'
        : exitCode === 0
          ? 'completed'
          : 'failed'
    const result =
      status === 'completed'
        ? 'Terminal concluído; consulte o diff arquivado para os detalhes.'
        : status === 'cancelled'
          ? 'Execução interrompida pelo usuário; consulte a run arquivada para os detalhes.'
          : status === 'not_applied'
            ? 'A execução terminou, mas as alterações não foram aplicadas; consulte a run arquivada.'
            : `Terminal terminou com código ${exitCode}; consulte a run arquivada para os detalhes.`
    memoryStore.upsertMemory(
      buildTerminalHandoff(
        {
          projectId: run.projectId,
          conversationId: run.convId,
          runId: run.id,
          request: run.task,
          status,
          result,
          changedFiles: files
        },
        new Date().toISOString()
      )
    )
  } catch {
    /* A continuity note must never turn a completed terminal run into a failure. */
  }
}

// --- Skills (.md files in userData/skills/) ---

const skillsPath = (): string => skillsDir(app.getPath('userData'))

// --- AI chat history (persisted to ai-conversations.json in userData) ---
const aiConversationsPath = (): string => join(app.getPath('userData'), 'ai-conversations.json')

function loadConversations(): StoredConversation[] {
  try {
    const data = JSON.parse(readFileSync(aiConversationsPath(), 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveConversations(list: StoredConversation[]): void {
  const path = aiConversationsPath()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(list), 'utf-8')
  renameSync(tmp, path)
  // The JSON file is authoritative; a failed derived update is repaired at next startup.
  try {
    syncGlobalSearchConversations(list)
  } catch (error) {
    console.error('[search] Conversation index update failed:', error)
  }
}

/**
 * Remove stale conversations, along with their chat-image files.
 *
 * Two rules, applied in order:
 * 1. Conversations last active more than 14 days ago are dropped.
 * 2. If more than MAX_CONVERSATIONS remain, the oldest ones are dropped.
 *
 * Any conversation cited by an active or archived memory is exempt from both
 * limits. That includes handoffs whose body points back to a full transcript.
 * Otherwise cleanup would silently destroy the evidence behind a memory.
 */
const PRUNE_CONVERSATION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_CONVERSATIONS = 50

function pruneConversations(): void {
  const all = loadConversations()
  if (all.length === 0) return
  const cutoff = new Date(Date.now() - PRUNE_CONVERSATION_TTL_MS)
  const referenced = referencedConversationIds(listMemories({ includeArchived: true }))
  const { keep, prune } = partitionConversations(all, referenced, cutoff, MAX_CONVERSATIONS)

  if (prune.length === 0) return

  // Collect image ids from pruned conversations that no kept conversation
  // still references — otherwise we'd delete a shared image.
  const keptImageIds = new Set(keep.flatMap((c) => c.messages.flatMap((m) => m.imageIds ?? [])))
  const prunedImageIds = prune.flatMap((c) => c.messages.flatMap((m) => m.imageIds ?? []))
  const orphanIds = [...new Set(prunedImageIds)].filter((id) => !keptImageIds.has(id))
  const toDelete = orphanIds.map((id) => chatImagePath(id)).filter((p): p is string => p !== null)

  for (const full of toDelete) {
    try {
      if (existsSync(full)) unlinkSync(full)
    } catch {
      /* already gone or locked — not worth failing over */
    }
  }

  // Same for chat document files.
  const keptDocIds = new Set(
    keep.flatMap((c) =>
      c.messages.flatMap((m) => (m as { documentIds?: string[] }).documentIds ?? [])
    )
  )
  const prunedDocIds = prune.flatMap((c) =>
    c.messages.flatMap((m) => (m as { documentIds?: string[] }).documentIds ?? [])
  )
  const orphanDocIds = [...new Set(prunedDocIds)].filter((id) => !keptDocIds.has(id))
  const docFilesDir = chatFilesDir()
  const toDeleteDocs = orphanDocIds
    .map((id) => {
      if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(id)) return null
      const full = join(docFilesDir, id)
      return full.startsWith(docFilesDir + sep) ? full : null
    })
    .filter((p): p is string => p !== null)

  for (const full of toDeleteDocs) {
    try {
      if (existsSync(full)) unlinkSync(full)
    } catch {
      /* already gone or locked */
    }
  }

  saveConversations(keep)
  const byAge = prune.filter((c) => new Date(c.updatedAt) < cutoff).length
  const byCount = prune.length - byAge
  const parts: string[] = []
  if (byAge > 0) parts.push(`${byAge} por idade (>14 dias)`)
  if (byCount > 0) parts.push(`${byCount} por limite (max ${MAX_CONVERSATIONS})`)
  console.log(
    `[conversations] pruned ${prune.length} conversation(s) — ${parts.join(', ')}` +
      (toDelete.length > 0 ? `; ${toDelete.length} image file(s) deleted` : '') +
      (toDeleteDocs.length > 0 ? `; ${toDeleteDocs.length} document file(s) deleted` : '')
  )
}

/**
 * Serialise writes to `ai-conversations.json` so a save that loaded the file
 * before another one finished doesn't overwrite the other's changes.
 */
let _saveQueue: Promise<void> = Promise.resolve()
function safeConversationsSave(op: () => void): void {
  _saveQueue = _saveQueue.then(() => {
    op()
  })
}

function createWindow(): void {
  managedWindow = createManagedWindow({
    preloadPath: join(__dirname, '../preload/index.js'),
    productionPagePath: join(__dirname, '../renderer/index.html'),
    icon,
    isDev: is.dev,
    rendererUrl: process.env['ELECTRON_RENDERER_URL']
  })
  mainWindow = managedWindow.window
}

app.commandLine.appendSwitch('lang', 'pt-BR')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sagyou')
  const passwordState = loadPasswordConfig()
  passwordConfig = passwordState.config
  passwordConfigCorrupt = passwordState.corrupt
  passwordUnlocked = passwordConfig === null && !passwordConfigCorrupt

  const filesDir = join(app.getPath('userData'), 'files')
  if (!existsSync(filesDir)) mkdirSync(filesDir)

  // Migrate old ai-templates.json to per-file skills (one .md = one skill).
  // Templates were a flat JSON array; skills are individual .md files the model
  // can call with /skill-name.  Run once: after migration the .json is renamed
  // to .bak so it never runs again.
  const templatesPath = join(app.getPath('userData'), 'ai-templates.json')
  if (existsSync(templatesPath)) {
    try {
      const raw = readFileSync(templatesPath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      const entries: { name?: string; body?: string }[] = Array.isArray(parsed) ? parsed : []
      const dir = skillsDir(app.getPath('userData'))
      let migrated = 0
      for (const t of entries) {
        const name = (t.name ?? '').trim()
        const body = (t.body ?? '').trim()
        if (!name || !body) continue
        const res = saveSkill(dir, { name, body })
        if ('skill' in res) migrated++
      }
      if (migrated > 0)
        console.log(`[skills] migrated ${migrated} template(s) from ai-templates.json`)
    } catch (_) {
      /* best-effort — a corrupt json is silently skipped */
    }
    try {
      renameSync(templatesPath, templatesPath + '.bak')
    } catch (_) {
      /* if rename fails (e.g. permissions), leave it — worst case it tries next launch */
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerWindowHandlers(ipcMain, () => mainWindow)
  ipcMain.handle('security:status', (event) => {
    assertTrustedRenderer(event)
    return passwordStatus()
  })
  ipcMain.handle('security:unlock', (event, password: unknown) => {
    assertTrustedRenderer(event)
    if (passwordConfigCorrupt) {
      return {
        success: false,
        error: 'A configuração de senha está corrompida. Use a recuperação.'
      }
    }
    if (!passwordConfig || verifyPassword(passwordConfig, password)) {
      passwordUnlocked = true
      return { success: true }
    }
    return { success: false, error: 'Senha incorreta.' }
  })
  ipcMain.handle('security:enable', (event, password: unknown) => {
    assertTrustedRenderer(event)
    if (passwordConfigCorrupt) {
      return { success: false, error: 'Recupere a configuração de senha antes de criar outra.' }
    }
    if (passwordConfig) return { success: false, error: 'A senha já está ativada.' }
    const next = createPasswordConfig(password)
    if ('error' in next) return { success: false, error: next.error }
    savePasswordConfig(next)
    passwordConfig = next
    passwordUnlocked = true
    return { success: true }
  })
  ipcMain.handle('security:change', (event, current: unknown, nextPassword: unknown) => {
    assertTrustedRenderer(event)
    if (passwordConfigCorrupt) {
      return { success: false, error: 'A configuração de senha está corrompida.' }
    }
    if (!passwordConfig || !verifyPassword(passwordConfig, current))
      return { success: false, error: 'Senha atual incorreta.' }
    const next = createPasswordConfig(nextPassword)
    if ('error' in next) return { success: false, error: next.error }
    savePasswordConfig(next)
    passwordConfig = next
    return { success: true }
  })
  ipcMain.handle('security:disable', (event, current: unknown) => {
    assertTrustedRenderer(event)
    if (passwordConfigCorrupt) {
      return { success: false, error: 'A configuração de senha está corrompida.' }
    }
    if (!passwordConfig || !verifyPassword(passwordConfig, current))
      return { success: false, error: 'Senha atual incorreta.' }
    try {
      unlinkSync(passwordConfigPath())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    passwordConfig = null
    passwordUnlocked = true
    return { success: true }
  })
  ipcMain.handle('security:recover', (event, confirmed: unknown) => {
    assertTrustedRenderer(event)
    if (!passwordConfigCorrupt || confirmed !== true) {
      return { success: false, error: 'Confirme a recuperação para continuar.' }
    }
    try {
      unlinkSync(passwordConfigPath())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { success: false, error: 'Não foi possível remover a configuração corrompida.' }
      }
    }
    passwordConfig = null
    passwordConfigCorrupt = false
    passwordUnlocked = true
    return { success: true }
  })
  protectDataIpc(ipcMain)
  ipcMain.handle('app:flush-before-close:complete', () => managedWindow?.completeClose())
  registerFilesHandlers(ipcMain, {
    mainWindow,
    dialog,
    shell,
    filesDir,
    chatImagesDir: chatImagesDir(),
    chatFilesDir: chatFilesDir(),
    taskImagesDir: taskImagesDir(),
    userDataPath: app.getPath('userData'),
    sep
  })

  ipcMain.handle('store:load', () => loadData())

  ipcMain.handle('store:save', (_, data) => {
    saveData(data)
  })
  ipcMain.on(
    'store:mcp:create-task:response',
    (_, response: { requestId?: unknown; id?: unknown; error?: unknown }) => {
      if (typeof response.requestId !== 'string') return
      if (typeof response.id === 'string') rendererMcpTasks.resolve(response.requestId, response.id)
      else
        rendererMcpTasks.reject(
          response.requestId,
          new Error(
            typeof response.error === 'string'
              ? response.error
              : 'O Sagyou recusou a criação da task.'
          )
        )
    }
  )
  ipcMain.handle('store:rebuild-search-index', () => rebuildSearchIndex())
  ipcMain.handle('search:global', (_, options: unknown) => searchGlobalIndex(options))
  ipcMain.handle('search:global:get', (_, options: unknown) => getGlobalSearchIndexHit(options))

  registerBackupHandlers(ipcMain, {
    dialog,
    filesDir,
    chatImagesDir: chatImagesDir(),
    taskImagesDir: taskImagesDir(),
    backupDir: join(app.getPath('userData'), 'backups'),
    sep,
    chatImagePath,
    taskImagePath
  })
  ipcMain.handle('backup:open-folder', async () => {
    const dir = join(app.getPath('userData'), 'backups')
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  ipcMain.handle('ai:config:get', () => publicAIConfig(loadAIConfig()))

  ipcMain.handle('ai:config:set', (_, config: AIConfig) => {
    saveAIConfig(config)
  })

  // Sign in with ChatGPT stays entirely in main. The DevKit performs PKCE,
  // validates identity/scopes, refreshes tokens and keeps them encrypted at
  // rest; IPC exposes only its deliberately safe session/profile shapes.
  ipcMain.handle('ai:chatgpt:session', async () => (await getChatGPT()).getSession())
  ipcMain.handle('ai:chatgpt:profiles', async () => (await getChatGPT()).listProfiles())
  ipcMain.handle('ai:chatgpt:sign-in', async (_, newProfile?: boolean) =>
    (await getChatGPT()).signIn({ newProfile: newProfile === true })
  )
  ipcMain.handle('ai:chatgpt:select', async (_, profileId: string) =>
    (await getChatGPT()).selectProfile(profileId)
  )
  ipcMain.handle('ai:chatgpt:disconnect', async () => (await getChatGPT()).disconnect())
  ipcMain.handle('ai:chatgpt:models', async () => (await getChatGPT()).listModels())
  ipcMain.handle('ai:chatgpt:manage-usage', async () =>
    shell.openExternal((await loadSiwc()).CHATGPT_USAGE_URL)
  )
  ipcMain.handle(
    'ai:chatgpt:stream',
    async (
      event,
      request: {
        streamId: string
        model: string
        reasoningEffort?: 'low' | 'medium' | 'high'
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
      }
    ) => {
      try {
        const instructions = request.messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n')
        const input = request.messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: (message.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: message.content
          }))
        const result = await (
          await getChatGPT()
        ).streamResponse({
          model: request.model,
          input,
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
          ...(instructions ? { instructions } : {}),
          onDelta: (delta) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chat:delta', { streamId: request.streamId, delta })
            }
          }
        })
        return { success: true, message: { role: 'assistant', content: result.text } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Falha ao contatar o ChatGPT'
        }
      }
    }
  )

  ipcMain.handle('ai:harnesses:status', async (_, refresh?: boolean) =>
    getHarnessStatuses(refresh === true)
  )


  ipcMain.handle('ai:run-metrics:append', (_, input: RunMetricInput) => appendRunMetricIO(input))
  ipcMain.handle('ai:run-metrics:summary', () => summarizeRunMetrics(loadRunMetrics()))

  registerMemoryHandlers(ipcMain, { store: memoryStore, memory: memoryRules, newId: randomUUID })

  // Entity lineage: query the event log for one entity's history.
  ipcMain.handle('ai:lineage:list', (_, entityType: string, entityId: string) =>
    eventsForEntity(entityType, entityId)
  )

  // Proxy an OpenAI-compatible chat/completions call. baseURL + apiKey come
  // from the renderer when provided, falling back to the stored config.
  ipcMain.handle(
    'ai:chat',
    async (
      _,
      request: {
        messages: unknown[]
        tools?: unknown[]
        model?: string
        profileId?: string
        reasoningEffort?: 'low' | 'medium' | 'high'
        baseUrl?: string
        apiKey?: string
      }
    ) => {
      const config = loadAIConfig()
      const selected = resolveChatConfig(config, request.profileId)
      const baseURL = selected.baseUrl
      const apiKey = selected.apiKey
      const model = request.model || selected.model
      if (!baseURL || !model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      try {
        const client = getOpenAIClient(baseURL, apiKey, selected.provider)
        const body = {
          model,
          messages: request.messages,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          ...((request.reasoningEffort ?? config.reasoningEffort)
            ? { reasoning_effort: request.reasoningEffort ?? config.reasoningEffort }
            : {})
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        const completion = await client.chat.completions.create(
          body,
          requestOptions(config.timeoutMs)
        )
        const message = completion.choices[0]?.message
        if (!message) return { success: false, error: 'Resposta vazia do modelo' }
        const usage = toUsage(completion.usage)
        if (usage) appendUsage(model, usage, config)
        return {
          success: true,
          message: {
            role: 'assistant',
            content: message.content ?? '',
            tool_calls: message.tool_calls
          },
          usage
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Falha ao contatar o modelo',
          status: errorStatus(e)
        }
      }
    }
  )

  // Same as 'ai:chat', but streams the assistant's text back as it arrives
  // ('ai:chat:delta' events tagged with the caller's streamId) so the renderer
  // can type the answer out. Resolves with the assembled message, identical in
  // shape to 'ai:chat', so the agent loop treats both the same.
  ipcMain.handle(
    'ai:chat:stream',
    async (
      event,
      request: {
        streamId: string
        messages: unknown[]
        tools?: unknown[]
        model?: string
        profileId?: string
        reasoningEffort?: 'low' | 'medium' | 'high'
        baseUrl?: string
        apiKey?: string
      }
    ) => {
      const config = loadAIConfig()
      const selected = resolveChatConfig(config, request.profileId)
      const baseURL = selected.baseUrl
      const apiKey = selected.apiKey
      const model = request.model || selected.model
      if (!baseURL || !model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      try {
        const client = getOpenAIClient(baseURL, apiKey, selected.provider)
        const body = {
          model,
          messages: request.messages,
          stream: true,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          ...((request.reasoningEffort ?? config.reasoningEffort)
            ? { reasoning_effort: request.reasoningEffort ?? config.reasoningEffort }
            : {})
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming

        // A streaming provider only reports token usage if asked. Not every
        // OpenAI-compatible server knows `stream_options` though, and a strict
        // one answers 400 — so fall back to a plain stream rather than break
        // chat for it. Losing the token count beats losing the answer.
        let stream: Awaited<ReturnType<typeof client.chat.completions.create>>
        try {
          stream = await client.chat.completions.create(
            {
              ...body,
              stream_options: { include_usage: true }
            } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
            requestOptions(config.timeoutMs)
          )
        } catch (e) {
          if (errorStatus(e) !== 400) throw e
          stream = await client.chat.completions.create(body, requestOptions(config.timeoutMs))
        }

        let usage: TokenUsage | undefined
        let content = ''
        // tool_calls arrive split across chunks: each delta carries an index and
        // a slice of the JSON arguments, which we concatenate per index.
        //
        // Yes, the SDK can assemble this for us — `client.chat.completions
        // .stream(...).finalChatCompletion()` returns the message with
        // tool_calls already joined, and it handles content deltas and usage
        // too. It is deliberately NOT used here. Its finalizer hard-throws
        // `OpenAIError: missing role for choice 0` when a delta never carries a
        // `role`, which real OpenAI always sends but an OpenAI-compatible
        // server need not — and this app points at any such endpoint, local
        // ones included. Verified against a mock provider: on role-less deltas
        // the SDK helper throws while this loop returns the tool call fine, and
        // it throws at the END, after the answer already streamed to the user.
        //
        // (`stream.toReadableStream()` assembles nothing at all — it just hands
        // back the raw SSE bytes as a web stream.)
        //
        // Tolerance is the point here; the ~20 lines below are the price.
        const toolCalls: {
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }[] = []

        for await (const chunk of stream) {
          // The usage chunk arrives last and carries no choices, so read it
          // before the delta guard below skips the chunk entirely.
          usage = toUsage(chunk.usage) ?? usage
          const delta = chunk.choices[0]?.delta
          if (!delta) continue
          if (delta.content) {
            content += delta.content
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chat:delta', {
                streamId: request.streamId,
                delta: delta.content
              })
            }
          }
          for (const tc of delta.tool_calls ?? []) {
            const slot = (toolCalls[tc.index] ??= {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            })
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) {
              slot.function.name += tc.function.name
              // Say what's coming as soon as it's known, rather than sitting on
              // it until the message completes. A tool call with no preamble
              // streams no text at all, so the renderer has nothing to show
              // while the arguments arrive — which for a big criar_tasks is
              // seconds of anonymous spinner. The name lands in the first delta;
              // the arguments are what take the time.
              //
              // Re-sent if a name arrives in pieces (name += above): the
              // renderer takes the latest per index, so a partial is corrected
              // rather than duplicated.
              if (!event.sender.isDestroyed()) {
                event.sender.send('ai:chat:delta', {
                  streamId: request.streamId,
                  tool: { index: tc.index, name: slot.function.name }
                })
              }
            }
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments
          }
        }

        const calls = toolCalls.filter(Boolean)
        if (usage) appendUsage(model, usage, config)
        return {
          success: true,
          message: {
            role: 'assistant',
            content,
            ...(calls.length > 0 ? { tool_calls: calls } : {})
          },
          usage
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Falha ao contatar o modelo',
          status: errorStatus(e)
        }
      }
    }
  )

  // List the models the provider exposes (GET /models), through the main
  // process so the renderer's model dropdown doesn't hit CORS either.
  ipcMain.handle(
    'ai:models',
    async (
      _,
      request?:
        | string
        | {
            profileId?: string
            draft?: { baseUrl: string; apiKey?: string; provider?: ApiProvider }
          }
    ) => {
      const config = loadAIConfig()
      const profileId = typeof request === 'string' ? request : request?.profileId
      // A draft credential exists only for this IPC call. It lets the user pick
      // from their account's real catalog before saving a profile, without ever
      // returning that credential to the renderer.
      const selected =
        request && typeof request !== 'string' && request.draft
          ? {
              baseUrl: request.draft.baseUrl.trim(),
              apiKey: request.draft.apiKey ?? '',
              model: '',
              provider: request.draft.provider ?? 'custom'
            }
          : resolveChatConfig(config, profileId)
      const baseURL = selected.baseUrl
      const apiKey = selected.apiKey
      if (!baseURL) return { success: false, error: 'Base URL não configurada' }
      try {
        if (selected.provider === 'anthropic') {
          const endpoint = new URL(
            'models?limit=1000&lifecycle=active',
            `${baseURL.replace(/\/+$/, '')}/`
          )
          const response = await fetch(endpoint, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            signal: AbortSignal.timeout(resolveTimeoutMs(config.timeoutMs))
          })
          if (!response.ok) throw new Error(`Claude retornou ${response.status} ao listar modelos`)
          const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
          const models = Array.from(
            new Set(
              (body.data ?? [])
                .map((model) => model.id)
                .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
            )
          )
          return { success: true, models }
        }
        const client = getOpenAIClient(baseURL, apiKey, selected.provider)
        const page = await client.models.list(requestOptions(config.timeoutMs))
        const models = Array.from(
          new Set(
            (page.data ?? [])
              .filter((model) => (model as { shutdown_date?: string | null }).shutdown_date == null)
              .map((m) => m?.id)
              .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
          )
        ).sort((a, b) => a.localeCompare(b))
        return { success: true, models }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Falha ao carregar modelos'
        }
      }
    }
  )

  // Launch a native code agent in the project directory. The renderer must
  // have obtained user approval before calling this (it writes files / runs
  // commands). Output is streamed back via 'ai:code-agent:output'.
  ipcMain.handle(
    'ai:code-agent:run',
    async (
      _,
      request: {
        path: string
        task: string
        files?: string[]
        allowedWritePaths?: string[]
        /** Absolute directories selected by the user for read-only reference. */
        readOnlyRoots?: ReadOnlyRoot[]
        /** Scope decisions already agreed with the user, honoured without re-deciding. */
        decisoes?: string[]
        /** The chat that asked, so the run can be reopened from it later. */
        convId?: string
        /** The project whose memory to brief the agent with (shared with the chat). */
        projectId?: string | null
        /** Financial profile captured with the project scope. */
        financialProfileId?: string
        /** Chat-coordinated requests may only hand off to a terminal executor. */
        coordinated?: boolean
        /** Start in auto-approval mode — approve() returns true without IPC. */
        autoApprove?: boolean
      }
    ) => {
      const dir = request.path
      const capturedProjectId =
        typeof request.projectId === 'string' && request.projectId.trim() ? request.projectId : null
      const capturedData = loadData()
      const capturedProject = capturedProjectId
        ? capturedData.projects.find((project) => project.id === capturedProjectId)
        : null
      const codeRoot = dir ? resolve(dir) : ''
      if (capturedProjectId && !capturedProject) {
        return { success: false, error: 'Projeto escolhido indisponÃ­vel. Selecione-o novamente.' }
      }
      if (capturedProjectId && !(capturedProject?.codePaths ?? []).length) {
        return {
          success: false,
          error:
            'O projeto escolhido nÃ£o possui raiz de cÃ³digo. Adicione uma pasta antes de iniciar o terminal.'
        }
      }
      if (
        capturedProjectId &&
        !(capturedProject?.codePaths ?? []).some((root) => resolve(root.path) === codeRoot)
      ) {
        return {
          success: false,
          error: 'A raiz escolhida nÃ£o pertence ao projeto. Selecione uma raiz cadastrada nele.'
        }
      }
      const capturedFinancialProfileId =
        typeof request.financialProfileId === 'string' && request.financialProfileId.trim()
          ? request.financialProfileId
          : (capturedData.activeFinancialProfileId ?? 'personal')
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
      const cfg = loadAIConfig()
      const harness = cfg.codeHarness === 'claude-code' ? 'claude-code' : 'codex'
      const externalHarness =
        (await getHarnessStatuses()).find((status) => status.id === harness) ?? null
      if (!externalHarness?.installed || !externalHarness.path) {
        const label = harness === 'claude-code' ? 'Claude Code' : 'Codex'
        return {
          success: false,
          error:
            label + ' não foi encontrado nesta máquina. Use Verificar novamente nas configurações.'
        }
      }
      // Codex and Claude Code have exactly one execution transport: their
      // native CLI in a main-owned PTY. The renderer cannot select an executable
      // or an execution mode.
      const interactive = true
      if (!externalHarness) {
        return {
          success: false,
          error: 'A sessão interativa é disponível somente para Codex, OpenCode ou Claude Code.'
        }
      }
      // Cleanup worktrees órfãos (que sobraram de uma queda do app)
      try {
        await worktreeManager.removeOrphans(dir)
      } catch {
        // Se não é git ou não há worktrees, ignora
      }

      // Fase 2(b): se o dir já está ocupado, cria um git worktree isolado
      const runId = randomUUID()
      // Every executor, including the first native run, works in its own
      // detached tree. The original project is touched only by delivery.
      const needsWorktree = true
      // Reserve synchronously before the first await below. Two IPC requests can
      // otherwise both observe an idle directory and write to the original tree.
      codeRunCoordinator.register(dir, runId, !needsWorktree)
      let worktreeDir: string | null = null
      const releaseFailedStart = async (): Promise<void> => {
        codeRunCoordinator.unregister(dir, runId)
        if (!worktreeDir) return
        await worktreeManager.remove({ originalDir: dir, worktreeDir }).catch(() => {})
      }
      if (needsWorktree) {
        try {
          await execAsync(`git -C "${dir}" rev-parse --show-toplevel`)
          worktreeDir = (await worktreeManager.create(dir, runId)).worktreeDir
        } catch (error) {
          await releaseFailedStart()
          const reason = error instanceof Error ? error.message : 'falha desconhecida do Git'
          return {
            success: false,
            error:
              'Já existe um agente de código rodando neste diretório e não foi possível criar um worktree. ' +
              `O Git informou: ${reason}`
          }
        }
      }
      const effectiveDir = worktreeDir ?? dir
      const task = typeof request.task === 'string' ? request.task.trim() : ''
      if (!task) {
        await releaseFailedStart()
        return { success: false, error: 'Tarefa vazia' }
      }
      // Files the caller pinned so the agent skips discovery. Confine each to the
      // root (same barrier as the read tools — a path is the model's, so it may
      // be `../../etc`), and drop anything that escapes or doesn't exist rather
      // than handing the agent a bogus target. An empty/all-invalid list falls
      // back to the discovery path, so this can only speed things up, never break.
      // Kept alongside the accepted list so the banner below can name what was
      // dropped. A silently discarded path is the failure mode worth surfacing:
      // it doesn't error, it just costs the user the slow discovery path.
      const requestedFiles = Array.isArray(request.files)
        ? request.files.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
        : []
      const files = requestedFiles
        .map((f) => confineToRoot(effectiveDir, f))
        .filter((f): f is string => f !== null && existsSync(f) && statSync(f).isFile())
      const droppedFiles = requestedFiles.filter((f) => {
        const abs = confineToRoot(effectiveDir, f)
        return abs === null || !existsSync(abs) || !statSync(abs).isFile()
      })
      // Unlike pinned input files, an allowed output may not exist yet. It is
      // still confined to the root and later enforced by writeFileTool.
      const requestedAllowedPaths = Array.isArray(request.allowedWritePaths)
        ? request.allowedWritePaths.filter(
            (f): f is string => typeof f === 'string' && f.trim() !== ''
          )
        : []
      const allowedWritePaths = requestedAllowedPaths
        .map((requestedPath) => {
          const absolutePath = confineToRoot(effectiveDir, requestedPath)
          if (!absolutePath) return null
          const isRoot =
            /[\\/]$/.test(requestedPath) ||
            (existsSync(absolutePath) && statSync(absolutePath).isDirectory())
          const path = relative(effectiveDir, absolutePath)
          return isRoot ? path + '/' : path
        })
        .filter((f): f is string => f !== null)
        .filter((f) => f !== '')
      const requestedReadOnlyRoots = Array.isArray(request.readOnlyRoots)
        ? request.readOnlyRoots
        : []
      const readOnlyRoots = requestedReadOnlyRoots
        .filter(
          (item): item is ReadOnlyRoot =>
            !!item &&
            typeof item.id === 'string' &&
            typeof item.nome === 'string' &&
            typeof item.path === 'string'
        )
        .map((item) => ({
          ...item,
          id: item.id.trim(),
          nome: item.nome.trim(),
          path: resolve(item.path)
        }))
        .filter(
          (item) =>
            item.id && item.nome && existsSync(item.path) && statSync(item.path).isDirectory()
        )
      if (requestedReadOnlyRoots.length !== readOnlyRoots.length) {
        await releaseFailedStart()
        return { success: false, error: 'Uma ou mais referências de leitura são inválidas.' }
      }
      if (
        requestedAllowedPaths.length &&
        allowedWritePaths.length !== requestedAllowedPaths.length
      ) {
        await releaseFailedStart()
        return {
          success: false,
          error: 'Um ou mais caminhos permitidos estão fora da raiz do projeto.'
        }
      }
      // Scope decisions the chat already settled with the user — plain strings,
      // no path involved, so just clean and pass them into the prompt.
      const decisoes = Array.isArray(request.decisoes)
        ? request.decisoes
            .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
            .map((d) => d.trim())
        : []
      // Create the run state and register it — a new run starts fresh.
      // (runId foi criado acima, antes do worktree)
      const run: CodeRunState = {
        id: runId,
        dir,
        convId: typeof request.convId === 'string' && request.convId ? request.convId : null,
        projectId: capturedProjectId,
        financialProfileId: capturedFinancialProfileId,
        codeRoot,
        agent: externalHarness.label,
        task: taskLabel(task),
        startedAt: Date.now(),
        abort: false,
        log: '',
        base: await captureBase(effectiveDir),
        hint: null,
        model: externalHarness.label,
        usage: { promptTokens: 0, completionTokens: 0 },
        step: 0,
        // Zero means unlimited. The user stops a runaway run explicitly; loop
        // brakes still block repeated reads/searches/commands.
        maxSteps: 0,
        pendingApprovals: new Map(),
        pendingQuestions: new Map(),
        autoApprove: typeof request.autoApprove === 'boolean' ? request.autoApprove : false,
        worktreeDir: worktreeDir,
        worktreeMergeError: null,
        allowedWritePaths: allowedWritePaths.length ? allowedWritePaths : undefined,
        readOnlyRoots,
        externalChild: null,
        interactive,
        finishing: false,
        terminalCols: 100,
        terminalRows: 30
      }
      codeSessions.register(run)

      const send = (channel: string, data: unknown): void =>
        mainWindow?.webContents.send(channel, data)
      // Push the live progress (step + running token total) to the panel's
      // counter. Cheap and idempotent; fired on each step and each usage report.
      send('ai:code-agent:started', { runId, dir })
      // Stream it and keep it: the panel may not be mounted to hear this.
      const emit = (chunk: string): void => {
        appendAgentLog(runId, chunk)
        send('ai:code-agent:output', { runId, chunk })
      }

      // Opening banner: the REAL model in use (task 11), and which files were
      // pinned vs left for the agent to discover with buscar_no_codigo.
      const rel = files.map((f) => relative(effectiveDir, f) || f)
      emit(
        '[' +
          externalHarness.command +
          '] ' +
          externalHarness.label +
          ' · execução isolada em worktree\n'
      )
      emit(
        '[' +
          externalHarness.command +
          '] permissões do CLI próprio; alterações ficam no worktree até sua aprovação.\n'
      )
      emit(
        rel.length
          ? `[sagyou] ${rel.length} arquivo(s) indicado(s) — busca desativada, conteúdo já no contexto:\n` +
              rel.map((f) => `  · ${f}\n`).join('')
          : '[sagyou] nenhum arquivo indicado — o agente vai localizá-los com buscar_no_codigo.\n'
      )
      if (droppedFiles.length) {
        emit(
          `[sagyou] ${droppedFiles.length} caminho(s) descartado(s) (fora da raiz ou inexistente):\n` +
            droppedFiles.map((f) => `  · ${f}\n`).join('')
        )
      }
      if (decisoes.length) {
        emit(
          `[sagyou] ${decisoes.length} decisão(ões) já tomada(s) — o agente deve respeitá-las:\n` +
            decisoes.map((d) => `  · ${d}\n`).join('')
        )
      }

      if (externalHarness.path && worktreeDir) {
        const launch = buildTerminalHarnessLaunch(harness, task, effectiveDir)
        const referenceBrief = await readOnlyReferenceBrief(readOnlyRoots)
        const appBrief = sagyouContextBrief(run.projectId)
        let sourceConversation = ''
        let relatedConversations = ''
        let relevantMemories: import('./memory').AiMemory[] = []
        try {
          const conversations = loadConversations()
          sourceConversation = briefCurrentConversation(conversations, run.convId)
          relatedConversations = briefConversationsForTask(conversations, task, {
            excludeId: run.convId,
            maxConversations: 3
          })
          // Search is ranking-only and does not touch decay counters. Full data
          // still stays behind MCP once the executor needs to investigate.
          relevantMemories = memoryStore
            .searchMemories({ projectId: run.projectId, term: task, limit: 5 })
            .map((hit) => hit.memory)
        } catch {
          /* Briefing context is best-effort; a launch must remain available. */
        }
        const agentBrief = buildExternalAgentBrief({
          objective: task,
          decisions: decisoes,
          files: rel,
          sourceConversation,
          relatedConversations,
          memories: relevantMemories
        })
        const scopedTask = scrubExternalBriefSecrets(
          [
            agentBrief,
            referenceBrief,
            appBrief,
            'Trabalhe somente neste projeto. Ao terminar, explique brevemente o que fez.'
          ]
            .filter(Boolean)
            .join('\n\n')
        )
        const externalWorktree = worktreeDir
        const externalRuntime = { env: process.env }
        // A capability token is not an identifier: use 256 bits of entropy and
        // keep it only in the spawned executor environment, never in UI/logs.
        const mcpToken = randomBytes(32).toString('base64url')
        const baseExternalArgs = buildTerminalHarnessLaunch(harness, scopedTask, effectiveDir).args
        const mcpSession = await prepareAgentMcpSession({
          broker: sagyouMcp,
          token: mcpToken,
          runId,
          projectId: run.projectId,
          financialProfileId: run.financialProfileId,
          permissions: CODE_EXECUTOR_MCP_PERMISSIONS,
          worktreeDir: effectiveDir,
          executor: harness,
          executable: process.execPath,
          args: baseExternalArgs,
          env: externalRuntime.env,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        })
        externalRuntime.env = mcpSession.env
        const externalArgs = mcpSession.args
        emit(
          interactive
            ? '[' +
                externalHarness.command +
                '] sessão interativa de ' +
                launch.label +
                ' iniciada no worktree. Envie mensagens pelo painel e encerre a sessão para revisar o diff.\n'
            : '[' +
                externalHarness.command +
                '] iniciando ' +
                launch.label +
                ' em worktree; o diff final pedirá sua aprovação.\n'
        )

        let settled = false
        const finishExternal = async (code: number | null): Promise<void> => {
          if (settled) return
          settled = true
          run.externalChild = null
          let exitCode = run.abort ? -2 : run.finishing ? 0 : (code ?? 1)
          try {
            const changes = await collectAgentPatch(externalWorktree, {
              base: run.base?.base
            })
            const fullPatch = changes.patch
            const scope = await validatePatchScope(
              externalWorktree,
              changes.changedPaths,
              run.allowedWritePaths
            )
            if (!scope.allowed) {
              run.worktreeMergeError =
                'o agente alterou arquivo fora do escopo permitido: ' +
                scope.rejectedPaths.join(', ')
              exitCode = 2
              emit(
                '[worktree] caminhos recusados por escopo: ' +
                  scope.rejectedPaths.join(', ') +
                  '. Nenhuma alteração foi apresentada para aprovação.\n'
              )
              return
            }
            if (fullPatch.trim() && !run.abort) {
              const fileCount = changes.fileCount
              const preview = agentPatchPreview(fullPatch)
              const approved = await new Promise<boolean>((resolveApproval) => {
                const id = randomUUID()
                const approval: CodeApprovalRequest = {
                  runId,
                  id,
                  name: 'aplicar_alteracoes_externas',
                  args: { harness: launch.label, arquivos: fileCount },
                  resumo:
                    'Aplicar ' + fileCount + ' alteração(ões) do ' + launch.label + ' ao projeto',
                  conteudo: fullPatch.slice(0, 12000),
                  diff: preview.lines,
                  diffTruncated: preview.truncated,
                  irreversivel: false
                }
                run.pendingApprovals.set(id, { resolve: resolveApproval, request: approval })
                send('ai:code-agent:approve-request', approval)
              })
              if (approved && !run.abort) {
                await deliverApprovedPatch({
                  originalDir: dir,
                  runId,
                  patch: fullPatch,
                  coordinator: codeRunCoordinator,
                  onWaitingForDirectRun: () => {
                    emit('[worktree] aguardando o agente que escreve no diretório original…\n')
                  }
                })
                emit('[worktree] ' + fileCount + ' arquivo(s) aplicado(s) após sua aprovação.\n')
              } else {
                run.worktreeMergeError = run.abort
                  ? 'execução interrompida'
                  : 'alterações não aprovadas pelo usuário'
                if (exitCode === 0) exitCode = run.abort ? -2 : 2
                emit('[worktree] alterações não aplicadas ao projeto original.\n')
              }
            }
          } catch (error) {
            run.worktreeMergeError =
              error instanceof Error ? error.message : 'erro ao preparar alterações'
            if (exitCode === 0) exitCode = 2
            emit(
              '[erro] alterações do worktree não foram aplicadas: ' + run.worktreeMergeError + '\n'
            )
          } finally {
            await mcpSession.cleanup()
            const secs = ((Date.now() - run.startedAt) / 1000).toFixed(1)
            emit('[' + externalHarness.command + '] duração: ' + secs + 's\n')
            const terminal = run.worktreeMergeError
              ? '[agente encerrado — código ' + exitCode + '; alterações não aplicadas]'
              : '[agente encerrado — código ' + exitCode + ']'
            appendAgentLog(runId, '\n' + terminal + '\n')
            const archived = await archiveAgentRun(runId, exitCode)
            persistTerminalHandoff(run, exitCode, archived)
            await worktreeManager
              .remove({ originalDir: dir, worktreeDir: externalWorktree })
              .catch(() => {})
            send('ai:code-agent:exit', { runId, code: exitCode })
            lastRunLog = run.log
            lastRunHint = run.hint
            lastRunModel = run.model
            lastRunProgress = {
              step: run.step,
              maxSteps: run.maxSteps,
              promptTokens: run.usage.promptTokens,
              completionTokens: run.usage.completionTokens
            }
            mcpWriteQueue.rejectRun(runId)
            codeSessions.remove(runId)
            codeRunCoordinator.unregister(dir, runId)
          }
        }

        try {
          const terminal = startAgentPty({
            command: externalHarness.path,
            args: externalArgs,
            cwd: effectiveDir,
            env: externalRuntime.env,
            onData: emit,
            onExit: (exitCode) => {
              void finishExternal(exitCode)
            }
          })
          run.externalChild = terminal
        } catch (error) {
          emit(
            '[erro ao iniciar ' +
              launch.label +
              ': ' +
              (error instanceof Error ? error.message : 'falha') +
              ']\n'
          )
          void finishExternal(1)
        }
        return { success: true, agent: launch.label, dir, runId, worktreeDir }
      }

      await releaseFailedStart()
      return { success: false, error: 'Não foi possível iniciar o executor externo.' }

    }
  )
  ipcMain.handle('ai:code-agent:stop', (_, runId?: string) => {
    stopCodeAgent(typeof runId === 'string' ? runId : undefined)
  })

  ipcMain.handle('ai:code-agent:terminal-input', (_, runId: string, input: string) => {
    const run = codeRuns.get(runId)
    if (!run?.interactive || !run.externalChild || run.finishing) {
      return { success: false, error: 'Sessão interativa indisponível.' }
    }
    if (!isAgentTerminalInput(input) || !('write' in run.externalChild)) {
      return { success: false, error: 'Entrada de terminal inválida.' }
    }
    run.externalChild.write(input)
    return { success: true }
  })

  // The renderer owns pixels; the PTY owns its character grid. Keep the bridge
  // narrow so a terminal can resize only the interactive process it already
  // belongs to, never create or reconfigure a shell on its own.
  ipcMain.handle(
    'ai:code-agent:terminal-resize',
    (_, runId: string, cols: number, rows: number) => {
      const run = codeRuns.get(runId)
      if (
        !run?.interactive ||
        !run.externalChild ||
        run.finishing ||
        !('resize' in run.externalChild)
      ) {
        return { success: false, error: 'Sessão interativa indisponível.' }
      }
      if (!isAgentTerminalSize(cols, rows)) {
        return { success: false, error: 'Tamanho de terminal inválido.' }
      }
      run.externalChild.resize(cols, rows)
      run.terminalCols = cols
      run.terminalRows = rows
      return { success: true }
    }
  )

  ipcMain.handle('ai:code-agent:finish-interactive', (_, runId: string) => {
    const run = codeRuns.get(runId)
    if (!run?.interactive || !run.externalChild) {
      return { success: false, error: 'Sessão interativa indisponível.' }
    }
    run.finishing = true
    run.externalChild.kill('SIGTERM')
    return { success: true }
  })

  // Read-only reconnect: return the bounded buffer of an existing PTY without
  // creating a process or exposing an executable selection to the renderer.
  ipcMain.handle('ai:code-agent:terminal-reconnect', (_, runId: string) => {
    const run = codeRuns.get(runId)
    if (!run?.interactive || !run.externalChild || run.finishing) {
      return { success: false, error: 'SessÃ£o interativa indisponÃ­vel.' }
    }
    return {
      success: true,
      log: run.log,
      cols: run.terminalCols,
      rows: run.terminalRows
    }
  })

  // The renderer's answer to an approval card the loop is parked on. Resolving
  // the pending promise is what lets the run continue (or run the denied path).
  // UUIDs are unique, so search across all runs' pendingApprovals maps.
  ipcMain.handle('ai:code-agent:approve-response', (_, id: string, approved: boolean) => {
    for (const run of codeRuns.values()) {
      const pending = run.pendingApprovals.get(id)
      if (pending) {
        run.pendingApprovals.delete(id)
        pending.resolve(approved === true)
        return
      }
    }
  })
  // The renderer's answer to a question card. An empty answer means the user
  // cancelled it; code-agent.ts returns that fact to the model so it can stop or
  // choose a safe alternative instead of inventing a response.
  ipcMain.handle('ai:code-agent:question-response', (_, id: string, answer?: string) => {
    for (const run of codeRuns.values()) {
      const pending = run.pendingQuestions.get(id)
      if (pending) {
        run.pendingQuestions.delete(id)
        const normalized = typeof answer === 'string' ? answer.trim() : ''
        pending.resolve(normalized || null)
        return
      }
    }
  })

  // Toggle auto-approval for a running code agent. When on, approve() returns
  // true without sending IPC — the renderer gets ai:code-agent:auto-changed
  // so the UI can reflect the new state.
  ipcMain.handle('ai:code-agent:set-auto', (_, runId: string, enabled: boolean) => {
    const run = codeRuns.get(runId)
    if (!run) return
    run.autoApprove = enabled === true
    const resolvedApprovalIds: string[] = []
    if (run.autoApprove) {
      for (const [id, pending] of run.pendingApprovals) {
        if (pending.request.name === 'aplicar_alteracoes_externas') continue
        run.pendingApprovals.delete(id)
        resolvedApprovalIds.push(id)
        pending.resolve(true)
      }
    }
    mainWindow?.webContents.send('ai:code-agent:auto-changed', {
      runId,
      autoApprove: run.autoApprove,
      resolvedApprovalIds
    })
  })

  // `runs` is an array of run summaries — a panel that wasn't mounted catches
  // up per-run. Keep old fields for backward compat (tests and code read
  // `.running` / `.log` / `.hint` directly), sourced from the first active run.
  ipcMain.handle('ai:code-agent:status', () => {
    const runs = [...codeRuns.values()]
    const first = runs[0]
    return {
      running: codeRuns.size > 0,
      log: first?.log ?? lastRunLog,
      model: first?.model ?? lastRunModel,
      hint: first?.hint ?? lastRunHint,
      progress: first
        ? {
            step: first.step,
            maxSteps: first.maxSteps,
            promptTokens: first.usage.promptTokens,
            completionTokens: first.usage.completionTokens
          }
        : lastRunProgress,
      runs: runs.map((r) => ({
        id: r.id,
        dir: r.dir,
        task: r.task,
        convId: r.convId,
        projectId: r.projectId,
        financialProfileId: r.financialProfileId,
        codeRoot: r.codeRoot,
        agent: r.agent,
        allowedWritePaths: r.allowedWritePaths,
        readOnlyRoots: r.readOnlyRoots,
        interactive: r.interactive,
        finishing: r.finishing,
        terminalCols: r.terminalCols,
        terminalRows: r.terminalRows,
        startedAt: r.startedAt,
        log: r.log,
        model: r.model,
        hint: r.hint,
        autoApprove: r.autoApprove,
        approvals: [...r.pendingApprovals.values()].map((pending) => pending.request),
        questions: [...r.pendingQuestions.values()].map((pending) => pending.request),
        progress: {
          step: r.step,
          maxSteps: r.maxSteps,
          promptTokens: r.usage.promptTokens,
          completionTokens: r.usage.completionTokens
        }
      }))
    }
  })

  /**
   * What a run changed. If `runId` is given, use that run's base; otherwise
   * use the first active run's base.
   */
  ipcMain.handle('ai:code-agent:diff', async (_, runId?: string) => {
    let base: AgentBase | null = null
    if (typeof runId === 'string') {
      base = codeRuns.get(runId)?.base ?? null
    } else {
      for (const run of codeRuns.values()) {
        base = run.base
        break
      }
    }
    if (!base) {
      return {
        patch: '',
        files: [],
        truncated: false,
        omittedNewFiles: [],
        error: 'Sem diff: esta pasta não é um repositório git (ou não tem commits ainda).'
      }
    }
    return diffSince(base)
  })

  /**
   * Past runs of one conversation, newest first. Index only — the logs and
   * diffs stay on disk until a row is actually opened.
   */
  ipcMain.handle('ai:code-agent:runs', (_, convId?: string) =>
    typeof convId === 'string' && convId
      ? runsForConv(loadRunIndex(), convId)
      : sortRuns(loadRunIndex())
  )

  /**
   * One archived run, log and diff included. Frozen at the moment the agent
   * exited: re-deriving the diff today would fold in everything the user has
   * changed since and present it as the agent's work.
   */
  ipcMain.handle('ai:code-agent:run-get', async (_, id: string) => {
    const path = agentRunPath(id)
    if (!path || !existsSync(path)) return null
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as AgentRunSnapshot
    } catch {
      return null
    }
  })

  /**
   * Renew a run's TTL by updating its endedAt to now. Called when the user
   * continues a conversation with an archived agent — resets the 24h countdown.
   */
  ipcMain.handle('ai:code-agent:run-renew', (_, id: string) => {
    const path = agentRunPath(id)
    if (!path || !existsSync(path)) return
    const index = loadRunIndex()
    const run = index.find((r) => r.id === id)
    if (run) {
      run.endedAt = Date.now()
      saveRunIndex(index)
    }
  })

  ipcMain.handle('ai:pick-directory', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled || filePaths.length === 0) return { path: null }
    return { path: filePaths[0] }
  })

  registerCodeFilesHandlers(ipcMain, { files: codeFiles, fs: codeFileFs })

  // Fetch a page for the assistant. The URL comes from the model, so it is
  // untrusted input — ./web-fetch does the vetting (http(s) only, no local or
  // private addresses, re-checked on every redirect), caps the read and bounds
  // the wait. With `render`, ./web-render loads it in a headless browser instead
  // (for SPA pages that need JS), applying the SAME policy to every request the
  // page makes — see web-render.ts for the guard and its residual risks.
  ipcMain.handle('ai:web:fetch', (_, url: string, render?: boolean) =>
    render ? renderWeb(url) : fetchWeb(url)
  )

  // Exchange rate from AwesomeAPI (primary) or Frankfurter (fallback).
  // Cached for 24h in userData/financial-rates.json.
  // Returns { rate: string, date: string, source: 'awesomeapi'|'frankfurter'|'cache'|'identity' }
  ipcMain.handle('financial:exchange-rate:fetch', async (_, pair: string) => {
    try {
      const result = await getExchangeRate(pair)
      return result
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao buscar cotação' }
    }
  })

  ipcMain.handle('ai:skills:list', () => listSkills(skillsPath()))

  ipcMain.handle('ai:skills:save', (_, input: { name: string; body: string; oldName?: string }) => {
    const res = saveSkill(skillsPath(), input)
    if ('error' in res) return res
    return { skill: res.skill }
  })

  ipcMain.handle('ai:skills:delete', (_, name: string) => {
    deleteSkill(skillsPath(), name)
  })

  ipcMain.handle('ai:skills:import', async () => {
    return importSkillDialog(skillsPath())
  })

  registerConversationHandlers(ipcMain, {
    loadConversations,
    saveConversations,
    safeConversationsSave,
    listMemories
  })

  pruneConversations()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Don't leave any code agent's loop running when the app closes.
app.on('before-quit', () => {
  rendererMcpTasks.close()
  stopCodeAgent()
})
