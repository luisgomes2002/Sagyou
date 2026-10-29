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
  copyFileSync,
  chmodSync,
  statSync,
  accessSync,
  constants
} from 'fs'
import * as codeFileFs from 'fs'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
const execFileAsync = promisify(execFile)
import { randomBytes, randomUUID } from 'crypto'
import { CodeRunCoordinator } from './modules/agent/code-run-coordinator'
import {
  McpWriteQueue,
  RendererMcpActionBridge,
  type McpWriteRequest
} from './modules/agent/mcp-write-queue'
import { parkMcpApproval } from './modules/agent/mcp-approval'
import {
  MCP_APPROVAL_REQUIRED,
  MCP_MEMORY_TOOLS,
  autoApprovesPending,
  mcpWriteResult,
  prepareMemoryWrite,
  type McpMemoryOp
} from './modules/agent/mcp-write-tools'
import type { McpActionRequest, McpActionResult } from './modules/agent/mcp-write-types'
import { AgentSessionRegistry } from './modules/agent/agent-session'
import { AgentWorktreeManager } from './modules/agent/agent-worktree'
import { resolveAgentSessionRoot } from './modules/agent/agent-session-root'
import { startAgentPty, type AgentPty } from './modules/agent/agent-pty'
import { resizeTerminal, writeTerminalInput } from './modules/agent/agent-terminal-session'
import {
  buildHarnessLaunch,
  discoverHarnessLocalContext,
  discoverHarnesses,
  isHarnessId,
  type HarnessId
} from './modules/agent/harness-adapter'
import { detectHarnessModel } from './modules/agent/harness-model'
import { collectAgentPatch, agentPatchPreview, validatePatchScope } from './modules/agent/agent-diff'
import { deliverApprovedPatch } from './modules/agent/agent-delivery'
import { createRunTaskTimers } from './modules/agent/agent-task-timers'
import { CODE_EXECUTOR_MCP_PERMISSIONS, prepareAgentMcpSession } from './modules/agent/agent-mcp-session'
import { buildExternalAgentBrief, scrubExternalBriefSecrets } from './modules/agent/agent-briefing'
import { buildTerminalHandoff } from './modules/agent/terminal-handoff'
import {
  createRunActivity,
  runActivityEntry,
  summarizeRunActivity
} from './modules/agent/run-activity'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  loadData,
  saveData,
  eventsForEntity,
  rebuildSearchIndex,
  searchGlobalIndex,
  getGlobalSearchIndexHit,
  copyDatabaseTo,
  scrubMemoryConversationLinks
} from './store'
import {
  hasLegacyApiConfig,
  runLegacyChatRemoval,
  stripAiConfigFile,
  stripLegacyApiConfig
} from './modules/ai/legacy-chat-removal'
import { createLegacyChatState } from './modules/ai/legacy-chat-state'
import {
  registerLegacyChatHandlers,
  shouldRunLegacyChatRemoval,
  startLegacyChatRemoval
} from './handlers/legacy-chat'
import * as memoryStore from './store'
import * as memoryRules from './modules/ai/memory'
import { registerMemoryHandlers } from './handlers/memory'
import { confineToRoot } from './modules/code/code-files'
import * as codeFiles from './modules/code/code-files'
import { fetchWeb } from './modules/web/web-fetch'
import { renderWeb } from './modules/web/web-render'
import { getExchangeRate } from './modules/financial/financial-exchange'
import { startSagyouMcpBroker } from './modules/agent/sagyou-mcp'
import { configureLog, createLogger, errorMessage, log } from './modules/logs/logger'
import { captureBase, diffSince, type AgentBase, type DiffLineItem } from './modules/code/code-diff'
import { safeAttachmentName } from './modules/files/backup-files'
import {
  diffFileCount,
  isRunId,
  normalizeRuns,
  sortRuns,
  pruneRuns,
  runOwnership,
  runsForSession,
  taskLabel,
  type AgentRunMeta,
  type AgentRunSnapshot
} from './modules/agent/agent-runs'
import {
  listSkills,
  saveSkill,
  deleteSkill,
  importSkill as importSkillDialog,
  skillsDir
} from './modules/ai/skills'
import { createManagedWindow, registerWindowHandlers, type ManagedWindow } from './handlers/window'
import { registerFilesHandlers } from './handlers/files'
import { registerBackupHandlers } from './handlers/backup'
import { normalizeLegacyAIConfig } from './modules/conversations/legacy-ai-data'
import { registerCodeFilesHandlers } from './handlers/code-files'
import {
  createPasswordConfig,
  parsePasswordConfig,
  verifyPassword,
  type PasswordConfig
} from './modules/security/security'
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
  readLogs: (query) => log.readLogs(query),
  onToolCall: (call) => log.info('mcp', 'tool_call', call),
  readScopedData: (domain, session, projectId) => {
    const data = loadData()
    if (domain === 'tasks')
      return projectId ? data.tasks.filter((item) => item.projectId === projectId) : data.tasks
    if (domain === 'project')
      return (
        projectId ? data.projects.filter((item) => item.id === projectId) : data.projects
      ).map((project) => ({
        ...project,
        sprints: (data.sprints ?? [])
          .filter((sprint) => sprint.projectId === project.id)
          .map(({ id, name, closedAt }) => ({ id, name, closed: Boolean(closedAt) }))
      }))
    if (domain === 'notes')
      return projectId ? data.notes.filter((item) => item.projectId === projectId) : data.notes
    if (domain === 'goals')
      return projectId ? data.goals.filter((item) => item.projectId === projectId) : data.goals
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
  listProjects: () =>
    loadData().projects.map(({ id, name, description, archivedAt }) => ({
      id,
      name,
      description,
      archived: Boolean(archivedAt)
    })),
  readTasks: (projectId) => {
    const data = loadData()
    return data.tasks
      .filter((task) => !projectId || task.projectId === projectId)
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
    const data = loadData()
    return {
      metas: data.goals.filter((goal) => !projectId || goal.projectId === projectId),
      notas: data.notes.filter((note) => !projectId || note.projectId === projectId)
    }
  },
  searchMemory: (projectId, term) =>
    memoryStore.searchMemories({
      projectId: projectId ?? null,
      allProjects: projectId === undefined,
      term,
      limit: 8
    }),
  readMemory: (id) => memoryStore.getMemory(id),
  listMemoriesForRecent: () => memoryStore.listMemories({ includeArchived: true }),
  // Keep the existing once-per-hour decay accounting in the store; the broker
  // decides authorization first, so rejected probes never count as a read.
  touchMemory: (id) => memoryStore.touchMemories([id], new Date().toISOString()),
  // Context already limits this to active project + global memories. The pure
  // conflict check below never writes, touches, archives or resolves anything.
  memoriesForConflict: (projectId) =>
    projectId === undefined
      ? memoryStore.listMemories()
      : memoryStore.memoriesForContext(projectId),
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
    const projectId =
      typeof args.projectId === 'string' && args.projectId.trim()
        ? args.projectId.trim()
        : session.projectId
    if (!projectId) throw new Error('Escolha um projeto em list_projects para criar a task.')
    const data = loadData()
    const project = data.projects.find((item) => item.id === projectId)
    const column = project?.columns[0]
    if (!project || !column)
      throw new Error('O projeto autorizado não possui uma coluna para a task.')
    const outcome = await mcpWriteQueue.enqueue(
      { runId: session.runId, name: 'criar_task', args: { projectId, titulo: title } },
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
  },
  write: async (session, name, args) => {
    if (MCP_MEMORY_TOOLS.has(name)) {
      const prepareMemory = (): ReturnType<typeof prepareMemoryWrite> =>
        prepareMemoryWrite(name, args, {
          getMemory: (id) => memoryStore.getMemory(id),
          listMemories: () => memoryStore.listMemories(),
          now: new Date().toISOString()
        })
      const outcome = await mcpWriteQueue.enqueue<McpActionResult>(
        { runId: session.runId, name, args, approval: MCP_APPROVAL_REQUIRED.has(name) },
        async () => {
          // Re-validate: the memory may have changed while the card was up.
          const prepared = prepareMemory()
          if (!prepared.ok) return prepared
          return applyMemoryOp(prepared.op)
        },
        async () => {
          const prepared = prepareMemory()
          return prepared.ok ? { resumo: prepared.resumo } : { refuse: prepared }
        }
      )
      return mcpWriteResult(name, outcome)
    }
    const scope = { projectId: session.projectId, financialProfileId: session.financialProfileId }
    const outcome = await mcpWriteQueue.enqueue<McpActionResult>(
      { runId: session.runId, name, args, approval: MCP_APPROVAL_REQUIRED.has(name) },
      () =>
        rendererMcpActions.request({ phase: 'apply', name, args, scope }).then((result) => {
          // Recorded when the renderer answers, even if the run ended meanwhile
          // (the queue rejects the caller, but the timer was started all the same).
          runTaskTimers.record(session.runId, scope, name, result)
          return result
        }),
      async () => {
        const prepared = await rendererMcpActions.request({ phase: 'prepare', name, args, scope })
        return prepared.ok ? { resumo: String(prepared.resumo ?? name) } : { refuse: prepared }
      }
    )
    return mcpWriteResult(name, outcome)
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
  sessionId: string | null
  /** Immutable application scope captured when the terminal was created. */
  projectId: string | null
  financialProfileId: string
  codeRoot: string
  /** The real model name this run is using, shown by the panel and picker. */
  agent: string
  /** Stable adapter id; labels and model names are presentation only. */
  harness: HarnessId
  localInstructions: string[]
  localSkills: string[]
  task: string
  /** Scope decisions the chat settled before launch; they go into the handoff. */
  decisions: string[]
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
  /** Last time the harness transcript was read for `model`; throttles status polls. */
  modelCheckedAt?: number
  /** Tokens accumulated across this run's model calls. */
  usage: { promptTokens: number; completionTokens: number }
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
  /** A real TTY session accepts user input until the harness exits. */
  interactive: boolean
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
  /** MCP cards only: when main stops waiting and answers the agent with a denial. */
  expiresAt?: string
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

/** Generic MCP writes: the renderer validates (prepare) and applies them on its live store. */
const rendererMcpActions = new RendererMcpActionBridge<McpActionRequest, McpActionResult>(
  ({ requestId, payload }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('A janela do Sagyou precisa estar aberta para alterar dados.')
    mainWindow.webContents.send('store:mcp:action', { requestId, request: payload })
  }
)

/**
 * Timers an agent run created; stopped (time saved) when the run ends or the
 * app quits. `stop_run_timer` is internal: it only stops the timer started at
 * that instant, never one the user restarted.
 */
const runTaskTimers = createRunTaskTimers(
  (taskId, startedAt, scope) =>
    rendererMcpActions.request({
      phase: 'apply',
      name: 'stop_run_timer',
      args: { id: taskId, startedAt },
      scope
    }),
  (event) => log.info('mcp', 'run_timer_stop', event)
)

/** Memory is main-owned SQLite: each MCP memory write completes before the reply. */
function applyMemoryOp(op: McpMemoryOp): McpActionResult {
  const now = new Date().toISOString()
  if (op.kind === 'upsert') {
    memoryStore.upsertMemory(op.memory)
    return { ok: true, id: op.memory.id, ...(op.redacted ? { redacted: true } : {}) }
  }
  if (op.kind === 'archive') {
    memoryStore.archiveMemories([op.id], now)
    return { ok: true, id: op.id }
  }
  if (op.kind === 'delete') {
    memoryStore.deleteMemory(op.id)
    return { ok: true, id: op.id }
  }
  if (op.kind === 'resolve') {
    if (op.keep) memoryStore.upsertMemory(op.keep)
    memoryStore.archiveMemories([op.archiveId], now)
    return {
      ok: true,
      id: op.archiveId,
      arquivada: op.archiveId,
      ...(op.redacted ? { redacted: true } : {})
    }
  }
  return { ok: true, id: op.id }
}

/** A run can only write while it exists, was not stopped and still has its terminal. */
function isMcpRunLive(runId: string): boolean {
  const run = codeRuns.get(runId)
  return Boolean(run && !run.abort && !(run.interactive && !run.externalChild))
}

/** Card text for the writes whose tool does not prepare a resumo of its own. */
function mcpCardResumo(name: string, args: Record<string, unknown>): string {
  return name === 'criar_task'
    ? `Criar task "${String(args.titulo ?? '').slice(0, 80)}" em ${loadData().projects.find((project) => project.id === args.projectId)?.name ?? String(args.projectId ?? 'projeto desconhecido')}`
    : `MCP Sagyou: ${name.replace('_', ' ')}`
}

/** Applied MCP writes per run: the handoff's subject, actions and pending tasks. */
const runActivity = createRunActivity()

function recordRunActivity(request: McpWriteRequest, value: unknown): void {
  const entry = runActivityEntry(request, value, () => mcpCardResumo(request.name, request.args))
  if (entry) runActivity.record(request.runId, entry)
}

/** Routes MCP writes through the exact same approval UI as code-agent actions. */
function requestMcpWriteApproval(
  runId: string,
  name: string,
  args: Record<string, unknown>,
  resumo?: string
): Promise<boolean> {
  const run = codeRuns.get(runId)
  if (!run || !isMcpRunLive(runId)) return Promise.resolve(false)
  const request: CodeApprovalRequest = {
    runId,
    id: randomUUID(),
    name: `mcp:${name}`,
    args,
    resumo: resumo ?? mcpCardResumo(name, args)
  }
  return parkMcpApproval(run.pendingApprovals, request, (card) =>
    mainWindow?.webContents.send('ai:code-agent:approve-request', card)
  ).then((approved) => {
    // Refusal, closing and timeout all resolve false; only the outcome is logged.
    log.info('mcp', 'approval', {
      runId,
      tool: name,
      decision: approved ? 'approved' : 'not_approved'
    })
    return approved
  })
}

const mcpWriteQueue = new McpWriteQueue(
  (request) =>
    requestMcpWriteApproval(request.runId, request.name, request.args, request.resumo),
  isMcpRunLive,
  recordRunActivity
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

type ExternalHarnessId = HarnessId

interface HarnessStatus {
  id: ExternalHarnessId
  label: string
  command: string
  installed: boolean
  path: string | null
  version: string | null
  /** Only reported when the CLI has a safe status command; never opens login. */
  authentication: 'authenticated' | 'unauthenticated' | 'unknown'
  models: string[]
  capabilities: import('./modules/agent/harness-adapter').HarnessCapabilities
}

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
  harnessStatusCache = await discoverHarnesses(runHarnessCommand, resolveExecutable)
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
 * the run-scoped MCP capability, which retains the financial profile and
 * approves writes while letting the user query other projects explicitly.
 * Passing `loadData()` here would silently bypass those boundaries in the prompt.
 */
function sagyouContextBrief(projectId: string | null | undefined): string {
  try {
    const project = projectId ? loadData().projects.find((item) => item.id === projectId) : null
    return project
      ? `## CONTEXTO DO SAGYOU\nProjeto inicial: ${project.name}. Use list_projects no MCP Sagyou para consultar outros projetos por ID.`
      : '## CONTEXTO DO SAGYOU\nSessão geral. Use list_projects no MCP Sagyou para descobrir projetos e consultar seus dados.'
  } catch {
    return ''
  }
}

/**
 * Local Sagyou skills are explicit user-authored briefing material, so an
 * external executor can use them without receiving the skills directory (or
 * any extra filesystem authority). Keep the hand-off bounded and sanitize it
 * together with the rest of the external brief.
 */
function sagyouSkillsBrief(): string {
  try {
    const skills = listSkills(skillsPath()).slice(0, 20)
    if (!skills.length) return ''
    const body = skills
      .map((skill) => `### /${skill.name}\n${skill.body.slice(0, 4_000)}`)
      .join('\n\n')
      .slice(0, 20_000)
    return `## SKILLS LOCAIS DO SAGYOU\nUse estas instruções quando forem pertinentes à tarefa.\n\n${body}`
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
  return buildHarnessLaunch(harness, task, cwd)
}
/**
 * Agent settings only. The generic chat's API connection keys are gone for
 * good; unknown keys still ride along untouched so an older or newer build's
 * field is never lost by a rewrite.
 */
interface AIConfig {
  /** Preferred form of address, shown on the lock screen. */
  userName?: string
  /** Historic native selections load as the Codex default. */
  codeHarness?: HarnessId
  reasoningEffort?: 'low' | 'medium' | 'high'
  [key: string]: unknown
}

/** The only shape this process ever hands out or writes: no API-chat keys. */
function agentOnlyConfig(value: unknown): AIConfig {
  return stripLegacyApiConfig(normalizeLegacyAIConfig(value)).config as AIConfig
}

const aiConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

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

function readAIConfigFile(): AIConfig {
  try {
    return agentOnlyConfig(JSON.parse(readFileSync(aiConfigPath(), 'utf-8')))
  } catch {
    return {}
  }
}

function loadAIConfig(): AIConfig {
  return readAIConfigFile()
}

/**
 * Merge over what is on disk so a key this build does not know survives, and
 * drop every API-chat key from both sides: none may be accepted or persisted.
 */
function saveAIConfig(config: unknown): void {
  keepUnreadableAIConfig()
  const merged = { ...readAIConfigFile(), ...agentOnlyConfig(config) }
  const userName =
    typeof merged.userName === 'string' ? merged.userName.trim().slice(0, 80) : undefined
  const path = aiConfigPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...merged, userName: userName || undefined }, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/**
 * An unreadable ai-config.json reads as empty, so the next save would replace
 * it with defaults and destroy whatever was recoverable in it. Keep a copy
 * beside it first (the migration leaves such a file untouched for the same
 * reason).
 */
function keepUnreadableAIConfig(): void {
  const path = aiConfigPath()
  if (!existsSync(path)) return
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    copyFileSync(path, `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  }
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
      sessionId: run.sessionId,
      projectId: run.projectId,
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
      sessionId: run.sessionId
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

const BLANK_SESSION_TASK = 'Sessão interativa'

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
    const activity = summarizeRunActivity(runActivity.take(run.id))
    memoryStore.upsertMemory(
      buildTerminalHandoff(
        {
          projectId: run.projectId,
          runId: run.id,
          request: run.task,
          status,
          result,
          changedFiles: files,
          subject: run.task === BLANK_SESSION_TASK ? activity.subject : run.task,
          decisions: [...run.decisions, ...activity.decisions],
          actions: activity.actions,
          pending: activity.pending
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
  // Diagnostic log first, so migrations and startup failures are recorded.
  // Lives in userData/logs (outside the backup); in dev it also echoes to the console.
  configureLog(
    createLogger({
      // Dev shares userData with the installed app; keep its events apart.
      dir: join(app.getPath('userData'), is.dev ? 'logs-dev' : 'logs'),
      echo: is.dev
        ? (entry) =>
            (entry.level === 'info' ? console.log : console.warn)(
              `[${entry.area}] ${entry.event}`,
              entry.msg ?? '',
              entry.data ?? ''
            )
        : undefined
    })
  )
  log.prune()
  log.info('app', 'started', { version: app.getVersion(), platform: process.platform, dev: is.dev })
  // The monitor only observes: Electron still handles the crash as before.
  process.on('uncaughtExceptionMonitor', (error) =>
    log.error('app', 'uncaught_exception', { msg: errorMessage(error) })
  )
  // A listener replaces Node's default warning, so print it as before too.
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason)
    log.error('app', 'unhandled_rejection', { msg: errorMessage(reason) })
  })
  app.on('render-process-gone', (_, __, details) =>
    log.error('app', 'renderer_gone', { reason: details.reason, exitCode: details.exitCode })
  )

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
      if (migrated > 0) log.info('app', 'skills_migrated', { count: migrated })
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
  ipcMain.on(
    'store:mcp:action:response',
    (_, response: { requestId?: unknown; result?: unknown }) => {
      if (typeof response.requestId !== 'string') return
      const result = response.result as McpActionResult | undefined
      if (result && typeof result === 'object' && typeof result.ok === 'boolean')
        rendererMcpActions.resolve(response.requestId, result)
      else
        rendererMcpActions.reject(
          response.requestId,
          new Error('O Sagyou devolveu uma resposta inválida à ação MCP.')
        )
    }
  )
  ipcMain.handle('store:rebuild-search-index', () => rebuildSearchIndex())
  ipcMain.handle('search:global', (_, options: unknown) => searchGlobalIndex(options))
  ipcMain.handle('search:global:get', (_, options: unknown) => getGlobalSearchIndexHit(options))

  registerBackupHandlers(ipcMain, {
    dialog,
    filesDir,
    taskImagesDir: taskImagesDir(),
    backupDir: join(app.getPath('userData'), 'backups'),
    sep,
    taskImagePath
  })
  ipcMain.handle('backup:open-folder', async () => {
    const dir = join(app.getPath('userData'), 'backups')
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  ipcMain.handle('ai:config:get', () => loadAIConfig())

  ipcMain.handle('ai:config:set', (_, config: unknown) => {
    saveAIConfig(config)
  })

  ipcMain.handle('ai:harnesses:status', async (_, refresh?: boolean) =>
    getHarnessStatuses(refresh === true)
  )

  registerMemoryHandlers(ipcMain, { store: memoryStore, memory: memoryRules, newId: randomUUID })

  // Entity lineage: query the event log for one entity's history.
  ipcMain.handle('ai:lineage:list', (_, entityType: string, entityId: string) =>
    eventsForEntity(entityType, entityId)
  )

  // Launch a native agent in a project root or the private general workspace. The renderer must
  // have obtained user approval before calling this (it writes files / runs
  // commands). Output is streamed back via 'ai:code-agent:output'.
  ipcMain.handle(
    'ai:code-agent:run',
    async (
      _,
      request: {
        path: string
        task: string
        /**
         * A session with no initial request: the CLI opens on its own screen and
         * receives no briefing. Ignored when a task is given.
         */
        blank?: boolean
        files?: string[]
        allowedWritePaths?: string[]
        /** Absolute directories selected by the user for read-only reference. */
        readOnlyRoots?: ReadOnlyRoot[]
        /** Scope decisions already agreed with the user, honoured without re-deciding. */
        decisoes?: string[]
        /** The terminal session that owns the run, so it can be reopened later. */
        sessionId?: string
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
      const capturedProjectId =
        typeof request.projectId === 'string' && request.projectId.trim() ? request.projectId : null
      const capturedData = loadData()
      const capturedProject = capturedProjectId
        ? capturedData.projects.find((project) => project.id === capturedProjectId)
        : null
      let sessionRoot
      try {
        sessionRoot = resolveAgentSessionRoot({
          projectId: capturedProjectId,
          requestPath: request.path,
          project: capturedProject ?? null,
          userDataDir: app.getPath('userData')
        })
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Diretório do projeto inválido'
        }
      }
      const { dir, codeRoot, privateWorkspace } = sessionRoot
      const capturedFinancialProfileId =
        typeof request.financialProfileId === 'string' && request.financialProfileId.trim()
          ? request.financialProfileId
          : (capturedData.activeFinancialProfileId ?? 'personal')
      if (privateWorkspace) mkdirSync(dir, { recursive: true })
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
      const cfg = loadAIConfig()
      const harness: HarnessId = isHarnessId(cfg.codeHarness) ? cfg.codeHarness : 'codex'
      const externalHarness =
        (await getHarnessStatuses()).find((status) => status.id === harness) ?? null
      if (!externalHarness?.installed || !externalHarness.path) {
        const label = harness === 'claude-code' ? 'Claude Code' : harness === 'opencode' ? 'OpenCode' : 'Codex'
        return {
          success: false,
          error:
            label + ' não foi encontrado nesta máquina. Use Verificar novamente nas configurações.'
        }
      }
      if (
        externalHarness.capabilities.createSession !== 'available' ||
        externalHarness.capabilities.interactiveTerminal !== 'available' ||
        externalHarness.capabilities.mcp !== 'available'
      ) {
        return {
          success: false,
          error: `${externalHarness.label} não oferece a sessão MCP interativa exigida nesta versão.`
        }
      }
      // The adapter selects the one native transport for each CLI. The renderer
      // cannot select an executable or an execution mode.
      const interactive = true
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
      const localHarnessContext = discoverHarnessLocalContext(effectiveDir)
      const task = typeof request.task === 'string' ? request.task.trim() : ''
      const blankSession = !task && request.blank === true
      if (!task && !blankSession) {
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
        ...runOwnership({ sessionId: request.sessionId, projectId: capturedProjectId }),
        projectId: capturedProjectId,
        financialProfileId: capturedFinancialProfileId,
        codeRoot,
        agent: externalHarness.label,
        harness,
        localInstructions: localHarnessContext.instructions,
        localSkills: localHarnessContext.skills,
        task: blankSession ? BLANK_SESSION_TASK : taskLabel(task),
        decisions: decisoes,
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
        const localSkillsBrief = sagyouSkillsBrief()
        let relevantMemories: import('./modules/ai/memory').AiMemory[] = []
        let recentHandoffs: import('./modules/ai/memory').AiMemory[] = []
        try {
          // Search is ranking-only and does not touch decay counters. Full data
          // still stays behind MCP once the executor needs to investigate.
          relevantMemories = memoryStore
            .searchMemories({ projectId: run.projectId, term: task, limit: 5 })
            .map((hit) => hit.memory)
          // Nothing matched the request's words: the last handoffs say what came before.
          if (!relevantMemories.length)
            recentHandoffs = memoryRules.selectRecentMemories(memoryStore.listMemories(), {
              projectId: run.projectId,
              allProjects: false,
              type: 'handoff',
              status: 'active',
              offset: 0,
              limit: 2
            }).items
        } catch {
          /* Briefing context is best-effort; a launch must remain available. */
        }
        const agentBrief = buildExternalAgentBrief({
          objective: task,
          decisions: decisoes,
          files: rel,
          memories: relevantMemories,
          recentHandoffs
        })
        // A blank session starts the CLI on its normal screen: pasting a briefing
        // (skills, MCP hints) would run a turn nobody asked for.
        const scopedTask = blankSession
          ? ''
          : scrubExternalBriefSecrets(
          [
            agentBrief,
            referenceBrief,
            appBrief,
            localSkillsBrief,
            localHarnessContext.instructions.length || localHarnessContext.skills.length
              ? `## INSTRUÇÕES LOCAIS\nConsulte no worktree as instruções nativas detectadas: ${[...localHarnessContext.instructions, ...localHarnessContext.skills].join(', ')}. Não copie seu conteúdo para logs ou respostas sem necessidade.`
              : '',
            'Use esta worktree para alterações de código. Para dados do Sagyou, use list_projects no MCP e consulte outros projetos quando necessário. Ao terminar, explique brevemente o que fez.'
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
                ' iniciada no worktree. Ao sair do CLI, o diff será arquivado sem pedido de aprovação ou entrega.\n'
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
          // A closed terminal cannot answer MCP writes or questions. Deny them
          // before collecting the diff so the UI never remains parked on them.
          mcpWriteQueue.rejectRun(runId)
          // Applied directly, not through the queue just rejected; never holds up cleanup.
          void runTaskTimers.stopAll(runId)
          for (const { resolve } of run.pendingApprovals.values()) resolve(false)
          run.pendingApprovals.clear()
          for (const { resolve } of run.pendingQuestions.values()) resolve(null)
          run.pendingQuestions.clear()
          let exitCode = run.abort ? -2 : (code ?? 1)
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
              log.error('delivery', 'failed', {
                runId,
                reason: 'out_of_scope',
                paths: scope.rejectedPaths.length
              })
              exitCode = 2
              emit(
                '[worktree] caminhos recusados por escopo: ' +
                  scope.rejectedPaths.join(', ') +
                  '. Nenhuma alteração foi apresentada para aprovação.\n'
              )
              return
            }
            if (fullPatch.trim() && !run.abort) {
              if (run.interactive) {
                // Closing the native chat is a terminal outcome, never a parked
                // request for delivery. archiveAgentRun freezes this worktree diff.
                run.worktreeMergeError = 'sessão encerrada sem entrega'
                log.info('delivery', 'not_applied', { runId, reason: 'session_closed' })
                emit('[worktree] diff arquivado; alterações não aplicadas ao projeto original.\n')
              } else {
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
                  log.info('delivery', 'applied', { runId, files: fileCount })
                } else {
                  log.info('delivery', 'not_applied', {
                    runId,
                    reason: run.abort ? 'stopped' : 'refused'
                  })
                  run.worktreeMergeError = run.abort
                    ? 'execução interrompida'
                    : 'alterações não aprovadas pelo usuário'
                  if (exitCode === 0) exitCode = run.abort ? -2 : 2
                  emit('[worktree] alterações não aplicadas ao projeto original.\n')
                }
              }
            }
          } catch (error) {
            run.worktreeMergeError =
              error instanceof Error ? error.message : 'erro ao preparar alterações'
            log.error('delivery', 'failed', { runId, msg: errorMessage(error) })
            if (exitCode === 0) exitCode = 2
            emit(
              '[erro] alterações do worktree não foram aplicadas: ' + run.worktreeMergeError + '\n'
            )
          } finally {
            await mcpSession.cleanup()
            const secs = ((Date.now() - run.startedAt) / 1000).toFixed(1)
            emit('[' + externalHarness.command + '] duração: ' + secs + 's\n')
            log.info('pty', 'exited', { runId, exitCode, seconds: Number(secs) })
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
          log.info('pty', 'started', { runId, harness: launch.label })
        } catch (error) {
          log.error('pty', 'start_failed', {
            runId,
            harness: launch.label,
            msg: errorMessage(error)
          })
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
    return writeTerminalInput(codeRuns, runId, input)
  })

  // The renderer owns pixels; the PTY owns its character grid. Keep the bridge
  // narrow so a terminal can resize only the interactive process it already
  // belongs to, never create or reconfigure a shell on its own.
  ipcMain.handle(
    'ai:code-agent:terminal-resize',
    (_, runId: string, cols: number, rows: number) => {
      return resizeTerminal(codeRuns, runId, cols, rows)
    }
  )

  // Read-only reconnect: return the bounded buffer of an existing PTY without
  // creating a process or exposing an executable selection to the renderer.
  ipcMain.handle('ai:code-agent:terminal-reconnect', (_, runId: string) => {
    const run = codeRuns.get(runId)
    if (!run?.interactive || !run.externalChild) {
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
        if (!autoApprovesPending(pending.request.name)) continue
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
    // Status is polled on every output chunk; re-read the CLI's transcript at
    // most every few seconds so a mid-session model switch still shows up.
    const now = Date.now()
    for (const r of runs) {
      if (r.modelCheckedAt && now - r.modelCheckedAt < 5_000) continue
      r.modelCheckedAt = now
      const detected = detectHarnessModel(r.harness, r.worktreeDir ?? r.dir, r.startedAt)
      if (detected) r.model = detected
    }
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
        sessionId: r.sessionId,
        projectId: r.projectId,
        financialProfileId: r.financialProfileId,
        codeRoot: r.codeRoot,
        agent: r.agent,
        harness: r.harness,
        worktreeDir: r.worktreeDir,
        localInstructions: r.localInstructions,
        localSkills: r.localSkills,
        allowedWritePaths: r.allowedWritePaths,
        readOnlyRoots: r.readOnlyRoots,
        interactive: r.interactive,
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
   * Past runs of one session, newest first. Index only — the logs and
   * diffs stay on disk until a row is actually opened.
   */
  ipcMain.handle('ai:code-agent:runs', (_, sessionId?: string) =>
    typeof sessionId === 'string' && sessionId
      ? runsForSession(loadRunIndex(), sessionId)
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

  // Outside SQLite on purpose: persistAll() empties `settings` on a session's first save.
  const legacyState = createLegacyChatState(app.getPath('userData'))
  registerLegacyChatHandlers(ipcMain, {
    readSetting: legacyState.read,
    writeSetting: legacyState.write,
    now: () => new Date()
  })

  // The chat's data is removed before any window exists. A failure is logged,
  // never fatal. Dev runs skip it unless opted in: only the database file has a
  // dev suffix, so the rest of this migration would hit the real user data.
  const openWindows = (): void => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }
  if (!shouldRunLegacyChatRemoval({ isDev: is.dev, optIn: process.env.SAGYOU_RUN_LEGACY_CHAT_REMOVAL })) {
    log.warn('app', 'legacy_chat_removal_skipped', {
      msg: 'dev build: removal skipped (set SAGYOU_RUN_LEGACY_CHAT_REMOVAL=1 to run it)'
    })
    openWindows()
  } else {
    void startLegacyChatRemoval({
      run: () =>
        runLegacyChatRemoval({
          userDataDir: app.getPath('userData'),
          getMarker: () => {
            const marker = legacyState.read('legacyChatRemovedAt')
            return typeof marker === 'string' && marker ? marker : null
          },
          setMarker: (iso) => legacyState.write('legacyChatRemovedAt', iso),
          copyDatabase: copyDatabaseTo,
          scrubMemories: scrubMemoryConversationLinks,
          hasLegacyConfig: () => hasLegacyApiConfig(aiConfigPath()),
          getSnapshotDir: () => {
            const dir = legacyState.read('legacyChatSnapshotDir')
            return typeof dir === 'string' && dir ? dir : null
          },
          setSnapshotDir: (dir) => legacyState.write('legacyChatSnapshotDir', dir),
          stripAiConfig: () => stripAiConfigFile(aiConfigPath()),
          now: () => new Date()
        }),
      warn: (message) => log.warn('app', 'legacy_chat', { msg: message })
    }).finally(openWindows)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Don't leave any code agent's loop running when the app closes.
// Set once the agent-run timers were stopped, so the second quit goes through.
let runTimersStoppedForQuit = false

app.on('before-quit', (event) => {
  // Stop the timers agent runs created while the renderer can still save them;
  // otherwise the next launch would credit every hour the app stayed closed.
  if (!runTimersStoppedForQuit && runTaskTimers.hasRunning()) {
    event.preventDefault()
    runTimersStoppedForQuit = true
    void Promise.race([
      runTaskTimers.stopEverything(),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]).finally(() => app.quit())
    return
  }
  rendererMcpTasks.close()
  rendererMcpActions.close()
  stopCodeAgent()
})
