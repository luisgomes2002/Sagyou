import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename, resolve, sep, relative } from 'path'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync,
  readdirSync
} from 'fs'
import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import OpenAI from 'openai'
import { loadData, saveData } from './store'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// A single external code agent (Aider/Codex) at a time, spawned in the
// selected project directory. Only launched after explicit user approval in
// the renderer, since it can write files and run commands.
let codeAgentProc: ChildProcess | null = null

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

function buildAgentCommand(
  agent: 'aider' | 'codex',
  task: string,
  cfg: AIConfig
): { cmd: string; args: string[]; taskFile: string | null } {
  if (agent === 'codex') {
    // Codex CLI reads the OpenAI-compatible endpoint from the env set below.
    return { cmd: 'codex', args: ['exec', task], taskFile: null }
  }
  // Aider (default). The task goes in a temp file (--message-file) so untrusted
  // text never lands on the command line (which may be shell-interpreted on
  // Windows). `--yes-always` keeps it autonomous after the approved launch.
  const taskFile = join(app.getPath('temp'), `sagyou-task-${randomUUID()}.txt`)
  writeFileSync(taskFile, task, 'utf-8')
  return {
    cmd: 'aider',
    args: ['--model', `openai/${cfg.model}`, '--yes-always', '--message-file', taskFile],
    taskFile
  }
}

// --- AI config (persisted to ai-config.json in userData, not the DB) ---
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const DEFAULT_AI_CONFIG: AIConfig = { baseUrl: '', apiKey: '', model: '' }
const aiConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

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

// --- AI chat history (persisted to ai-conversations.json in userData) ---
interface StoredConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: { role: 'user' | 'assistant' | 'status'; content: string }[]
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
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)' }
      }
      try {
        // OpenAI SDK throws on an empty apiKey; keyless local servers get a placeholder.
        const client = new OpenAI({ baseURL, apiKey: apiKey || 'not-needed' })
        const body = {
          model,
          messages: request.messages,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        const completion = await client.chat.completions.create(body)
        const message = completion.choices[0]?.message
        if (!message) return { success: false, error: 'Resposta vazia do modelo' }
        return {
          success: true,
          message: {
            role: 'assistant',
            content: message.content ?? '',
            tool_calls: message.tool_calls
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Falha ao contatar o modelo' }
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
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)' }
      }
      try {
        const client = new OpenAI({ baseURL, apiKey: apiKey || 'not-needed' })
        const body = {
          model,
          messages: request.messages,
          stream: true,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {})
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming
        const stream = await client.chat.completions.create(body)

        let content = ''
        // tool_calls arrive split across chunks: each delta carries an index and
        // a slice of the JSON arguments, which we concatenate per index.
        const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = []

        for await (const chunk of stream) {
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
            if (tc.function?.name) slot.function.name += tc.function.name
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments
          }
        }

        const calls = toolCalls.filter(Boolean)
        return {
          success: true,
          message: {
            role: 'assistant',
            content,
            ...(calls.length > 0 ? { tool_calls: calls } : {})
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Falha ao contatar o modelo' }
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
      const client = new OpenAI({ baseURL, apiKey: apiKey || 'not-needed' })
      const page = await client.models.list()
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
    (_, request: { path: string; task: string; agent?: 'aider' | 'codex' }) => {
      if (codeAgentProc) return { success: false, error: 'Já existe um agente de código rodando' }
      const dir = request.path
      if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
        return { success: false, error: 'Diretório do projeto inválido' }
      }
      const task = typeof request.task === 'string' ? request.task.trim() : ''
      if (!task) return { success: false, error: 'Tarefa vazia' }
      const cfg = loadAIConfig()
      if (!cfg.baseUrl || !cfg.model) {
        return { success: false, error: 'Configuração de IA incompleta (Base URL / Model)' }
      }
      const agent = request.agent === 'codex' ? 'codex' : 'aider'
      const { cmd, args, taskFile } = buildAgentCommand(agent, task, cfg)

      // Resolve to a real .exe when possible and spawn it directly (safe, no
      // shell). Fall back to a shell only on Windows for .cmd/.bat wrappers.
      const resolved = resolveExecutable(cmd)
      const isExe = resolved !== null && /\.exe$/i.test(resolved)
      const spawnCmd = isExe && resolved ? resolved : cmd
      const useShell = process.platform === 'win32' && !isExe

      const send = (channel: string, data: unknown): void =>
        mainWindow?.webContents.send(channel, data)
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
          child.stdout?.on('data', (d: Buffer) => send('ai:code-agent:output', d.toString()))
          child.stderr?.on('data', (d: Buffer) => send('ai:code-agent:output', d.toString()))
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
            send('ai:code-agent:output', `\n[erro ao iniciar ${cmd}: ${msg}]\n`)
            codeAgentProc = null
            cleanup()
            send('ai:code-agent:exit', -1)
            if (!settled) {
              settled = true
              resolve({ success: false, error: msg })
            }
          })
          child.on('close', (code) => {
            codeAgentProc = null
            cleanup()
            send('ai:code-agent:exit', code ?? 0)
          })
        }
      )
    }
  )

  ipcMain.handle('ai:code-agent:stop', () => {
    killCodeAgent()
  })

  ipcMain.handle('ai:code-agent:status', () => ({ running: codeAgentProc !== null }))

  ipcMain.handle('ai:pick-directory', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled || filePaths.length === 0) return { path: null }
    return { path: filePaths[0] }
  })

  // --- Read-only code access (for the assistant to analyze source) ---
  // Every path is confined to `root`; nothing outside it can be read.
  const CODE_IGNORE = new Set([
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    '.git',
    '.vite',
    '.next',
    '.turbo'
  ])

  const confineToRoot = (root: string, rel: string): string | null => {
    const base = resolve(root)
    const full = resolve(base, rel)
    if (full !== base && !full.startsWith(base + sep)) return null
    return full
  }

  const walkFiles = (root: string, sub: string, cap: number): { files: string[]; truncated: boolean } => {
    const files: string[] = []
    const start = confineToRoot(root, sub)
    let truncated = false
    if (!start || !existsSync(start)) return { files, truncated }
    const stack = [start]
    while (stack.length && files.length < cap) {
      const dir = stack.pop() as string
      let entries: import('fs').Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (files.length >= cap) {
          truncated = true
          break
        }
        if (e.isDirectory()) {
          if (CODE_IGNORE.has(e.name) || e.name.startsWith('.')) continue
          stack.push(join(dir, e.name))
        } else if (e.isFile()) {
          files.push(relative(resolve(root), join(dir, e.name)).replace(/\\/g, '/'))
        }
      }
    }
    if (stack.length) truncated = true
    return { files: files.sort(), truncated }
  }

  ipcMain.handle('ai:code:list', (_, root: string, sub?: string) => {
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

  ipcMain.handle('ai:code:search', (_, root: string, term: string) => {
    if (!root || !existsSync(root)) return { error: 'Diretório inválido' }
    if (!term) return { error: 'Termo vazio' }
    const { files } = walkFiles(root, '.', 3000)
    const matches: { file: string; line: number; text: string }[] = []
    const CAP = 60
    const lower = term.toLowerCase()
    for (const rel of files) {
      if (matches.length >= CAP) break
      let content: string
      try {
        content = readFileSync(join(resolve(root), rel), 'utf-8')
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

  // --- AI conversation history ---
  ipcMain.handle('ai:conversations:list', () =>
    loadConversations()
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  )

  ipcMain.handle('ai:conversations:get', (_, id: string) =>
    loadConversations().find((c) => c.id === id) ?? null
  )

  ipcMain.handle(
    'ai:conversations:save',
    (_, conv: { id: string; title: string; messages: StoredConversation['messages'] }) => {
      const list = loadConversations()
      const now = new Date().toISOString()
      const idx = list.findIndex((c) => c.id === conv.id)
      if (idx >= 0) {
        list[idx] = { ...list[idx], title: conv.title, messages: conv.messages, updatedAt: now }
      } else {
        list.push({
          id: conv.id,
          title: conv.title,
          messages: conv.messages,
          createdAt: now,
          updatedAt: now
        })
      }
      saveConversations(list)
    }
  )

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
