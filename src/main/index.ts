import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename, resolve, sep } from 'path'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync
} from 'fs'
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
import { captureBase, diffSince, type AgentBase } from './code-diff'
import { decodeDataUrl, mimeForExt, isImageFileName } from './chat-images'
import {
  saveTemplate,
  removeTemplate,
  normalizeTemplates,
  type PromptTemplate,
  type SaveInput
} from './task-templates'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// A single external code agent (Aider/Codex) at a time, spawned in the
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

// On Windows, spawn without a shell won't append .exe/.cmd, so `spawn('aider')`
// fails even when installed. Resolve to the real file on PATH (pip installs
// aider.exe; npm installs codex.cmd). Returns the full path, or null. POSIX
// resolves via PATH natively, so pass through.
function resolveExecutable(cmd: string): string | null {
  if (process.platform !== 'win32') return cmd
  const exts = ['.exe', '.cmd', '.bat', '']
  for (const dir of (process.env.PATH || '').split(';')) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      if (existsSync(full)) return full
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

function buildAgentCommand(
  agent: 'aider' | 'codex',
  task: string,
  cfg: AIConfig,
  dir: string
): { cmd: string; args: string[]; taskFile: string | null } {
  // The hook: hand the repo's own guide to the agent before it touches code.
  // Relative to the agent's cwd, which is `dir` — so the path is the same
  // string for every repo and nothing leaks about the machine's layout.
  const guide = guideIn(dir)

  if (agent === 'codex') {
    // Codex CLI reads the OpenAI-compatible endpoint from the env set below.
    //
    // It has no --read: it finds AGENTS.md by itself (and truncates a project
    // doc past its budget, silently). So the guide is asked for in the prompt —
    // the one channel codex exec has — and only when the repo actually has one.
    const prompt = guide
      ? `Antes de alterar qualquer código, leia o ${guide} deste repositório e siga as regras dele.\n\n${task}`
      : task
    return { cmd: 'codex', args: ['exec', prompt], taskFile: null }
  }
  // Aider (default). The task goes in a temp file (--message-file) so untrusted
  // text never lands on the command line (which may be shell-interpreted on
  // Windows). `--yes-always` keeps it autonomous after the approved launch.
  const taskFile = join(app.getPath('temp'), `sagyou-task-${randomUUID()}.txt`)
  writeFileSync(taskFile, task, 'utf-8')
  return {
    cmd: 'aider',
    args: [
      '--model',
      `openai/${cfg.model}`,
      '--yes-always',
      // Read-only, so aider keeps it in context but never edits it. This is
      // belt and braces with the repo's own .aider.conf.yml (which only applies
      // when aider is launched from the repo): the flag is what makes a guide
      // work in *any* repo the app points at, config file or not. Naming the
      // same file twice is harmless — aider takes it once.
      ...(guide ? ['--read', guide] : []),
      '--message-file',
      taskFile
    ],
    taskFile
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
function toUsage(raw: { prompt_tokens?: number; completion_tokens?: number } | undefined | null): TokenUsage | undefined {
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
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)', status: 400 }
      }
      try {
        const client = getOpenAIClient(baseURL, apiKey)
        const body = {
          model,
          messages: request.messages,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        const completion = await client.chat.completions.create(body, requestOptions(config.timeoutMs))
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
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)', status: 400 }
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
        const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = []

        for await (const chunk of stream) {
          // The usage chunk arrives last and carries no choices, so read it
          // before the delta guard below skips the chunk entirely.
          usage = toUsage(chunk.usage) ?? usage
          const delta = chunk.choices[0]?.delta
          if (!delta) continue
          if (delta.content) {
            content += delta.content
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chat:delta', { streamId: request.streamId, delta: delta.content })
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
    async (_, request: { path: string; task: string; agent?: 'aider' | 'codex' }) => {
      if (codeAgentProc) return { success: false, error: 'Já existe um agente de código rodando' }
      const dir = request.path
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
      const task = typeof request.task === 'string' ? request.task.trim() : ''
      if (!task) return { success: false, error: 'Tarefa vazia' }
      const cfg = loadAIConfig()
      if (!cfg.baseUrl || !cfg.model) {
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)', status: 400 }
      }
      const agent = request.agent === 'codex' ? 'codex' : 'aider'
      // A new run starts a new log. Only reached once the request is known good
      // (a rejected one never spawns), so a failed start can't wipe the output
      // of the run before it — which is what the user would still be reading.
      codeAgentLog = ''
      // Snapshot the tree BEFORE the agent touches it — after the fact there is
      // no way to tell its work from what the user already had in progress.
      // Null here just means "no diff for this run" (not a git repo); it must
      // never stop the run, which is what the user actually asked for.
      codeAgentBase = await captureBase(dir)
      const { cmd, args, taskFile } = buildAgentCommand(agent, task, cfg, dir)

      // Resolve to a real .exe when possible and spawn it directly (safe, no
      // shell). Fall back to a shell only on Windows for .cmd/.bat wrappers.
      const resolved = resolveExecutable(cmd)
      const isExe = resolved !== null && /\.exe$/i.test(resolved)
      const spawnCmd = isExe && resolved ? resolved : cmd
      const useShell = process.platform === 'win32' && !isExe

      const send = (channel: string, data: unknown): void =>
        mainWindow?.webContents.send(channel, data)
      // Stream it and keep it: the panel may not be mounted to hear this.
      const emit = (chunk: string): void => {
        appendAgentLog(chunk)
        send('ai:code-agent:output', chunk)
      }
      const cleanup = (): void => {
        if (taskFile) {
          try {
            unlinkSync(taskFile)
          } catch {
            /* best effort */
          }
        }
      }

      return new Promise<{ success: boolean; agent?: string; dir?: string; error?: string }>(
        (resolve) => {
          let settled = false
          let child: ChildProcess
          try {
            child = spawn(spawnCmd, args, {
              cwd: dir,
              shell: useShell,
              env: {
                ...process.env,
                OPENAI_API_BASE: cfg.baseUrl,
                OPENAI_BASE_URL: cfg.baseUrl,
                OPENAI_API_KEY: cfg.apiKey || 'not-needed'
              }
            })
          } catch (e) {
            cleanup()
            resolve({ success: false, error: e instanceof Error ? e.message : 'Falha ao iniciar' })
            return
          }
          codeAgentProc = child
          child.stdout?.on('data', (d: Buffer) => emit(d.toString()))
          child.stderr?.on('data', (d: Buffer) => emit(d.toString()))
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
            cleanup()
            // Buffered too: "aider isn't installed" is the single most useful
            // line the panel can show, and it is exactly the one that fires
            // instantly — usually before the user has looked at the panel at all.
            appendAgentLog(`[agente encerrado — código -1]\n`)
            send('ai:code-agent:exit', -1)
            if (!settled) {
              settled = true
              resolve({ success: false, error: msg })
            }
          })
          child.on('close', (code) => {
            codeAgentProc = null
            cleanup()
            // The panel appends this line itself when it's mounted to hear the
            // event; buffering it is what tells a user who was away that the
            // run is over rather than still going.
            appendAgentLog(`\n[agente encerrado — código ${code ?? 0}]\n`)
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
    log: codeAgentLog
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

  ipcMain.handle('ai:pick-directory', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled || filePaths.length === 0) return { path: null }
    return { path: filePaths[0] }
  })

  // --- Read-only code access (for the assistant to analyze source) ---
  // Every path is confined to `root`; nothing outside it can be read.
  ipcMain.handle('ai:code:list', async (_, root: string, sub?: string) => {
    if (!root || !existsSync(root)) return { error: 'Diretório inválido' }
    return walkFiles(root, sub || '.', 400)
  })

  ipcMain.handle('ai:code:read', (_, root: string, rel: string) => {
    const full = confineToRoot(root, rel)
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
      return { error: 'Arquivo inválido ou fora do projeto' }
    }
    try {
      let content = readFileSync(full, 'utf-8')
      const MAX = 60000
      const truncated = content.length > MAX
      if (truncated) content = content.slice(0, MAX)
      return { content, truncated }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao ler o arquivo' }
    }
  })

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
  // the wait.
  ipcMain.handle('ai:web:fetch', (_, url: string) => fetchWeb(url))

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

  ipcMain.handle('ai:conversations:get', (_, id: string) =>
    loadConversations().find((c) => c.id === id) ?? null
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
    if (typeof id !== 'string' || typeof title !== 'string') return { error: 'Argumentos inválidos' }
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
