import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename, resolve, relative, sep } from 'path'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync,
  accessSync,
  constants
} from 'fs'
import { homedir } from 'os'
import { readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import OpenAI from 'openai'
import { loadData, saveData } from './store'
import { appendEntry, newEntry, summarize, type TokenUsage, type UsageLogEntry } from './usage'
import { getOpenAIClient, requestOptions } from './openai-client'
import { confineToRoot, walkFiles } from './code-files'
import { searchConversations } from './conversation-search'
import { fetchWeb } from './web-fetch'
import { renderWeb } from './web-render'
import { captureBase, diffSince, type AgentBase } from './code-diff'
import { decodeDataUrl, mimeForExt, isImageFileName } from './chat-images'
import {
  diffFileCount,
  isRunId,
  normalizeRuns,
  pruneRuns,
  runsForConv,
  taskLabel,
  type AgentRunMeta,
  type AgentRunSnapshot
} from './agent-runs'
import {
  saveTemplate,
  removeTemplate,
  normalizeTemplates,
  type PromptTemplate,
  type SaveInput
} from './task-templates'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// A single external code agent (codex) at a time, spawned in the
// selected project directory. Only launched after explicit user approval in
// the renderer, since it can write files and run commands.
let codeAgentProc: ChildProcess | null = null

/**
 * What the code agent has printed so far, kept on this side.
 *
 * The agent is a child process that can run for many minutes — a code review is
 * the whole point of it — and the user is meant to go on using the app while it
 * works. But `ai:code-agent:output` is a live stream to whoever is listening,
 * and the only thing accumulating it was `agentLog` inside AIView, which is
 * unmounted the moment another view is active: every chunk emitted while the
 * user was elsewhere went to a listener that no longer existed, and an agent
 * that finished while they were away left nothing behind at all.
 *
 * So the output is buffered where the process itself lives. The stream stays as
 * it is (a mounted panel still updates live); this is what a returning panel
 * reads back through `ai:code-agent:status`, and it survives the renderer
 * reloading too.
 */
let codeAgentLog = ''

/**
 * What the tree looked like when the current agent run started.
 *
 * Captured before the spawn, because `git diff` after the fact cannot tell the
 * agent's work from whatever the user already had in progress — and presenting
 * a user's own half-finished edits as something an AI did to their code is
 * worse than showing no diff at all. Null when the directory isn't a git repo,
 * which is a legitimate state: the diff is simply unavailable.
 */
let codeAgentBase: AgentBase | null = null

/**
 * Identity of the run in flight, so its output can be archived under the
 * conversation that asked for it.
 *
 * Set at spawn and consumed once by `archiveAgentRun` — nulled there, because
 * both exit paths ('error' and 'close') can fire for one run and a run must not
 * be archived twice. Null between runs.
 */
let codeAgentRun: {
  id: string
  convId: string | null
  agent: 'codex'
  dir: string
  task: string
  startedAt: number
} | null = null

/**
 * Cap on the buffer above, matching the panel's own cap in AIView.
 *
 * Equal on purpose: leaving the view and coming back should show exactly what
 * staying would have shown. A generous main-side buffer would make the panel
 * change depending on where the user had been standing.
 */
const MAX_AGENT_LOG = 8000

/** Append to the buffer, keeping only the tail the panel can show. */
function appendAgentLog(chunk: string): void {
  codeAgentLog = (codeAgentLog + chunk).slice(-MAX_AGENT_LOG)
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

/** Set for the current run when its output matched a known failure. */
let codeAgentHint: AgentHint | null = null

/**
 * Recognise failures that leave the agent reporting success while doing nothing.
 *
 * The case that motivated it: codex's Linux sandbox is bubblewrap, which needs
 * unprivileged user namespaces, and Ubuntu 23.10+ blocks those by AppArmor
 * (`kernel.apparmor_restrict_unprivileged_userns=1`, the default on 24.04).
 * codex then cannot run a single command — not even reading a file — writes
 * nothing, explains itself in prose, and **exits 0**. From the app's side that
 * is indistinguishable from an agent that decided no change was needed, so
 * without this the user is told the run finished and left to wonder why their
 * code is untouched.
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
      title: 'O sandbox do codex não conseguiu iniciar — nada foi alterado.',
      detail:
        'O codex isola a execução com bubblewrap, que precisa de user namespaces ' +
        'sem privilégio. O Ubuntu 23.10+ (e derivados) bloqueia isso por AppArmor, ' +
        'então o codex não conseguiu nem ler os arquivos. Ele terminou com sucesso ' +
        'mesmo assim, mas não escreveu nada.',
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
  // proves the "not installed" path by emptying PATH — but codex is genuinely
  // installed on a dev machine, and these dirs are exactly where it lives
  // (`~/.npm-global/bin` here, `/usr/local/bin` on a Mac). Without this the test
  // would spawn the real codex, which waits on stdin and never exits, poisoning
  // every test after it — the failure the PATH-replacement guard exists to stop.
  // Set only by tests; unset in the app, where the fallback is the whole point.
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
 *     `spawn('codex')` fails even when installed (npm installs codex.cmd).
 *   • **POSIX** — spawn *does* resolve via PATH, but only the PATH this process
 *     was handed, and a GUI-launched Electron app doesn't get the user's shell
 *     PATH. Measured on Ubuntu 24.04 + GNOME/Wayland: apps started from the
 *     launcher inherit the systemd user manager's PATH, which has no
 *     `~/.npm-global/bin` — that lives in `~/.bashrc`, read only by interactive
 *     shells. So `codex --version` works in a terminal while the app reports it
 *     "não encontrado", which is a lie about the cause and sends the user off
 *     reinstalling something that is already there.
 *
 * ⚠️ **PATH is searched first and `extraDirs` only if that finds nothing.** The
 * order is load-bearing for the tests, not a preference: `handlers.test.ts`
 * *replaces* PATH with a dir holding only a stub, precisely so a real codex on
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
  // '' last: on Windows a bare `codex` (extensionless) is only a match if no
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

// Kill the running code agent (and its child tree on Windows, since a shell
// wrapper won't propagate the kill to the real agent process).
function killCodeAgent(): void {
  const proc = codeAgentProc
  if (!proc) return
  codeAgentProc = null
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
    } catch {
      proc.kill()
    }
  } else {
    proc.kill()
  }
}

/** The context file an agent should read first, if the target repo has one. */
export const GUIDE_FILE = 'GUIDE.md'

/**
 * Whether `dir` carries a guide for agents working in it.
 *
 * ⚠️ Checked against the **target directory**, never this repo. The agent runs
 * wherever the project's code path points, which may be any repo on the
 * machine; injecting Sagyou's own GUIDE.md there would brief the agent on this
 * app's rules while it edits something else entirely. A repo without a guide
 * simply gets none — that is the honest answer, not a reason to substitute ours.
 */
function guideIn(dir: string): string | null {
  try {
    return existsSync(join(dir, GUIDE_FILE)) ? GUIDE_FILE : null
  } catch {
    return null
  }
}

/**
 * The command that runs the external code agent.
 *
 * codex is the only agent, and there is deliberately no second code path.
 * ⚠️ Note this means the app's own AI config does not influence code editing
 * at all: codex authenticates and picks its model by itself.
 */
function buildAgentCommand(
  task: string,
  dir: string,
  files: string[]
): { cmd: string; args: string[]; stdinData: string } {
  // The hook: hand the repo's own guide to the agent before it touches code.
  // Relative to the agent's cwd, which is `dir` — so the path is the same
  // string for every repo and nothing leaks about the machine's layout.
  const guide = guideIn(dir)

  {
    // Codex CLI reads the OpenAI-compatible endpoint from the env set below.
    //
    // It has no --read: it finds AGENTS.md by itself (and truncates a project
    // doc past its budget, silently). So the guide is asked for in the prompt —
    // the one channel codex exec has — and only when the repo actually has one.
    // Codex has no --file either; when the caller pinned files, naming them in
    // the prompt spares codex the same blind discovery.
    // Relative, as the sentence promises. `files` arrives absolute (confineToRoot
    // resolves it), so joining it raw contradicted the prompt in the same breath
    // — and put the machine's home directory into the model's context for no
    // reason, the same leak the guide path above is careful to avoid. codex runs
    // with cwd = dir, so a relative path is also the one it can actually use.
    const focus = files.length
      ? `Edite estes arquivos (caminhos relativos à raiz): ${files
          .map((f) => relative(dir, f) || f)
          .join(', ')}.\n\n`
      : ''
    const prompt = guide
      ? `Antes de alterar qualquer código, leia o ${guide} deste repositório e siga as regras dele.\n\n${focus}${task}`
      : `${focus}${task}`
    // `codex exec` is already non-interactive — it never prompts for approval, so
    // there is no --ask-for-approval here (that flag is top-level only and `exec`
    // rejects it with exit 2). What it still needs is write permission, and how it
    // gets it is platform-split:
    //   • Unix — `--sandbox workspace-write`: codex's sandbox is OS-level (Seatbelt
    //     on macOS, Landlock on Linux), so this genuinely confines writes to the
    //     workspace while letting it edit the project (the whole point). read-only
    //     would let it plan edits it can never apply; danger-full-access is wider.
    //   • Windows — `--dangerously-bypass-approvals-and-sandbox`: Windows has no
    //     sandbox backend, so `--sandbox workspace-write` is silently downgraded to
    //     read-only — codex then reads the code, reports success, and writes nothing
    //     (verified in the wild and in a reproduction). `exec` exposes no --full-auto
    //     or approval flag, only -s and this bypass, so it is the *only* way codex
    //     can write on Windows. This is not "safe vs unsafe": Windows offers no OS
    //     confinement either way, and the app already gates rodar_agente_codigo
    //     behind explicit user approval before spawning. So the real choice is
    //     "writes" vs "can't write".
    const sandboxArgs =
      process.platform === 'win32'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', 'workspace-write']
    return {
      cmd: 'codex',
      args: [
        'exec',
        ...sandboxArgs,
        // Read the prompt from stdin (`-`), never as a command-line argument. On
        // Windows codex is a .cmd, so it runs through cmd.exe (shell: true), which
        // word-splits a bare multi-word prompt into separate args ("Antes de …" →
        // codex sees `de` as an unexpected argument). Untrusted, multi-line text
        // stays off the command line entirely; `stdinData` is what gets piped in.
        '-'
      ],
      stdinData: prompt
    }
  }
}

// --- AI config (persisted to ai-config.json in userData, not the DB) ---
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
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
}

const DEFAULT_AI_CONFIG: AIConfig = { baseUrl: '', apiKey: '', model: '' }
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
  raw: { prompt_tokens?: number; completion_tokens?: number } | undefined | null
): TokenUsage | undefined {
  if (!raw) return undefined
  const promptTokens = typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : 0
  const completionTokens = typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0
  if (promptTokens === 0 && completionTokens === 0) return undefined
  return { promptTokens, completionTokens }
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

// --- Chat images (files under userData/chat-images) ---

const chatImagesDir = (): string => join(app.getPath('userData'), 'chat-images')

/** Resolve an image id to a path, or null if it isn't one of ours. */
function chatImagePath(id: unknown): string | null {
  if (!isImageFileName(id)) return null
  const full = join(chatImagesDir(), id)
  // The id arrives from the renderer; belt and braces on top of the name check.
  return full.startsWith(chatImagesDir() + sep) ? full : null
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
    return normalizeRuns(JSON.parse(readFileSync(agentRunsIndexPath(), 'utf-8')))
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
async function archiveAgentRun(exitCode: number): Promise<void> {
  const run = codeAgentRun
  if (!run) return
  codeAgentRun = null
  try {
    const diff = codeAgentBase ? await diffSince(codeAgentBase) : null
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
      log: codeAgentLog,
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
    mainWindow?.webContents.send('ai:code-agent:archived', meta.id)
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
}

// --- Gerar Tasks templates (persisted to ai-templates.json in userData) ---

const aiTemplatesPath = (): string => join(app.getPath('userData'), 'ai-templates.json')

function loadTemplates(): PromptTemplate[] {
  try {
    return normalizeTemplates(JSON.parse(readFileSync(aiTemplatesPath(), 'utf-8')))
  } catch {
    return []
  }
}

function writeTemplates(list: PromptTemplate[]): void {
  writeFileSync(aiTemplatesPath(), JSON.stringify(list, null, 2), 'utf-8')
}

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
  writeFileSync(aiConversationsPath(), JSON.stringify(list), 'utf-8')
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sagyou')

  const filesDir = join(app.getPath('userData'), 'files')
  if (!existsSync(filesDir)) mkdirSync(filesDir)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.restore()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized())

  ipcMain.handle('store:load', () => loadData())

  ipcMain.handle('store:save', (_, data) => {
    saveData(data)
  })

  ipcMain.handle('backup:export', async (_, backup) => {
    const date = new Date().toISOString().split('T')[0]
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `kanban-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8')
    return { success: true }
  })

  ipcMain.handle('backup:import', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, cancelled: true }
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      return { success: true, data: JSON.parse(content) }
    } catch {
      return { success: false, error: 'Arquivo inválido' }
    }
  })

  ipcMain.handle('files:upload', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Selecionar arquivos',
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return []
    const results: { id: string; name: string; ext: string; size: number; createdAt: string }[] = []
    for (const filePath of filePaths) {
      try {
        const id = randomUUID()
        const ext = extname(filePath)
        const name = basename(filePath)
        const size = statSync(filePath).size
        copyFileSync(filePath, join(filesDir, `${id}${ext}`))
        results.push({ id, name, ext, size, createdAt: new Date().toISOString() })
      } catch {
        // skip files that can't be copied
      }
    }
    return results
  })

  ipcMain.handle('files:delete', (_, id: string, ext: string) => {
    try {
      const filePath = join(filesDir, `${id}${ext}`)
      if (existsSync(filePath)) unlinkSync(filePath)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('files:open', async (_, id: string, ext: string) => {
    const filePath = join(filesDir, `${id}${ext}`)
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  ipcMain.handle('files:openInBrowser', async (_, id: string, ext: string) => {
    const filePath = join(filesDir, `${id}${ext}`)
    try {
      await shell.openExternal(`file://${filePath}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('files:download', async (_, id: string, name: string, ext: string) => {
    const { filePath: dest, canceled } = await dialog.showSaveDialog({
      defaultPath: name,
      filters: [{ name: 'Todos os arquivos', extensions: ['*'] }]
    })
    if (canceled || !dest) return { success: false, cancelled: true }
    try {
      copyFileSync(join(filesDir, `${id}${ext}`), dest)
      return { success: true }
    } catch {
      return { success: false, error: 'Erro ao salvar arquivo' }
    }
  })

  ipcMain.handle('excel:export', async (_, buffer: Buffer, filename: string) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    try {
      writeFileSync(filePath, Buffer.from(buffer))
      return { success: true }
    } catch {
      return { success: false, error: 'Erro ao salvar arquivo' }
    }
  })

  ipcMain.handle('ai:import', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, cancelled: true }
    try {
      const content = readFileSync(filePaths[0], 'utf-8')
      return { success: true, data: JSON.parse(content) }
    } catch {
      return { success: false, error: 'Arquivo inválido' }
    }
  })

  ipcMain.handle('ai:config:get', () => loadAIConfig())

  ipcMain.handle('ai:config:set', (_, config: AIConfig) => {
    saveAIConfig(config)
  })

  ipcMain.handle('ai:usage:summary', () => summarize(loadUsageLog()))

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
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
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
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
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

  // Launch an external code agent in the project directory. The renderer must
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
        /** The chat that asked, so the run can be reopened from it later. */
        convId?: string
      }
    ) => {
      if (codeAgentProc) return { success: false, error: 'Já existe um agente de código rodando' }
      const dir = request.path
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
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
        .map((f) => confineToRoot(dir, f))
        .filter((f): f is string => f !== null && existsSync(f) && statSync(f).isFile())
      const droppedFiles = requestedFiles.filter((f) => {
        const abs = confineToRoot(dir, f)
        return abs === null || !existsSync(abs) || !statSync(abs).isFile()
      })
      const cfg = loadAIConfig()
      if (!cfg.baseUrl || !cfg.model) {
        return {
          success: false,
          error: 'Configuração de IA incompleta (Base URL / Model)',
          status: 400
        }
      }
      // codex is the only agent — see buildAgentCommand.
      const agent = 'codex' as const
      // A new run starts a new log. Only reached once the request is known good
      // (a rejected one never spawns), so a failed start can't wipe the output
      // of the run before it — which is what the user would still be reading.
      codeAgentLog = ''
      // Same reasoning as the log: a diagnosis carried over from the previous run
      // is worse than none. Cleared only once the request is known good.
      codeAgentHint = null
      // Snapshot the tree BEFORE the agent touches it — after the fact there is
      // no way to tell its work from what the user already had in progress.
      // Null here just means "no diff for this run" (not a git repo); it must
      // never stop the run, which is what the user actually asked for.
      codeAgentBase = await captureBase(dir)
      const { cmd, args, stdinData } = buildAgentCommand(task, dir, files)

      // Spawn the resolved absolute path directly (safe, no shell) whenever we
      // have one. A shell is used only on Windows, and only for the .cmd/.bat
      // wrappers that need one; on POSIX every match is directly executable.
      //
      // ⚠️ Passing the resolved path matters on POSIX too, not just Windows: it
      // is what lets the agent be found in a node-version-manager or custom-npm
      // -prefix dir that this process's PATH doesn't carry. Handing `cmd` back
      // to spawn would re-do the PATH lookup that already failed.
      const resolved = resolveExecutable(cmd)
      const isExe = resolved !== null && /\.exe$/i.test(resolved)
      const useShell = process.platform === 'win32' && !isExe
      // `null` stays as the bare name so spawn fails with ENOENT and the error
      // handler reports "not installed" — which, having searched the fallback
      // dirs too, is now a claim we can actually stand behind.
      const spawnCmd = resolved && !useShell ? resolved : cmd

      const send = (channel: string, data: unknown): void =>
        mainWindow?.webContents.send(channel, data)
      // Stream it and keep it: the panel may not be mounted to hear this.
      const emit = (chunk: string): void => {
        appendAgentLog(chunk)
        send('ai:code-agent:output', chunk)
      }

      // Which path this run takes, stated before the agent says anything. The
      // fast path (pinned files, named in the prompt) and the slow one (no
      // files, so codex discovers them itself with its own grep/read tools)
      // differ by minutes on a one-line change, and until now they looked
      // identical from the panel: a path the
      // model got wrong is dropped in silence and degrades to discovery. The
      // model also chooses whether to send `arquivos` at all, so "did it?" is
      // exactly the question this answers. The model line says whose model it is:
      // codex authenticates and picks it by itself, so the app's configured
      // provider has no bearing on a code run and nobody should read it as if it did.
      emit(`[sagyou] agente: ${agent} · modelo: próprio do codex (não usa a config do app)\n`)
      emit(
        files.length
          ? `[sagyou] ${files.length} arquivo(s) fixado(s) — caminho rápido, sem descoberta:\n` +
              files.map((f) => `  · ${relative(dir, f) || f}\n`).join('')
          : '[sagyou] nenhum arquivo fixado — o codex vai localizar os arquivos com as próprias ferramentas.\n'
      )
      if (droppedFiles.length) {
        emit(
          `[sagyou] ${droppedFiles.length} caminho(s) descartado(s) (fora da raiz ou inexistente):\n` +
            droppedFiles.map((f) => `  · ${f}\n`).join('') +
            (files.length ? '' : `[sagyou] por isso este run caiu na descoberta.\n`)
        )
      }
      emit('\n')
      return new Promise<{ success: boolean; agent?: string; dir?: string; error?: string }>(
        (resolve) => {
          let settled = false
          let child: ChildProcess
          // Wall clock, taken as late as possible: what's being compared is the
          // agent's own run, not our banner or the base capture before it.
          const startedAt = Date.now()
          // Identity for the archive written when this run exits. Set here, next
          // to the clock, so it describes the run that actually spawns.
          codeAgentRun = {
            id: randomUUID(),
            convId: typeof request.convId === 'string' && request.convId ? request.convId : null,
            agent,
            dir,
            task: taskLabel(task),
            startedAt
          }
          try {
            child = spawn(spawnCmd, args, {
              cwd: dir,
              shell: useShell,
              // stdin: a pipe only when we have a prompt to feed (codex reads it
              // from stdin via `-`, keeping the multi-word prompt off a shell-
              // parsed command line), otherwise 'ignore'. A closed stdin turns any
              // stray confirmation into an immediate EOF instead of a process that
              // hangs "running" forever.
              stdio: [stdinData !== null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
              env: {
                ...process.env,
                OPENAI_API_BASE: cfg.baseUrl,
                OPENAI_BASE_URL: cfg.baseUrl,
                OPENAI_API_KEY: cfg.apiKey || 'not-needed'
              }
            })
          } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : 'Falha ao iniciar' })
            return
          }
          codeAgentProc = child
          // Feed the prompt over stdin (codex `-`), then close it so the agent
          // sees EOF and starts. Guard the write: a spawn failure leaves stdin
          // unwritable, and that must surface as the 'error' event below, not an
          // unhandled throw here.
          if (stdinData !== null && child.stdin) {
            child.stdin.on('error', () => {
              /* the 'error'/'close' handlers below report the real failure */
            })
            child.stdin.write(stdinData)
            child.stdin.end()
          }
          // Decode as UTF-8 through the stream, not with a per-chunk d.toString():
          // an accented char (or a box-drawing glyph) whose bytes straddle two
          // 'data' events would otherwise be split mid-character and land as a
          // replacement glyph. setEncoding buffers the partial byte and joins it
          // to the next chunk.
          child.stdout?.setEncoding('utf8')
          child.stderr?.setEncoding('utf8')
          // Watched for a known failure as it streams. Kept in its own rolling
          // window rather than read off codeAgentLog, which is capped to the
          // panel's tail: the sandbox warning is the *first* thing codex prints,
          // so on a chatty run it would have scrolled out of the buffer before
          // anyone looked. A window (not a per-chunk test) because a marker can
          // straddle two 'data' events.
          let recent = ''
          const watch = (d: string): void => {
            emit(d)
            if (codeAgentHint) return
            recent = (recent + d).slice(-4000)
            codeAgentHint = detectAgentHint(recent)
          }
          child.stdout?.on('data', watch)
          child.stderr?.on('data', watch)
          // 'spawn' fires only when the process actually started.
          child.once('spawn', () => {
            if (!settled) {
              settled = true
              resolve({ success: true, agent, dir })
            }
          })
          child.on('error', (e) => {
            const notFound = (e as NodeJS.ErrnoException).code === 'ENOENT'
            const msg = notFound
              ? `"${cmd}" não encontrado. Instale-o e confirme com "${cmd} --version" no terminal.`
              : e.message
            emit(`\n[erro ao iniciar ${cmd}: ${msg}]\n`)
            codeAgentProc = null
            // Buffered too: "codex isn't installed" is the single most useful
            // line the panel can show, and it is exactly the one that fires
            // instantly — usually before the user has looked at the panel at all.
            appendAgentLog(`[agente encerrado — código -1]\n`)
            void archiveAgentRun(-1)
            send('ai:code-agent:exit', -1)
            if (!settled) {
              settled = true
              resolve({ success: false, error: msg })
            }
          })
          child.on('close', (code) => {
            codeAgentProc = null
            // How long the run took. Goes through `emit` (streams *and* buffers)
            // rather than appendAgentLog, so it shows live and still survives an
            // unmounted panel — the exit line below can't carry it, since the
            // renderer writes its own copy of that line on the event. Without
            // this the panel had no clock at all, which makes "how long did that
            // take?" unanswerable except by stopwatch.
            const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
            emit(`\n[sagyou] duração: ${secs}s\n`)
            // Also in the log, not only in the card: someone reading the raw
            // output (or pasting it into an issue) should get the diagnosis in
            // the same place as the symptom.
            if (codeAgentHint) {
              emit(
                `[sagyou] ${codeAgentHint.title}\n` +
                  `[sagyou] ${codeAgentHint.detail}\n` +
                  (codeAgentHint.command ? `[sagyou] correção: ${codeAgentHint.command}\n` : '')
              )
            }
            // The panel appends this line itself when it's mounted to hear the
            // event; buffering it is what tells a user who was away that the
            // run is over rather than still going.
            appendAgentLog(`\n[agente encerrado — código ${code ?? 0}]\n`)
            // Freeze log + diff now: this is the only moment the diff means
            // "what the agent did" rather than "what the tree looks like today".
            void archiveAgentRun(code ?? 0)
            send('ai:code-agent:exit', code ?? 0)
          })
        }
      )
    }
  )

  ipcMain.handle('ai:code-agent:stop', () => {
    killCodeAgent()
  })

  // `log` is how a panel that wasn't mounted catches up — see codeAgentLog.
  ipcMain.handle('ai:code-agent:status', () => ({
    running: codeAgentProc !== null,
    log: codeAgentLog,
    // Null unless the run hit a recognised environment failure. Carried here
    // rather than on the exit event so a panel mounted after the fact still
    // sees it — the same reason `log` is here.
    hint: codeAgentHint
  }))

  /**
   * What the last run changed. Computed on demand rather than captured on exit:
   * it is derived state, so a panel that was unmounted when the agent finished
   * can still ask for it, and re-reading is free.
   */
  ipcMain.handle('ai:code-agent:diff', async () => {
    if (!codeAgentBase) {
      return {
        patch: '',
        files: [],
        truncated: false,
        omittedNewFiles: [],
        error: 'Sem diff: esta pasta não é um repositório git (ou não tem commits ainda).'
      }
    }
    return diffSince(codeAgentBase)
  })

  /**
   * Past runs of one conversation, newest first. Index only — the logs and
   * diffs stay on disk until a row is actually opened.
   */
  ipcMain.handle('ai:code-agent:runs', (_, convId: string) => runsForConv(loadRunIndex(), convId))

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
    (_, root: string, rel: string, offset?: number, maxChars?: number) => {
      const full = confineToRoot(root, rel)
      if (!full || !existsSync(full) || !statSync(full).isFile()) {
        return { error: 'Arquivo inválido ou fora do projeto' }
      }
      try {
        const content = readFileSync(full, 'utf-8')
        const total = content.length
        // A file result is resent to the model on every later step, so a 60k-char
        // file (~15k tokens) was a per-step tax for a question that usually needs
        // a fraction of it. Default to one CODE_READ_PAGE window; `maxChars` can
        // raise it up to CODE_READ_MAX, and `offset` pages through the rest.
        const CODE_READ_PAGE = 20000
        const CODE_READ_MAX = 60000
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
    const { files } = await walkFiles(root, '.', 3000)
    const matches: { file: string; line: number; text: string }[] = []
    const CAP = 60
    const lower = term.toLowerCase()
    for (const rel of files) {
      if (matches.length >= CAP) break
      let content: string
      try {
        // Awaited per file: this loop is the expensive half (~640ms sync over a
        // large tree), and each await lets the main process serve IPC/window
        // events instead of freezing until the search finishes.
        content = await readFile(join(resolve(root), rel), 'utf-8')
      } catch {
        continue
      }
      if (content.includes('\u0000')) continue // skip binaries
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && matches.length < CAP; i++) {
        if (lines[i].toLowerCase().includes(lower)) {
          matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 200) })
        }
      }
    }
    return { matches, truncated: matches.length >= CAP }
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

  // Store a pasted image and hand back its id. The renderer has already
  // downscaled it; this checks the bytes are really an image before writing.
  ipcMain.handle('ai:images:save', (_, dataUrl: string) => {
    const decoded = decodeDataUrl(dataUrl)
    if ('error' in decoded) return decoded
    try {
      if (!existsSync(chatImagesDir())) mkdirSync(chatImagesDir(), { recursive: true })
      const id = `${randomUUID()}.${decoded.ext}`
      writeFileSync(join(chatImagesDir(), id), decoded.bytes)
      return { id }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao salvar a imagem' }
    }
  })

  ipcMain.handle('ai:images:get', (_, id: string) => {
    const full = chatImagePath(id)
    if (!full || !existsSync(full)) return { error: 'Imagem não encontrada' }
    try {
      const ext = id.split('.').pop() ?? ''
      const b64 = readFileSync(full).toString('base64')
      return { dataUrl: `data:${mimeForExt(ext)};base64,${b64}` }
    } catch {
      return { error: 'Falha ao ler a imagem' }
    }
  })

  // Called when a conversation is deleted: the file has no other owner, so
  // leaving it behind orphans it on disk forever.
  ipcMain.handle('ai:images:delete', (_, ids: string[]) => {
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      const full = chatImagePath(id)
      if (full && existsSync(full)) {
        try {
          unlinkSync(full)
        } catch {
          /* already gone, or locked — not worth failing the delete over */
        }
      }
    }
  })

  ipcMain.handle('ai:templates:list', () => loadTemplates())

  ipcMain.handle('ai:templates:save', (_, input: SaveInput) => {
    const res = saveTemplate(loadTemplates(), input, new Date().toISOString(), randomUUID)
    if ('error' in res) return res
    writeTemplates(res.list)
    return { template: res.template }
  })

  ipcMain.handle('ai:templates:delete', (_, id: string) => {
    writeTemplates(removeTemplate(loadTemplates(), id))
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
      const list = loadConversations()
      const now = new Date().toISOString()
      const idx = list.findIndex((c) => c.id === conv.id)
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          // A renamed chat keeps its name. The caller derives a title from the
          // first message on every save and has no idea the user renamed it, so
          // honouring `conv.title` here would undo the rename on the next
          // keystroke of the reply.
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Don't leave the external code agent running orphaned when the app closes.
app.on('before-quit', () => {
  killCodeAgent()
})
