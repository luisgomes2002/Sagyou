process.env.LANG = 'pt_BR.UTF-8'
process.env.LC_ALL = 'pt_BR.UTF-8'
process.env.LC_TIME = 'pt_BR.UTF-8'
process.env.LANGUAGE = 'pt_BR:pt'

import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, relative, sep } from 'path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  renameSync,
  statSync,
  accessSync,
  constants
} from 'fs'
import { homedir } from 'os'
import { exec as execCallback } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
const execAsync = promisify(execCallback)
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import OpenAI from 'openai'
import { loadData, saveData, eventsForEntity } from './store'
import {
  listMemories,
  memoriesForContext,
  getMemory,
  upsertMemory,
  touchMemories,
  archiveMemories,
  deleteMemory,
  replaceMemories
} from './store'
import {
  buildMemory,
  selectStale,
  summarizeMemories,
  findConflicts,
  formatMemoriesForPrompt,
  handoffId,
  type MemoryInput
} from './memory'
import {
  appendEntry,
  newEntry,
  summarize,
  costAt,
  formatRunSummary,
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
import { getOpenAIClient, requestOptions } from './openai-client'
import { confineToRoot, walkFiles, detectSymbols, extractSymbol, extractLines, searchFiles } from './code-files'
import {
  runCodeAgent,
  buildSystemPrompt,
  codeToolsFor,
  inlineFilesBlock,
  readProjectGuide,
  dirTree,
  defaultCommandRunner,
  CODE_AGENT_MAX_STEPS,
  type InlinedFile,
  type AgentMessage,
  type CommandRunner,
  type ToolDef as CodeToolDef,
  type ToolCall as CodeToolCall
} from './code-agent'
import {
  detectAiJail,
  installAiJail,
  wrapCommand,
  runSandboxedWsl,
  looksLikeSandboxBlock,
  defaultExec,
  WSL_INSTALL_COMMAND,
  WSL_AI_JAIL_INSTALL_COMMANDS,
  type JailStatus,
  type InstallDeps
} from './ai-jail'
import { searchConversations, briefConversationsForTask } from './conversation-search'
import { fetchWeb } from './web-fetch'
import { renderWeb } from './web-render'
import { getExchangeRate } from './financial-exchange'
import { captureBase, diffSince, lineDiff, type AgentBase, type DiffLineItem } from './code-diff'
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
import { registerWindowHandlers } from './handlers/window'
import { registerFilesHandlers } from './handlers/files'
import { registerBackupHandlers } from './handlers/backup'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

/**
 * The live state of one code-agent run.
 *
 * Before N-agent support this was a set of module-level singletons — one run
 * at a time. Now the app can host multiple concurrent runs in different
 * directories, each with its own log, base, approval queue, and usage counter.
 */
interface CodeRunState {
  id: string
  dir: string
  convId: string | null
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
  pendingApprovals: Map<string, (approved: boolean) => void>
  /** Whether auto-approval mode is on for this run. */
  autoApprove: boolean
  /** Se não-null, o agente roda num git worktree isolado em vez do dir original. */
  worktreeDir: string | null
}

/** All runs in flight, keyed by run id. */
const codeRuns = new Map<string, CodeRunState>()

/** Directories that currently have a code agent running — one run per dir. */
const codeAgentDirs = new Set<string>()

/**
 * Backward compat: the last finished run's state, kept after the run is cleaned
 * from codeRuns. Mirrors the old module-level globals (codeAgentLog, codeAgentHint,
 * etc.) so status() still returns data after a run ends — panels that poll status()
 * after the exit event can still read the log and hint.
 */
let lastRunLog = ''
let lastRunHint: AgentHint | null = null
let lastRunModel: string | undefined
let lastRunProgress:
  | { step: number; maxSteps: number; promptTokens: number; completionTokens: number }
  | undefined

/**
 * Cap on the per-run log buffer, matching the panel's own cap in AIView.
 *
 * Equal on purpose: leaving the view and coming back should show exactly what
 * staying would have shown. A generous main-side buffer would make the panel
 * change depending on where the user had been standing.
 */
const MAX_AGENT_LOG = 8000

/** Append to the run's buffer, keeping only the tail the panel can show. */
function appendAgentLog(runId: string, chunk: string): void {
  const run = codeRuns.get(runId)
  if (!run) return
  run.log = (run.log + chunk).slice(-MAX_AGENT_LOG)
}

/**
 * A known environment failure, recognised from the agent's own output, with the
 * fix spelled out. Structured rather than a log line because the log is behind a
 * toggle in the panel — a message the user has to go looking for does not reach
 * the user who doesn't know anything is wrong.
 */
export interface AgentHint {
  title: string
  detail: string
  /** A shell command that fixes it, offered for the user to run themselves. */
  command?: string
}

/** Longest content preview shipped to the approval card — enough to judge the
 *  write without inlining a whole file into the IPC payload every step. */
const APPROVAL_PREVIEW_CHARS = 3000

/**
 * Human summary of a write/command action, shown on the approval card, plus the
 * payload the card previews so the user can review before approving instead of
 * OKing blind. `conteudo` is capped at APPROVAL_PREVIEW_CHARS; `comando` is the
 * full command (short by nature). `.resumo` is the one-line label the log uses.
 *
 * `opts.oldContent` is the file's current bytes on disk (null = the file is new
 * or was unreadable), passed in rather than read here so this stays pure/sync
 * and testable: given it, `diff` is old→new for the card to colour. `irreversivel`
 * flags an overwrite so the card can warn (the old bytes are gone once written).
 * A command is NOT flagged — most are harmless (npm test) and reddening every
 * one is alarm fatigue; the card shows the full command instead.
 */
function describeCodeAction(
  name: string,
  args: Record<string, unknown>,
  opts?: { oldContent?: string | null }
): {
  resumo: string
  conteudo?: string
  comando?: string
  diff?: DiffLineItem[]
  diffTruncated?: boolean
  irreversivel?: boolean
} {
  if (name === 'escrever_arquivo') {
    const caminho = typeof args.caminho === 'string' ? args.caminho : '?'
    const existing = opts?.oldContent ?? null
    const overwrite = existing !== null

    // Batch edit mode: several procura→substitui patches in one call.
    const edicoes = Array.isArray(args.edicoes) ? args.edicoes : []
    if (edicoes.length > 0) {
      const verbs = overwrite ? 'Editar' : 'Criar'
      const plural = edicoes.length !== 1 ? 's' : ''
      const preview = edicoes
        .map((e) => `- "${typeof e.procura === 'string' ? String(e.procura).slice(0, 60) : '?'}" → "${typeof e.substitui === 'string' ? String(e.substitui).slice(0, 60) : '?'}"`)
        .join('\n')
      let diff: DiffLineItem[] | undefined
      let diffTruncated: boolean | undefined
      if (overwrite) {
        const patched = edicoes.reduce(
          (text, ed) =>
            typeof ed.procura === 'string' && typeof ed.substitui === 'string'
              ? text.replace(ed.procura, ed.substitui)
              : text,
          existing
        )
        const d = lineDiff(existing, patched)
        if (!d.skipped && d.lines.length) {
          diff = d.lines
          diffTruncated = d.truncated
        }
      }
      return {
        resumo: `${verbs} arquivo ${caminho} (${edicoes.length} mudança${plural})`,
        conteudo: preview.slice(0, APPROVAL_PREVIEW_CHARS),
        diff,
        diffTruncated,
        irreversivel: overwrite
      }
    }

    // Single patch mode: procura + substitui.
    const procura = typeof args.procura === 'string' && args.procura ? args.procura : ''
    const substitui = typeof args.substitui === 'string' ? args.substitui : ''
    if (procura || substitui) {
      const verbs = overwrite ? 'Editar' : 'Criar'
      const qSearch = procura.slice(0, 80)
      const qReplace = substitui.slice(0, 80)
      let diff: DiffLineItem[] | undefined
      let diffTruncated: boolean | undefined
      if (overwrite) {
        const patched = existing.replace(procura, substitui)
        const d = lineDiff(existing, patched)
        if (!d.skipped && d.lines.length) {
          diff = d.lines
          diffTruncated = d.truncated
        }
      }
      return {
        resumo: `${verbs} arquivo ${caminho}: "${qSearch}" → "${qReplace}"`,
        conteudo: `"${qSearch}" → "${qReplace}"`.slice(0, APPROVAL_PREVIEW_CHARS),
        diff,
        diffTruncated,
        irreversivel: overwrite
      }
    }

    // Full content mode: escreve o arquivo inteiro (existing behaviour).
    const conteudo = typeof args.conteudo === 'string' ? args.conteudo : ''
    const bytes = Buffer.byteLength(conteudo, 'utf-8')
    let diff: DiffLineItem[] | undefined
    let diffTruncated: boolean | undefined
    if (overwrite) {
      const d = lineDiff(existing, conteudo)
      if (!d.skipped && d.lines.length) {
        diff = d.lines
        diffTruncated = d.truncated
      }
    }
    return {
      resumo: `${overwrite ? 'Sobrescrever' : 'Criar'} arquivo ${caminho} (${bytes} bytes)`,
      conteudo: conteudo.slice(0, APPROVAL_PREVIEW_CHARS),
      diff,
      diffTruncated,
      irreversivel: overwrite
    }
  }
  if (name === 'executar_comando') {
    const comando = typeof args.comando === 'string' ? args.comando : '?'
    return { resumo: `Executar comando: ${comando}`, comando }
  }
  return { resumo: name }
}

/** Stop one or all running agents: abort the loop and deny any parked approval. */
function stopCodeAgent(runId?: string): void {
  if (runId) {
    const run = codeRuns.get(runId)
    if (run) {
      run.abort = true
      for (const resolve of run.pendingApprovals.values()) resolve(false)
      run.pendingApprovals.clear()
    }
  } else {
    for (const run of codeRuns.values()) {
      run.abort = true
      for (const resolve of run.pendingApprovals.values()) resolve(false)
      run.pendingApprovals.clear()
    }
  }
}

/**
 * One round-trip to the provider for the code agent. Non-streaming on purpose:
 * assembling tool_calls from an SSE stream is the fiddly part the chat path
 * already carries, and the code agent gains reliability (and simpler code) by
 * taking the whole message at once — the panel still shows each tool_call the
 * instant this returns.
 */
async function callCodeModel(
  cfg: { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string },
  messages: AgentMessage[],
  tools: CodeToolDef[]
): Promise<{ message: AgentMessage; usage?: TokenUsage }> {
  const client = getOpenAIClient(cfg.baseUrl, cfg.apiKey)
  const res = await client.chat.completions.create(
    {
      model: cfg.model,
      // The wire shape matches OpenAI's; our AgentMessage is a strict subset.
      messages: messages as unknown as Parameters<
        typeof client.chat.completions.create
      >[0]['messages'],
      ...(tools.length
        ? {
            tools: tools as unknown as Parameters<
              typeof client.chat.completions.create
            >[0]['tools'],
            tool_choice: 'auto' as const
          }
        : {}),
      ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort as 'low' | 'medium' | 'high' } : {})
    },
    requestOptions(loadAIConfig().timeoutMs)
  )
  const m = res.choices?.[0]?.message
  const toolCalls = (m?.tool_calls ?? []).filter(
    (c) => c.type === 'function'
  ) as unknown as CodeToolCall[]
  return {
    message: {
      role: 'assistant',
      content: typeof m?.content === 'string' ? m.content : '',
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    },
    usage: toUsage(res.usage)
  }
}

/**
 * Recognise a bubblewrap failure that leaves the agent's commands running
 * nothing — the sandbox couldn't even start, so the command did nothing whatever
 * the agent intended.
 *
 * The case: ai-jail confines the code agent's shell commands with bubblewrap,
 * which needs unprivileged user namespaces, and Ubuntu 23.10+ blocks those by
 * AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`, the default on
 * 24.04). The command then fails with `bwrap: … Operation not permitted` /
 * `needs access to create user namespaces` — opaque unless named. detectAiJail's
 * smoke test catches this before a run starts when the sandbox is active, but the
 * marker can still surface mid-run (a cached detection, or the agent's own
 * command invoking bwrap/containers with the sandbox off), so the runner watches
 * for it too and raises the panel hint card with the one-line fix.
 *
 * Pure and string-only so it can be tested without spawning anything.
 */
export function detectAgentHint(output: string): AgentHint | null {
  const sandboxBroken =
    /needs access to create user namespaces/i.test(output) ||
    /bwrap:/i.test(output) ||
    /Failed RTM_NEWADDR/i.test(output)
  if (sandboxBroken) {
    return {
      title: 'O sandbox (ai-jail) não conseguiu iniciar — os comandos falharam.',
      detail:
        'O ai-jail isola os comandos com bubblewrap, que precisa de user namespaces ' +
        'sem privilégio. O Ubuntu 23.10+ (e derivados) bloqueia isso por AppArmor, ' +
        'então o comando não chegou a rodar. Rode o comando abaixo e tente de novo — ' +
        'ou desative o Sandbox nas configurações (por sua conta e risco).',
      command: 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'
    }
  }
  return null
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

// NOTE: the external-agent path (buildAgentCommand / spawn / sandbox flags /
// killCodeAgent) was removed when the native code agent (./code-agent) replaced
// it. `detectAgentHint` above is wired into the native run handler's command
// runner (a bwrap failure raises the panel hint card). `resolveExecutable` is
// a dormant helper — kept with its unit test, deletable in a follow-up.

// --- AI config (persisted to ai-config.json in userData, not the DB) ---
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
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
  /**
   * A separate provider for the native code agent (the loop in ./code-agent).
   * Any field left empty falls back to the chat config above — so a user who
   * wants one model for chat and a stronger one for editing sets only what
   * differs, and a user who wants the same for both sets nothing here.
   */
  codeAgent?: {
    baseUrl?: string
    apiKey?: string
    model?: string
  }
  /**
   * Whether the ai-jail sandbox is required for the code agent's shell commands.
   * **Absent means enabled** (mandatory by default) — so a fresh install is
   * safe-by-default and only an explicit `false` (the user unticked the box,
   * accepting the risk) runs commands unsandboxed. See ./ai-jail.
   */
  sandboxEnabled?: boolean
  /**
   * Set once the user has answered the sandbox onboarding (installed it, or
   * clicked "Depois"), so the modal doesn't reappear every time the AI view
   * opens. A machine that already had ai-jail skips onboarding regardless.
   */
  sandboxOnboardingDismissed?: boolean
  /**
   * DeepSeek reasoning_effort parameter. Controls how much reasoning the model
   * does before answering. One of 'low', 'medium', 'high'. Applied to every
   * model call (chat and code agent) when set.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

const DEFAULT_AI_CONFIG: AIConfig = { baseUrl: '', apiKey: '', model: '' }

/**
 * The provider the code agent should use: its own fields where set, the chat
 * config where not. Kept here (not in the renderer) because the loop runs in
 * main — the renderer only edits the config, it never runs the agent.
 */
function resolveCodeAgentConfig(cfg: AIConfig): { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string } {
  const ca = cfg.codeAgent ?? {}
  const pick = (a: string | undefined, b: string): string => (a && a.trim() ? a.trim() : b)
  return {
    baseUrl: pick(ca.baseUrl, cfg.baseUrl),
    apiKey: pick(ca.apiKey, cfg.apiKey),
    model: pick(ca.model, cfg.model),
    reasoningEffort: cfg.reasoningEffort
  }
}
const aiConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

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
  raw: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number // DeepSeek
    prompt_tokens_details?: { cached_tokens?: number } // OpenAI
    completion_tokens_details?: { reasoning_tokens?: number } // DeepSeek reasoning
    reasoning_tokens?: number // some providers at top level
  } | undefined | null
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

function loadAIConfig(): AIConfig {
  try {
    return { ...DEFAULT_AI_CONFIG, ...JSON.parse(readFileSync(aiConfigPath(), 'utf-8')) }
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

function saveAIConfig(config: AIConfig): void {
  writeFileSync(aiConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

// --- ai-jail sandbox (see ./ai-jail) ---
//
// Detection is cached: it spawns `ai-jail --version` across a few candidate
// paths, which is cheap but not free, and the answer only changes when the user
// installs it. `refresh` re-runs it (after an install, or when the UI asks).
let jailStatusCache: JailStatus | null = null
async function getJailStatus(refresh = false): Promise<JailStatus> {
  if (!jailStatusCache || refresh) jailStatusCache = await detectAiJail(defaultExec)
  return jailStatusCache
}

/** Whether the sandbox is required for this run (default on; explicit false = off). */
function sandboxRequired(cfg: AIConfig): boolean {
  return cfg.sandboxEnabled !== false
}

/** Fetch a small text file (the .sha256 sidecar) for the installer. */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`)
  return res.text()
}

/**
 * Download `url` into `dest`, reporting byte progress. Buffered in memory then
 * written once — the asset is a few MB, and this keeps a partial file off disk
 * if the transfer fails midway (the caller checksums it before installing).
 */
async function downloadTo(
  url: string,
  dest: string,
  onBytes: (received: number, total: number | null) => void
): Promise<number> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ao baixar ${url}`)
  const total = Number(res.headers.get('content-length')) || null
  let received = 0
  const chunks: Buffer[] = []
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk)
    chunks.push(buf)
    received += buf.length
    onBytes(received, total)
  }
  writeFileSync(dest, Buffer.concat(chunks))
  return received
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

/**
 * Lazy decay pass: archive cold/overflowing memories and return how many. Used
 * by both the explicit `ai:memory:prune` and the run-start briefing, so the two
 * can't drift. Global (not per-project) — a cold page is cold regardless of the
 * project a run happens to be about.
 */
function runMemoryPrune(): number {
  const now = Date.now()
  const stale = selectStale(listMemories({ includeArchived: false }), now)
  archiveMemories(stale, new Date(now).toISOString())
  return stale.length
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
          try { unlinkSync(p) } catch { /* best-effort */ }
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
async function archiveAgentRun(runId: string, exitCode: number): Promise<void> {
  const run = codeRuns.get(runId)
  if (!run) return
  try {
    const diff = run.base ? await diffSince(run.base) : null
    const snapshot: AgentRunSnapshot = {
      id: run.id,
      convId: run.convId,
      agent: run.agent,
      dir: run.dir,
      task: run.task,
      startedAt: run.startedAt,
      endedAt: Date.now(),
      exitCode,
      fileCount: diffFileCount(diff),
      // Frozen with the run so the picker can show what a past run cost.
      tokens: { ...run.usage },
      log: run.log,
      diff
    }
    const path = agentRunPath(run.id)
    if (!path) return
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
    mainWindow?.webContents.send('ai:code-agent:archived', { runId: run.id, id: meta.id, convId: run.convId })
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
  } catch {
    /* archiving is a convenience; the run itself already happened */
  }
  // Run state already cleaned from codeRuns in the finally block;
  // survivors (lastRunLog etc.) persist for status() backward compat.
}

// --- Skills (.md files in userData/skills/) ---

const skillsPath = (): string => skillsDir(app.getPath('userData'))

// --- AI chat history (persisted to ai-conversations.json in userData) ---
interface StoredConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: {
    role: 'user' | 'assistant' | 'status'
    content: string
    /** Chat-image ids; the bytes live under chat-images/. Absent on old files. */
    imageIds?: string[]
    /** Status lines: whether the tool finished. See ChatMessage.done. */
    done?: boolean
    /**
     * Status lines: the step that produced the line and the cap it ran under,
     * rendered as a "3/40" badge. Both stored, so an old transcript keeps the
     * cap *that* run had rather than being relabelled against today's setting.
     * Absent on old files and on lines that aren't a step (retries, warnings).
     */
    step?: number
    maxSteps?: number
  }[]
  /** Tokens billed across this conversation's whole life. Absent on old files. */
  usage?: TokenUsage
  /**
   * The user named this chat, so `title` is theirs to keep.
   *
   * Titles are otherwise derived from the first user message on every autosave,
   * which would overwrite a rename within the second. The flag lives here and
   * is enforced in `ai:conversations:save` rather than in the renderer: the
   * autosave keeps sending its derived title and this side ignores it once the
   * name is the user's. Absent on old files — an underived title is just a
   * title, and stays derivable until someone renames it.
   */
  titleCustom?: boolean
}

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
}

/**
 * Remove stale conversations, along with their chat-image files.
 *
 * Two rules, applied in order:
 * 1. Conversations last active more than 14 days ago are dropped.
 * 2. If more than MAX_CONVERSATIONS remain, the oldest ones are dropped.
 *
 * Hard delete — there is no archive or undo.  The motivation is a
 * history that grows unboundedly with every chat, where most of it
 * is stale and never reopened.
 */
const PRUNE_CONVERSATION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_CONVERSATIONS = 50

function pruneConversations(): void {
  const all = loadConversations()
  if (all.length === 0) return

  // Newest first — both rules keep the most recent chats.
  const sorted = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const cutoff = new Date(Date.now() - PRUNE_CONVERSATION_TTL_MS)
  const keep: StoredConversation[] = []
  const prune: StoredConversation[] = []

  for (const c of sorted) {
    const updated = new Date(c.updatedAt)
    if (updated >= cutoff && keep.length < MAX_CONVERSATIONS) {
      keep.push(c)
    } else {
      prune.push(c)
    }
  }

  if (prune.length === 0) return

  // Collect image ids from pruned conversations that no kept conversation
  // still references — otherwise we'd delete a shared image.
  const keptImageIds = new Set(keep.flatMap((c) => c.messages.flatMap((m) => m.imageIds ?? [])))
  const prunedImageIds = prune.flatMap((c) => c.messages.flatMap((m) => m.imageIds ?? []))
  const orphanIds = [...new Set(prunedImageIds)].filter((id) => !keptImageIds.has(id))
  const toDelete = orphanIds
    .map((id) => chatImagePath(id))
    .filter((p): p is string => p !== null)

  for (const full of toDelete) {
    try {
      if (existsSync(full)) unlinkSync(full)
    } catch {
      /* already gone or locked — not worth failing over */
    }
  }

  // Same for chat document files.
  const keptDocIds = new Set(keep.flatMap((c) => c.messages.flatMap((m) => (m as { documentIds?: string[] }).documentIds ?? [])))
  const prunedDocIds = prune.flatMap((c) => c.messages.flatMap((m) => (m as { documentIds?: string[] }).documentIds ?? []))
  const orphanDocIds = [...new Set(prunedDocIds)].filter((id) => !keptDocIds.has(id))
  const docFilesDir = chatFilesDir()
  const toDeleteDocs = orphanDocIds.map((id) => {
    if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(id)) return null
    const full = join(docFilesDir, id)
    return full.startsWith(docFilesDir + sep) ? full : null
  }).filter((p): p is string => p !== null)

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
  _saveQueue = _saveQueue.then(() => { op() })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Sagyou',
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  mainWindow.on('maximize', () => mainWindow!.webContents.send('window:maximized-change', true))
  mainWindow.on('unmaximize', () => mainWindow!.webContents.send('window:maximized-change', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.commandLine.appendSwitch('lang', 'pt-BR')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sagyou')

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

  registerBackupHandlers(ipcMain, {
    dialog,
    filesDir,
    chatImagesDir: chatImagesDir(),
    taskImagesDir: taskImagesDir(),
    sep,
    chatImagePath,
    taskImagePath
  })

  ipcMain.handle('ai:config:get', () => loadAIConfig())

  ipcMain.handle('ai:config:set', (_, config: AIConfig) => {
    saveAIConfig(config)
  })

  // ai-jail: current status merged with the user's config, for the toggle and
  // the onboarding dialog. `refresh` re-runs detection (e.g. after an install).
  ipcMain.handle('ai:jail:status', async (_, refresh?: boolean) => {
    const s = await getJailStatus(refresh === true)
    const cfg = loadAIConfig()
    return {
      ...s,
      enabled: sandboxRequired(cfg),
      onboardingDismissed: cfg.sandboxOnboardingDismissed === true,
      wslCommand: WSL_INSTALL_COMMAND,
      // The commands to install ai-jail inside an existing WSL2 (shown once WSL2
      // is present but ai-jail isn't).
      wslAiJailCommands: WSL_AI_JAIL_INSTALL_COMMANDS
    }
  })

  // Install ai-jail for this platform, streaming progress. On success the
  // sandbox is turned on and onboarding is marked done, so the safe path is the
  // default the moment it can be enforced.
  ipcMain.handle('ai:jail:install', async () => {
    const deps: InstallDeps = { exec: defaultExec, download: downloadTo, fetchText }
    const res = await installAiJail(deps, (p) =>
      mainWindow?.webContents.send('ai:jail:progress', p)
    )
    if (res.success) {
      await getJailStatus(true) // refresh the cache off the fresh install
      const cfg = loadAIConfig()
      saveAIConfig({ ...cfg, sandboxEnabled: true, sandboxOnboardingDismissed: true })
    }
    return res
  })

  // The user answered onboarding without installing ("Depois"): remember it so
  // the modal doesn't reappear, but leave the sandbox required (the agent's
  // command tool stays blocked until ai-jail exists or the box is unticked).
  ipcMain.handle('ai:jail:dismiss-onboarding', () => {
    saveAIConfig({ ...loadAIConfig(), sandboxOnboardingDismissed: true })
  })

  ipcMain.handle('ai:usage:summary', () => summarize(loadUsageLog()))

  ipcMain.handle('ai:run-metrics:append', (_, input: RunMetricInput) => appendRunMetricIO(input))
  ipcMain.handle('ai:run-metrics:summary', () => summarizeRunMetrics(loadRunMetrics()))

  // --- AI memory (durable facts across conversations; kanban.db, outside
  // persistAll — see store.ts). save scrubs secrets in buildMemory; prune
  // archives cold pages (never hard-deletes); delete is the explicit user act.
  ipcMain.handle(
    'ai:memory:list',
    (_, opts?: { projectId?: string | null; includeArchived?: boolean }) => {
      if (opts?.includeArchived)
        return listMemories({ projectId: opts.projectId, includeArchived: true })
      if (opts && 'projectId' in opts) return memoriesForContext(opts.projectId ?? null)
      return listMemories()
    }
  )

  ipcMain.handle('ai:memory:save', (_, input: MemoryInput & { id?: string }) => {
    const existing = input.id ? getMemory(input.id) : null
    const res = buildMemory(existing, input, randomUUID(), new Date().toISOString())
    if ('error' in res) return res
    upsertMemory(res.memory)
    return { memory: res.memory, redacted: res.redacted }
  })

  ipcMain.handle('ai:memory:delete', (_, id: string) => deleteMemory(id))

  // Wholesale replace from a backup import (projects are imported first, so FK
  // scoping holds; see replaceMemories).
  ipcMain.handle('ai:memory:replace', (_, list: unknown) =>
    replaceMemories(Array.isArray(list) ? list : [])
  )

  ipcMain.handle('ai:memory:touch', (_, ids: string[]) =>
    touchMemories(Array.isArray(ids) ? ids : [], new Date().toISOString())
  )

  // Lazy decay pass: archive stale/overflowing pages, return how many.
  ipcMain.handle('ai:memory:prune', () => ({ archived: runMemoryPrune() }))

  // Automatic per-run handoff: one memory per project (deterministic id), upserted
  // at each run's end so a later session opens knowing where this one left off.
  // Writing it keeps it warm — lastAccessedAt = now, but access_count is NOT
  // bumped, so its TTL stays at the base and it decays ~45d after the last run on
  // this project (i.e. when the project goes quiet), instead of ballooning.
  ipcMain.handle(
    'ai:memory:handoff',
    (_, input: { projectId?: string | null; title: string; body: string }) => {
      const projectId = typeof input?.projectId === 'string' ? input.projectId : null
      const id = handoffId(projectId)
      const now = new Date().toISOString()
      const res = buildMemory(
        getMemory(id),
        { type: 'handoff', title: input?.title, body: input?.body, projectId, source: 'modelo' },
        id,
        now
      )
      if ('error' in res) return res
      res.memory.lastAccessedAt = now // writing is accessing; don't inflate the count
      upsertMemory(res.memory)
      return { ok: true }
    }
  )

  ipcMain.handle('ai:memory:summary', () =>
    summarizeMemories(listMemories({ includeArchived: true }))
  )

  ipcMain.handle('ai:memory:conflicts', () => findConflicts(listMemories()))

  // The run-start briefing block for a project (its memories + the globals),
  // preformatted so the chat and the code agent share one format. Reading the
  // briefing is decay-neutral (no touch), but run start is where the lazy decay
  // pass fires: archive cold pages first, then brief on the survivors. `archived`
  // rides back so the chat can note it. Prune is guarded — a decay failure must
  // not cost the run its briefing.
  ipcMain.handle('ai:memory:briefing', (_, projectId?: string | null) => {
    let archived = 0
    try {
      archived = runMemoryPrune()
    } catch {
      /* decay is best-effort; a failure here still leaves a valid briefing */
    }
    const memories = memoriesForContext(projectId ?? null)
    return {
      text: formatMemoriesForPrompt(memories),
      count: memories.filter((m) => !m.archivedAt).length,
      archived
    }
  })

  // Entity lineage: query the event log for one entity's history.
  ipcMain.handle(
    'ai:lineage:list',
    (_, entityType: string, entityId: string) => eventsForEntity(entityType, entityId)
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
        baseUrl?: string
        apiKey?: string
      }
    ) => {
      const config = loadAIConfig()
      const baseURL = request.baseUrl || config.baseUrl
      const apiKey = request.apiKey || config.apiKey
      const model = request.model || config.model
      if (!baseURL || !model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      try {
        const client = getOpenAIClient(baseURL, apiKey)
        const body = {
          model,
          messages: request.messages,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {})
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
        baseUrl?: string
        apiKey?: string
      }
    ) => {
      const config = loadAIConfig()
      const baseURL = request.baseUrl || config.baseUrl
      const apiKey = request.apiKey || config.apiKey
      const model = request.model || config.model
      if (!baseURL || !model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      try {
        const client = getOpenAIClient(baseURL, apiKey)
        const body = {
          model,
          messages: request.messages,
          stream: true,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {})
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
  ipcMain.handle('ai:models', async (_, request: { baseUrl?: string; apiKey?: string }) => {
    const config = loadAIConfig()
    const baseURL = request.baseUrl || config.baseUrl
    const apiKey = request.apiKey || config.apiKey
    if (!baseURL) return { success: false, error: 'Base URL não configurada' }
    try {
      const client = getOpenAIClient(baseURL, apiKey)
      const page = await client.models.list(requestOptions(config.timeoutMs))
      const models = Array.from(
        new Set(
          (page.data ?? [])
            .map((m) => m?.id)
            .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        )
      ).sort((a, b) => a.localeCompare(b))
      return { success: true, models }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Falha ao carregar modelos' }
    }
  })

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
        /** Scope decisions already agreed with the user, honoured without re-deciding. */
        decisoes?: string[]
        /** The chat that asked, so the run can be reopened from it later. */
        convId?: string
        /** The project whose memory to brief the agent with (shared with the chat). */
        projectId?: string | null
        /** Start in auto-approval mode — approve() returns true without IPC. */
        autoApprove?: boolean
      }
    ) => {
      const dir = request.path
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
      // Cleanup worktrees órfãos (que sobraram de uma queda do app)
      try {
        const { stdout: wtList } = await execAsync(`cd "${dir}" && git worktree list --porcelain 2>nul`)
        for (const line of wtList.split('\n')) {
          if (line.startsWith('worktree ') && line.includes('.sagyou-wt-')) {
            const orphanPath = line.slice(9).trim()
            if (orphanPath && existsSync(orphanPath)) {
              await execAsync(`cd "${dir}" && git worktree remove --force "${orphanPath}" 2>nul`).catch(() => {})
            }
          }
        }
      } catch {
        // Se não é git ou não há worktrees, ignora
      }

      // Fase 2(b): se o dir já está ocupado, cria um git worktree isolado
      const runId = randomUUID()
      let worktreeDir: string | null = null
      if (codeAgentDirs.has(dir)) {
        worktreeDir = join(dir, `.sagyou-wt-${runId}`)
        try {
          const { stdout: wtCheck } = await execAsync(`git -C "${dir}" rev-parse --show-toplevel 2>nul || echo not-git`)
          if (wtCheck.trim() === 'not-git') throw new Error('Not a git repo')
          await execAsync(`cd "${dir}" && git worktree add --detach "${worktreeDir}" HEAD 2>/dev/null`)
        } catch {
          return {
            success: false,
            error:
              'Já existe um agente de código rodando neste diretório e não foi possível criar um worktree. ' +
              'Finalize o agente atual primeiro ou certifique-se de que o projeto é um repositório git.'
          }
        }
      }
      const effectiveDir = worktreeDir ?? dir
      const task = typeof request.task === 'string' ? request.task.trim() : ''
      if (!task) return { success: false, error: 'Tarefa vazia' }
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
      // Scope decisions the chat already settled with the user — plain strings,
      // no path involved, so just clean and pass them into the prompt.
      const decisoes = Array.isArray(request.decisoes)
        ? request.decisoes
            .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
            .map((d) => d.trim())
        : []
      const cfg = loadAIConfig()
      if (!cfg.baseUrl || !cfg.model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      // The code agent's provider: its own fields, falling back to the chat's.
      const caCfg = resolveCodeAgentConfig(cfg)

      // ⚠️ Sandbox gate. The sandbox is mandatory by default; when it's required
      // but ai-jail isn't available, the run is refused rather than run
      // unconfined — the agent's shell commands have no other OS-level barrier.
      // The user's way through is to install ai-jail (onboarding) or untick the
      // Sandbox box (accepting the risk). On Windows this is the WSL2 case.
      //
      // Detection only runs when the sandbox is on: if the user turned it off
      // there's nothing to enforce, and probing (which spawns `ai-jail`/`wsl`)
      // would be wasted work — a plain unsandboxed run needs none of it.
      const sandboxOn = sandboxRequired(cfg)
      const jail = sandboxOn ? await getJailStatus() : null
      if (sandboxOn && !jail?.available) {
        return {
          success: false,
          error:
            (jail?.reason
              ? `O sandbox (ai-jail) está ativo, mas não pôde ser usado: ${jail.reason} `
              : 'O sandbox (ai-jail) está ativo, mas não está instalado/disponível. ') +
            'Instale/ajuste o ai-jail na tela do Assistente, ou desative o Sandbox nas configurações do Agente de Código.',
          status: 400
        }
      }

      // Create the run state and register it — a new run starts fresh.
      // (runId foi criado acima, antes do worktree)
      const run: CodeRunState = {
        id: runId,
        dir,
        convId: typeof request.convId === 'string' && request.convId ? request.convId : null,
        agent: caCfg.model || 'nativo',
        task: taskLabel(task),
        startedAt: Date.now(),
        abort: false,
        log: '',
        base: await captureBase(effectiveDir),
        hint: null,
        model: caCfg.model,
        usage: { promptTokens: 0, completionTokens: 0 },
        step: 0,
        maxSteps: CODE_AGENT_MAX_STEPS,
        pendingApprovals: new Map(),
        autoApprove: typeof request.autoApprove === 'boolean' ? request.autoApprove : false,
        worktreeDir: worktreeDir
      }
      codeRuns.set(runId, run)
      codeAgentDirs.add(dir)

      const send = (channel: string, data: unknown): void =>
        mainWindow?.webContents.send(channel, data)
      // Push the live progress (step + running token total) to the panel's
      // counter. Cheap and idempotent; fired on each step and each usage report.
      send('ai:code-agent:started', { runId, dir })
      const pushProgress = (): void =>
        send('ai:code-agent:progress', {
          runId,
          step: run.step,
          maxSteps: run.maxSteps,
          promptTokens: run.usage.promptTokens,
          completionTokens: run.usage.completionTokens
        })
      // Stream it and keep it: the panel may not be mounted to hear this.
      const emit = (chunk: string): void => {
        appendAgentLog(runId, chunk)
        send('ai:code-agent:output', { runId, chunk })
      }

      // Opening banner: the REAL model in use (task 11), and which files were
      // pinned vs left for the agent to discover with buscar_no_codigo.
      const rel = files.map((f) => relative(effectiveDir, f) || f)
      emit(`[sagyou] agente nativo · modelo: ${caCfg.model} @ ${caCfg.baseUrl}\n`)
      // Say plainly whether the shell is confined. `sandboxOn && jail.available`
      // is the only combination that wraps commands (the gate above refused the
      // dangerous "required but missing" case), so a false here means the user
      // deliberately turned the sandbox off.
      const sandboxActive = sandboxOn && !!jail?.available && !!jail?.path
      emit(
        sandboxActive
          ? `[sagyou] sandbox: ai-jail ATIVO — comandos confinados à pasta do projeto\n`
          : `[sagyou] ⚠️ sandbox: DESATIVADO — comandos rodam sem confinamento\n`
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

      // When files are pinned, inline their contents (numbered) into the prompt
      // so the agent edits from context instead of spending a read step per file
      // — and the discovery tools are dropped below (codeToolsFor). Files too big
      // to inline are named so the agent (and the log) knows to page them.
      let fileContents = ''
      if (files.length) {
        const inlined: InlinedFile[] = []
        for (const abs of files) {
          try {
            inlined.push({ path: relative(effectiveDir, abs) || abs, content: await readFile(abs, 'utf-8') })
          } catch {
            /* unreadable pinned file — the agent can still ler_arquivo it on demand */
          }
        }
        const block = inlineFilesBlock(inlined)
        fileContents = block.text
        if (block.omitted.length) {
          emit(
            `[sagyou] ${block.omitted.length} arquivo(s) grande(s) só parcialmente no contexto ` +
              `(o agente lê o resto sob demanda):\n` +
              block.omitted.map((f) => `  · ${f}\n`).join('')
          )
        }
      }
      emit('\n')

      // Assemble the system prompt: GUIDE.md/AGENTS.md if the repo has one (capped
      // at 3000 chars — the full file can be 27k and is re-sent every step), a
      // compact file tree, and the pinned files.
      const rawGuide = readProjectGuide(effectiveDir)
      const guide = rawGuide.length > 3000
        ? rawGuide.slice(0, 3000) + '\n\n…(primeiros 3000 caracteres; use ler_arquivo para o resto)'
        : rawGuide
      const [tree] = [await dirTree(effectiveDir)]
      // Brief the agent with this project's memory (shared with the chat), so a
      // code run benefits from decisions/gotchas recorded in conversation.
      // Best-effort: a memory failure must never abort a run the user asked for.
      //
      // When files are pinned, the scope is already resolved — skip the briefing
      // to save tokens. The model already knows what to edit from the pinned
      // files and the task description, so historical context is dead weight.
      const hasPinnedFiles = Array.isArray(request.files) && request.files.length > 0
      let memories = ''
      if (!hasPinnedFiles) {
        try {
          memories = formatMemoriesForPrompt(
            memoriesForContext(typeof request.projectId === 'string' ? request.projectId : null),
            5 // injectMax: show full body for ≤5, title-only above
          )
        } catch {
          /* memory is best-effort; briefing failure leaves the prompt as-is */
        }
      }
      // Also brief the agent with past conversations about this same task, so it
      // reuses decisions/gotchas already discussed. Exclude the chat that fired
      // the run — it doesn't need its own transcript pasted back. Best-effort,
      // same as memory: a search failure just omits the section.
      let conversas = ''
      if (!hasPinnedFiles) {
        try {
          conversas = briefConversationsForTask(loadConversations(), task, {
            excludeId: typeof request.convId === 'string' ? request.convId : null
          })
        } catch {
          /* conversation briefing is best-effort; a failure leaves the prompt as-is */
        }
      }
      // If the user explicitly said Node/commands aren't available, disable the
      // BEHAVIOR rule that tells the agent to run typecheck — the agent would try,
      // hit 127, and spiral retrying.
      const noCommands = decisoes.some((d) =>
        /n(ã|a)o.*(node|npm|comando|typecheck|teste|rodar|execute|dispon[ií]vel|bin[aá]rio)/i.test(d)
      )
      const systemPrompt = buildSystemPrompt({
        tree,
        guide,
        files: rel,
        fileContents,
        memories,
        conversas,
        decisoes,
        noCommands
      })

      // Approval round-trip: the loop parks here, the renderer shows a card and
      // answers through ai:code-agent:approve-response. A stopped run denies all.
      // For a write, read the file's current bytes first (confined to the root,
      // same barrier as everything else) so describeCodeAction can diff old→new
      // — the read is async and off the loop's hot path, so it's done up front,
      // then the promise only holds the pending resolver.
      const approve = async (call: {
        name: string
        args: Record<string, unknown>
      }): Promise<boolean> => {
        if (run.abort) return false
        if (run.autoApprove) return true
        let oldContent: string | null = null
        if (call.name === 'escrever_arquivo' && typeof call.args.caminho === 'string') {
          const abs = confineToRoot(effectiveDir, call.args.caminho)
          if (abs && existsSync(abs) && statSync(abs).isFile()) {
            try {
              oldContent = await readFile(abs, 'utf-8')
            } catch {
              /* unreadable — treat as a new file; the diff is just skipped */
            }
          }
        }
        const desc = describeCodeAction(call.name, call.args, { oldContent })
        return new Promise<boolean>((resolveApproval) => {
          if (run.abort) return resolveApproval(false)
          const id = randomUUID()
          run.pendingApprovals.set(id, resolveApproval)
          send('ai:code-agent:approve-request', {
            runId,
            id,
            name: call.name,
            args: call.args,
            ...desc
          })
        })
      }

      // The command runner: wrap every shell command with ai-jail when the
      // sandbox is active, and decorate the output when a failure looks like the
      // sandbox blocking an escape. Otherwise it's the plain runner.
      const jailBin = jail?.path ?? null
      // Raise the panel hint card the first time a command's output shows a
      // bwrap/user-namespace failure. The runner is the one place with the full
      // stdout/stderr — the panel only gets the one-line tool summary, which
      // never carries these markers. `send` pushes it so the card can appear
      // mid-run; the exit fetch and status poll pick it up as well.
      const noteEnvHint = (output: string): void => {
        if (run.hint) return
        const hint = detectAgentHint(output)
        if (hint) {
          run.hint = hint
          send('ai:code-agent:hint', { runId, ...hint })
        }
      }
      const runner: CommandRunner = async (command, o) => {
        // Sandbox off: no ai-jail wrapping, but still watch for a bwrap failure
        // the agent's own command may trigger (e.g. it runs a container tool).
        if (!sandboxActive || !jailBin) {
          const out = await defaultCommandRunner(command, o)
          if (out.code !== 0) noteEnvHint(`${out.stdout}\n${out.stderr}`)
          return out
        }
        // Windows runs the command through WSL (jail.viaWsl); Linux/macOS wrap it
        // in a native shell. Both confine writes to the project via ai-jail.
        const out = jail?.viaWsl
          ? await runSandboxedWsl(jailBin, o.cwd, command, o.timeoutMs)
          : await defaultCommandRunner(wrapCommand(jailBin, o.cwd, command), o)
        if (out.code !== 0) {
          const combined = `${out.stdout}\n${out.stderr}`
          // A user-namespace failure means the sandbox couldn't even START — the
          // command ran nothing. That is NOT an escape attempt, so surface the
          // actionable hint and skip the "tried to leave the project" note that
          // `looksLikeSandboxBlock` (which also matches `bwrap:`) would add.
          if (detectAgentHint(combined)) noteEnvHint(combined)
          else if (looksLikeSandboxBlock(combined)) {
            out.stderr = `⛔ ai-jail bloqueou este comando — tentou acessar fora do projeto.\n${out.stderr}`
          }
        }
        return out
      }

      // Fire-and-forget from the renderer's side: return
      // success once the run has started; the outcome streams to the panel.
      void (async (): Promise<void> => {
        let exitCode = 0
        try {
          const result = await runCodeAgent(
            systemPrompt,
            task,
            { root: effectiveDir, run: runner },
            {
              callModel: (messages, tools) => callCodeModel(caCfg, messages, tools),
              approve,
              // Pinned files → drop the discovery tools (grep/list): the agent was
              // handed the targets and their contents, so re-finding them is pure
              // waste of the step budget.
              tools: codeToolsFor({ pinnedFiles: files.length > 0 }),
              maxSteps: CODE_AGENT_MAX_STEPS,
              shouldAbort: () => run.abort,
              onStep: (step, max) => {
                run.step = step
                run.maxSteps = max
                pushProgress()
              },
              onText: (text) => emit(`\n${text}\n`),
              onToolCall: (name, args) => {
                emit(`\n[tool] ${describeCodeAction(name, args).resumo || name}\n`)
                send('ai:code-agent:tool', { runId, phase: 'call', name, args })
              },
              onToolResult: (name, summary) => {
                emit(`[resultado] ${summary}\n`)
                send('ai:code-agent:tool', { runId, phase: 'result', name, summary })
              },
              // A transient model failure is being retried — say so, or a multi-
              // second backoff reads as a hang.
              onRetry: (attempt, max, waitMs, reason) =>
                emit(
                  `\n[sagyou] tentativa ${attempt}/${max} de contato com o modelo falhou ` +
                    `(${reason}); retentando em ${Math.round(waitMs / 1000)}s...\n`
                ),
              // Accumulate for the live counter + the end summary + the archive,
              // AND log the spend (process-wide, per-call) — the two are separate
              // ledgers with different lifetimes.
              onUsage: (usage) => {
                run.usage.promptTokens += usage.promptTokens
                run.usage.completionTokens += usage.completionTokens
                pushProgress()
                appendUsage(caCfg.model, usage, cfg)
              }
            }
          )
          if (result.stopped) exitCode = run.abort ? -2 : 1
        } catch (e) {
          exitCode = 1
          emit(`\n[erro no agente: ${e instanceof Error ? e.message : 'falha'}]\n`)
        } finally {
          // Token/cost/efficiency summary — shown on success or error, so a run
          // that spent money before failing still reports what it cost. Only
          // when something was billed (a run that never reached the model is 0).
          if (run.usage.promptTokens || run.usage.completionTokens) {
            emit(`\n${formatRunSummary(run.usage, run.step, costAt(run.usage, cfg))}\n`)
          }
          const secs = ((Date.now() - run.startedAt) / 1000).toFixed(1)
          emit(`\n[sagyou] duração: ${secs}s\n`)
          appendAgentLog(runId, `\n[agente encerrado — código ${exitCode}]\n`)
          // Freeze log + diff now: the only moment the diff means "what the agent
          // did" rather than "what the tree looks like today".
          void archiveAgentRun(runId, exitCode)
          send('ai:code-agent:exit', { runId, code: exitCode })
          // Save survivors for backward compat (status() after run ends).
          lastRunLog = run.log
          lastRunHint = run.hint
          lastRunModel = run.model
          lastRunProgress = {
            step: run.step,
            maxSteps: run.maxSteps,
            promptTokens: run.usage.promptTokens,
            completionTokens: run.usage.completionTokens
          }
          // Fase 2(b): se usou worktree, mescla de volta e remove
          if (run.worktreeDir) {
            try {
              const { stdout: patch } = await execAsync(`cd "${run.worktreeDir}" && git diff HEAD`)
              if (patch.trim()) {
                const fileCount = patch.split('\n').filter(l => l.startsWith('diff --git')).length
                const tmpPatch = join(dir, '.sagyou-wt-patch.diff')
                writeFileSync(tmpPatch, patch, 'utf-8')
                try {
                  await execAsync(`cd "${dir}" && git apply --whitespace=nowarn --ignore-space-change --ignore-whitespace "${tmpPatch}"`)
                } finally {
                  try { unlinkSync(tmpPatch) } catch {}
                }
                emit(`\n[worktree] ${fileCount} arquivo(s) mesclado(s) do worktree para o diretório original\n`)
              }
            } catch (e) {
              emit(`\n[aviso] falha ao mesclar worktree: ${e instanceof Error ? e.message : 'erro desconhecido'}\n`)
            } finally {
              try {
                await execAsync(`cd "${dir}" && git worktree remove --force "${run.worktreeDir}" 2>/dev/null`)
              } catch {
                // cleanup falhou — não crítico, o worktree fica órfão mas não afeta o app
              }
            }
          }
          codeRuns.delete(runId)
          codeAgentDirs.delete(dir)
        }
      })()

      return { success: true, agent: caCfg.model, dir, runId, worktreeDir }
    }
  )

  ipcMain.handle('ai:code-agent:stop', (_, runId?: string) => {
    stopCodeAgent(typeof runId === 'string' ? runId : undefined)
  })

  // The renderer's answer to an approval card the loop is parked on. Resolving
  // the pending promise is what lets the run continue (or run the denied path).
  // UUIDs are unique, so search across all runs' pendingApprovals maps.
  ipcMain.handle('ai:code-agent:approve-response', (_, id: string, approved: boolean) => {
    for (const run of codeRuns.values()) {
      const resolve = run.pendingApprovals.get(id)
      if (resolve) {
        run.pendingApprovals.delete(id)
        resolve(approved === true)
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
    mainWindow?.webContents.send('ai:code-agent:auto-changed', {
      runId,
      autoApprove: run.autoApprove
    })
  })

  // `runs` is an array of run summaries — a panel that wasn't mounted catches
  // up per-run. Keep old fields for backward compat (tests and code read
  // `.running` / `.log` / `.hint` directly), sourced from the first active run.
  ipcMain.handle('ai:code-agent:status', () => {
    const runs = [...codeRuns.values()]
    const first = runs[0]
    return {
      running: codeAgentDirs.size > 0,
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
        agent: r.agent,
        startedAt: r.startedAt,
        log: r.log,
        model: r.model,
        hint: r.hint,
        autoApprove: r.autoApprove,
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

  // --- Read-only code access (for the assistant to analyze source) ---
  // Every path is confined to `root`; nothing outside it can be read.
  ipcMain.handle(
    'ai:code:list',
    async (_, root: string, sub?: string, offset?: number, limit?: number) => {
      if (!root || !existsSync(root)) return { error: 'Diretório inválido' }
      // A listing is resent to the model on every later step, and a project with
      // several roots fans out — hundreds of paths per step. So walk up to a
      // ceiling to know a real `total`, then return one CODE_LIST_PAGE window;
      // `limit` can raise it to CODE_LIST_MAX (the old flat cap) and `offset`
      // pages through the rest. Same shape as ai:code:read.
      const CODE_LIST_WALK = 2000
      const CODE_LIST_PAGE = 200
      const CODE_LIST_MAX = 400
      const { files, truncated: walkTruncated } = await walkFiles(root, sub || '.', CODE_LIST_WALK)
      const total = files.length
      let page = CODE_LIST_PAGE
      if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 1) {
        page = Math.min(Math.floor(limit), CODE_LIST_MAX)
      }
      let start = 0
      if (typeof offset === 'number' && Number.isFinite(offset) && offset > 0) {
        start = Math.min(Math.floor(offset), total)
      }
      const slice = files.slice(start, start + page)
      const end = start + slice.length
      const morePages = end < total
      return {
        files: slice,
        total,
        offset: start,
        // True when there is more than this page shows — either more to page
        // through (nextOffset) or the walk itself hit its ceiling (narrow with
        // subpasta). Mirrors ler_arquivo's boolean "there's more".
        truncated: morePages || walkTruncated,
        ...(morePages ? { nextOffset: end } : {})
      }
    }
  )

  ipcMain.handle(
    'ai:code:read',
    (
      _,
      root: string,
      rel: string,
      offset?: number,
      maxChars?: number,
      // Scoped reading: a named symbol or a line range, so a big file can answer
      // a question about one function without shipping (and re-shipping) all of
      // it. When set, this wins over the char-window paging below.
      scope?: { symbol?: string; lineStart?: number; lineEnd?: number }
    ) => {
      const full = confineToRoot(root, rel)
      if (!full || !existsSync(full) || !statSync(full).isFile()) {
        return { error: 'Arquivo inválido ou fora do projeto' }
      }
      const CODE_READ_PAGE = 20000
      const CODE_READ_MAX = 60000
      try {
        const content = readFileSync(full, 'utf-8')
        const total = content.length

        // --- Scoped mode: return just the symbol / line range asked for. ---
        if (scope && (scope.symbol || scope.lineStart != null || scope.lineEnd != null)) {
          const cap = (r: { content: string; linhaInicio: number; linhaFim: number }): object => {
            const truncated = r.content.length > CODE_READ_MAX
            return {
              content: truncated ? r.content.slice(0, CODE_READ_MAX) : r.content,
              linhaInicio: r.linhaInicio,
              linhaFim: r.linhaFim,
              truncated,
              total
            }
          }
          if (scope.symbol) {
            const found = extractSymbol(content, scope.symbol)
            if (!found) {
              // Not a declaration in this file — hand back the symbol map so the
              // model can pick a real one instead of paging blindly.
              return {
                error: `Símbolo "${scope.symbol}" não encontrado`,
                total,
                simbolos: detectSymbols(content)
              }
            }
            return { simbolo: scope.symbol, ...cap(found) }
          }
          return cap(extractLines(content, scope.lineStart, scope.lineEnd))
        }

        // --- Big-file guard: a *blind* read (no scope, no offset, no explicit
        // max_chars) of a file too big to fit one page returns a short head plus
        // the symbol map and a nudge, instead of a full 20k window resent every
        // later step. It forces the model onto the surgical tools that already
        // exist — a named symbol, a line range, or paging with `inicio`. An
        // explicit `offset` or `max_chars` means the model already knows what it
        // wants, so those bypass this. (The 5000-line spec threshold was a no-op
        // here — kanban.ts is ~1k lines — so the real "big" measure is the same
        // char boundary the paging already uses.) ---
        const offsetProvided = typeof offset === 'number' && Number.isFinite(offset) && offset > 0
        const maxCharsProvided =
          typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1
        if (!offsetProvided && !maxCharsProvided && total > CODE_READ_PAGE) {
          const PREVIEW_LINES = 100
          const head = extractLines(content, 1, PREVIEW_LINES)
          // Cap the head too, in case 100 lines are themselves huge (minified).
          const preview =
            head.content.length > CODE_READ_PAGE
              ? head.content.slice(0, CODE_READ_PAGE)
              : head.content
          return {
            content: preview,
            truncated: true,
            offset: 0,
            total,
            simbolos: detectSymbols(content),
            nextOffset: preview.length,
            dica:
              `Arquivo grande (${total} chars). Para economizar tokens, mire o trecho: use ` +
              `"simbolo", "linha_inicio"/"linha_fim", ou pagine com "inicio"=${preview.length}. ` +
              `Passe "max_chars" para ler uma janela maior de uma vez.`
          }
        }

        // --- Char-window paging (unchanged): default 20k, raisable, resumable. ---
        // A file result is resent to the model on every later step, so a 60k-char
        // file (~15k tokens) was a per-step tax for a question that usually needs
        // a fraction of it. Default to one CODE_READ_PAGE window; `maxChars` can
        // raise it up to CODE_READ_MAX, and `offset` pages through the rest.
        let page = CODE_READ_PAGE
        if (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1) {
          page = Math.min(Math.floor(maxChars), CODE_READ_MAX)
        }
        let start = 0
        if (typeof offset === 'number' && Number.isFinite(offset) && offset > 0) {
          start = Math.min(Math.floor(offset), total)
        }
        const slice = content.slice(start, start + page)
        const end = start + slice.length
        const truncated = end < total
        return {
          content: slice,
          truncated,
          offset: start,
          total,
          // A symbol map, but only when it earns its tokens: on the first page of
          // a file too big to return whole. For a small file returned in full the
          // map is redundant (the model already has every line); on a big one it
          // lets the model re-read just the symbol it needs via `simbolo`.
          ...(truncated && start === 0 ? { simbolos: detectSymbols(content) } : {}),
          // Where a follow-up read should resume; absent once the file is exhausted.
          ...(truncated ? { nextOffset: end } : {})
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Falha ao ler o arquivo' }
      }
    }
  )

  ipcMain.handle('ai:code:search', async (_, root: string, term: string) => {
    if (!root || !existsSync(root)) return { error: 'Diretório inválido' }
    if (!term) return { error: 'Termo vazio' }
    const result = await searchFiles(root, term)
    return { matches: result.matches, truncated: result.truncated }
  })

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

  // --- AI conversation history ---
  ipcMain.handle('ai:conversations:list', () =>
    loadConversations()
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  )

  // Searching here rather than in the renderer: the file is already read on
  // this side, and shipping every message body over IPC to filter it there
  // would move megabytes for a substring test.
  ipcMain.handle('ai:conversations:search', (_, term: string) =>
    searchConversations(loadConversations(), typeof term === 'string' ? term : '')
  )

  ipcMain.handle(
    'ai:conversations:get',
    (_, id: string) => loadConversations().find((c) => c.id === id) ?? null
  )

  ipcMain.handle(
    'ai:conversations:save',
    (
      _,
      conv: {
        id: string
        title: string
        messages: StoredConversation['messages']
        usage?: TokenUsage
      }
    ) => {
      safeConversationsSave(() => {
        const list = loadConversations()
        const now = new Date().toISOString()
        const idx = list.findIndex((c) => c.id === conv.id)
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            title: list[idx].titleCustom ? list[idx].title : conv.title,
            messages: conv.messages,
            usage: conv.usage,
            updatedAt: now
          }
        } else {
          list.push({
            id: conv.id,
            title: conv.title,
            messages: conv.messages,
            usage: conv.usage,
            createdAt: now,
            updatedAt: now
          })
        }
        saveConversations(list)
      })
    }
  )

  /**
   * Name a chat by hand, latching the title against the autosave's derived one.
   *
   * Renaming reaches any chat in the history, not just the open one, so it goes
   * through the file rather than through the run store — the renderer only
   * holds the transcript of what's on screen.
   */
  ipcMain.handle('ai:conversations:rename', (_, id: string, title: string) => {
    if (typeof id !== 'string' || typeof title !== 'string')
      return { error: 'Argumentos inválidos' }
    const name = title.trim()
    if (!name) return { error: 'O nome não pode ficar vazio' }
    // A title is a one-line label in a narrow dropdown; the rest is not shown
    // and would only bloat a file re-read on every autosave and every keystroke
    // of the search.
    const clipped = name.slice(0, 120)
    const list = loadConversations()
    const idx = list.findIndex((c) => c.id === id)
    if (idx < 0) return { error: 'Conversa não encontrada' }
    // updatedAt is deliberately untouched: it orders the history by when the
    // chat was last *talked to*, and renaming would jump it to the top.
    list[idx] = { ...list[idx], title: clipped, titleCustom: true }
    saveConversations(list)
    return { title: clipped }
  })

  ipcMain.handle('ai:conversations:delete', (_, id: string) => {
    saveConversations(loadConversations().filter((c) => c.id !== id))
  })

  // Full history read/write — used by backup export/import, which needs every
  // conversation with its messages rather than the metadata `list` returns.
  ipcMain.handle('ai:conversations:all', () => loadConversations())

  ipcMain.handle('ai:conversations:replace', (_, list: StoredConversation[]) => {
    if (!Array.isArray(list)) return
    const now = new Date().toISOString()
    const clean = list
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : 'Conversa',
        // Carried through, or restoring a backup would quietly un-name every
        // chat the user had renamed: the title survives the round trip but the
        // next autosave, seeing no flag, derives over it.
        ...(c.titleCustom === true && { titleCustom: true }),
        // Likewise carried: without it an imported chat reports its cost as
        // unknown, having lost a count it was exported with.
        ...(c.usage && { usage: c.usage }),
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : now,
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : now,
        messages: c.messages.filter(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant' || m.role === 'status') &&
            typeof m.content === 'string'
        )
      }))
    saveConversations(clean)
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
  stopCodeAgent()
})
