// Native code agent — a tool-calling loop that reads, writes and runs commands
// in a project's code folder, driven by an OpenAI-compatible provider.
//
// This replaces the external `codex` CLI (see the run handler in index.ts). The
// trade is deliberate and worth stating: codex ran the model's edits inside an
// OS-level sandbox (Seatbelt/macOS, Landlock/Linux) and authenticated itself.
// This loop has NEITHER — so the only barriers between the model and the disk
// are (1) `confineToRoot`, which pins every path to the project folder, and
// (2) per-action approval, asked before any write or command runs. Both are
// load-bearing; neither is optional.
//
// No Electron in here on purpose: the model call, the approval prompt and the
// command runner are all injected (RunAgentDeps), so the loop and the tool
// handlers are testable against a temp dir and a stub provider. index.ts wires
// the real provider, the IPC approval round-trip and child_process.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import { join, dirname, resolve } from 'path'
import { confineToRoot, walkFiles } from './code-files'

// ---------------------------------------------------------------------------
// Types — the tool wire format (OpenAI-compatible) and the loop's messages.
// ---------------------------------------------------------------------------

/** An OpenAI-format function/tool definition, sent to the model each turn. */
export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** A tool call the model asked for, in the OpenAI/DeepSeek wire format. */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** A message on the wire — assistant turns may carry tool_calls, tool turns a result. */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/** Tokens billed by one model call, normalised. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/** The result of running one tool, as fed back to the model. */
export interface ToolResult {
  /** JSON string handed back to the model as the `tool` message content. */
  content: string
  /** One-line human summary for the panel (not sent to the model). */
  summary: string
}

// ---------------------------------------------------------------------------
// Tool definitions — the schema of each tool the agent may call.
// ---------------------------------------------------------------------------

/** Cap on a single ler_arquivo window — a big file is resent every step. */
export const READ_LIMIT_DEFAULT = 20000
const READ_LIMIT_MAX = 60000

/** Cap on executar_comando output, so a chatty command can't flood the context. */
export const COMMAND_OUTPUT_CAP = 20000

/** Default and ceiling for a command's wall-clock budget. */
export const COMMAND_TIMEOUT_DEFAULT_MS = 60_000
export const COMMAND_TIMEOUT_MAX_MS = 300_000

/** How many files buscar_no_codigo / listar_arquivos will walk. */
const WALK_CAP = 3000
const SEARCH_MATCH_CAP = 60

function fn(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters } }
}

/** The tools the code agent exposes, in Portuguese to match the rest of the app. */
export const CODE_AGENT_TOOLS: ToolDef[] = [
  fn(
    'listar_arquivos',
    'Lista os arquivos do projeto (recursivo; ignora node_modules/.git/dist). Use para ' +
      'entender a estrutura antes de ler ou editar.',
    {
      type: 'object',
      properties: {
        subpasta: { type: 'string', description: 'Subpasta relativa (opcional, ex: src/main)' }
      },
      additionalProperties: false
    }
  ),
  fn(
    'ler_arquivo',
    'Lê um arquivo pelo caminho relativo. Devolve até ~20 mil caracteres por vez; use ' +
      '"inicio" (em caracteres) para continuar de onde parou quando "truncado" for verdadeiro.',
    {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
        inicio: { type: 'number', description: 'Posição inicial em caracteres (opcional, padrão 0)' },
        max_chars: { type: 'number', description: 'Máximo de caracteres (opcional, teto 60000)' }
      },
      required: ['caminho'],
      additionalProperties: false
    }
  ),
  fn(
    'buscar_no_codigo',
    'Busca um texto no código do projeto (grep). Retorna as ocorrências agrupadas por arquivo, ' +
      'com a linha de cada uma. Use antes de editar, para localizar onde mexer.',
    {
      type: 'object',
      properties: { termo: { type: 'string', description: 'Texto a buscar' } },
      required: ['termo'],
      additionalProperties: false
    }
  ),
  fn(
    'escrever_arquivo',
    'Escreve (cria ou sobrescreve) um arquivo com o conteúdo dado. Passa por APROVAÇÃO do ' +
      'usuário antes de gravar. Prefira editar arquivos que já existem a criar novos; para uma ' +
      'edição pontual, leia o arquivo antes e reescreva o conteúdo inteiro já com a mudança.',
    {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
        conteudo: { type: 'string', description: 'Conteúdo completo do arquivo' }
      },
      required: ['caminho', 'conteudo'],
      additionalProperties: false
    }
  ),
  fn(
    'executar_comando',
    'Roda um comando de shell na raiz do projeto (ex.: rodar testes, build, instalar deps). ' +
      'Passa por APROVAÇÃO do usuário antes de rodar. Tem timeout e a saída é limitada.',
    {
      type: 'object',
      properties: {
        comando: { type: 'string', description: 'Comando a executar (ex.: "npm test")' },
        timeout_ms: { type: 'number', description: 'Timeout em ms (opcional, padrão 60000, teto 300000)' }
      },
      required: ['comando'],
      additionalProperties: false
    }
  )
]

/** Tools that mutate the disk / run code — gated behind per-action approval. */
const APPROVAL_TOOLS = new Set(['escrever_arquivo', 'executar_comando'])

/** Whether a tool must be approved by the user before it runs. */
export function needsApproval(name: string): boolean {
  return APPROVAL_TOOLS.has(name)
}

// ---------------------------------------------------------------------------
// Tool execution.
// ---------------------------------------------------------------------------

/** How executar_comando actually runs — injectable so tests don't spawn shells. */
export type CommandRunner = (
  command: string,
  opts: { cwd: string; timeoutMs: number }
) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut?: boolean }>

/** Default runner: child_process.exec, async so it never freezes the main loop. */
export const defaultCommandRunner: CommandRunner = (command, { cwd, timeoutMs }) =>
  new Promise((resolveRun) => {
    // exec (not execSync) on purpose: execSync would block Electron's main event
    // loop — and its IPC and window controls — for the command's whole duration.
    const child = exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: COMMAND_OUTPUT_CAP * 4, windowsHide: true },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number; killed?: boolean; signal?: string }) | null
        resolveRun({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: e && typeof e.code === 'number' ? e.code : e ? 1 : 0,
          // `timeout` kills with SIGTERM, surfaced as killed — report it as such
          // rather than as a plain non-zero exit.
          timedOut: !!(e && (e.killed || e.signal === 'SIGTERM'))
        })
      }
    )
    child.on('error', () => resolveRun({ stdout: '', stderr: '', code: 1 }))
  })

/** Everything a tool handler needs: the confined root and how to run commands. */
export interface ToolContext {
  /** The project folder every path is confined to. */
  root: string
  run?: CommandRunner
}

function jsonResult(obj: unknown, summary: string): ToolResult {
  return { content: JSON.stringify(obj), summary }
}

function clampNum(v: unknown, def: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return def
  return Math.min(Math.floor(v), max)
}

/** Run one tool call against `ctx`. Never throws — errors come back as results. */
export async function runCodeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'listar_arquivos':
        return await listFiles(args, ctx)
      case 'ler_arquivo':
        return readFileTool(args, ctx)
      case 'buscar_no_codigo':
        return await searchCode(args, ctx)
      case 'escrever_arquivo':
        return writeFileTool(args, ctx)
      case 'executar_comando':
        return await runCommand(args, ctx)
      default:
        return jsonResult({ error: `Ferramenta desconhecida: ${name}` }, `desconhecida: ${name}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na ferramenta'
    return jsonResult({ error: msg }, `erro: ${msg}`)
  }
}

async function listFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sub = typeof args.subpasta === 'string' && args.subpasta.trim() ? args.subpasta : '.'
  const { files, truncated } = await walkFiles(ctx.root, sub, WALK_CAP)
  return jsonResult(
    { arquivos: files, total: files.length, truncado: truncated },
    `${files.length} arquivo(s)${truncated ? '+' : ''} em ${sub}`
  )
}

function readFileTool(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const rel = typeof args.caminho === 'string' ? args.caminho : ''
  if (!rel) return jsonResult({ error: 'Caminho vazio' }, 'caminho vazio')
  const full = confineToRoot(ctx.root, rel)
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    return jsonResult({ error: 'Arquivo inválido ou fora do projeto' }, `inválido: ${rel}`)
  }
  const content = readFileSync(full, 'utf-8')
  const total = content.length
  const page = clampNum(args.max_chars, READ_LIMIT_DEFAULT, READ_LIMIT_MAX)
  const start =
    typeof args.inicio === 'number' && Number.isFinite(args.inicio) && args.inicio > 0
      ? Math.min(Math.floor(args.inicio), total)
      : 0
  const slice = content.slice(start, start + page)
  const end = start + slice.length
  const truncado = end < total
  return jsonResult(
    { conteudo: slice, total, inicio: start, truncado, ...(truncado ? { proximoInicio: end } : {}) },
    `leu ${rel} (${slice.length}/${total} chars)`
  )
}

async function searchCode(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const termo = typeof args.termo === 'string' ? args.termo : ''
  if (!termo) return jsonResult({ error: 'Termo vazio' }, 'termo vazio')
  const { files } = await walkFiles(ctx.root, '.', WALK_CAP)
  const base = resolve(ctx.root)
  const lower = termo.toLowerCase()
  const byFile = new Map<string, { linha: number; texto: string }[]>()
  let count = 0
  for (const rel of files) {
    if (count >= SEARCH_MATCH_CAP) break
    let content: string
    try {
      content = await readFile(join(base, rel), 'utf-8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue // skip binaries
    const lines = content.split('\n')
    for (let i = 0; i < lines.length && count < SEARCH_MATCH_CAP; i++) {
      if (lines[i].toLowerCase().includes(lower)) {
        const arr = byFile.get(rel) ?? []
        arr.push({ linha: i + 1, texto: lines[i].trim().slice(0, 200) })
        byFile.set(rel, arr)
        count++
      }
    }
  }
  const arquivos = [...byFile].map(([arquivo, ocorrencias]) => ({ arquivo, ocorrencias }))
  return jsonResult(
    { arquivos, total: count, truncado: count >= SEARCH_MATCH_CAP },
    `"${termo}": ${count} ocorrência(s) em ${arquivos.length} arquivo(s)`
  )
}

function writeFileTool(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const rel = typeof args.caminho === 'string' ? args.caminho : ''
  if (!rel) return jsonResult({ error: 'Caminho vazio' }, 'caminho vazio')
  if (typeof args.conteudo !== 'string') {
    return jsonResult({ error: 'conteudo deve ser texto' }, 'conteúdo inválido')
  }
  const full = confineToRoot(ctx.root, rel)
  // The path is the model's, so confinement is the barrier: a `../` escape must
  // never reach writeFileSync. This is checked here even though the loop also
  // asked the user — approval covers intent, confinement covers reach.
  if (!full) return jsonResult({ error: 'Caminho fora do projeto' }, `fora da raiz: ${rel}`)
  const existed = existsSync(full)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, args.conteudo, 'utf-8')
  return jsonResult(
    { ok: true, caminho: rel, criado: !existed, bytes: Buffer.byteLength(args.conteudo, 'utf-8') },
    `${existed ? 'sobrescreveu' : 'criou'} ${rel}`
  )
}

async function runCommand(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const comando = typeof args.comando === 'string' ? args.comando.trim() : ''
  if (!comando) return jsonResult({ error: 'Comando vazio' }, 'comando vazio')
  const timeoutMs = clampNum(args.timeout_ms, COMMAND_TIMEOUT_DEFAULT_MS, COMMAND_TIMEOUT_MAX_MS)
  const runner = ctx.run ?? defaultCommandRunner
  const { stdout, stderr, code, timedOut } = await runner(comando, { cwd: ctx.root, timeoutMs })
  // Cap the combined output: a command that prints megabytes must not blow up
  // the context that every later step of the run pays for again.
  const cap = (s: string): string => (s.length > COMMAND_OUTPUT_CAP ? s.slice(0, COMMAND_OUTPUT_CAP) + '\n…(saída truncada)' : s)
  return jsonResult(
    {
      comando,
      code,
      ...(timedOut ? { timeout: true } : {}),
      stdout: cap(stdout),
      stderr: cap(stderr)
    },
    timedOut ? `\`${comando}\` expirou o timeout` : `\`${comando}\` saiu com código ${code}`
  )
}

// ---------------------------------------------------------------------------
// System prompt assembly (task 5).
// ---------------------------------------------------------------------------

/** The behavioural rules, kept out of the assembler so they read as prose. */
const BEHAVIOR = `Você é um agente de código autônomo trabalhando num projeto do usuário. Sua tarefa é implementar a mudança pedida editando os arquivos do projeto.

Regras de comportamento:
- EDITE arquivos que já existem em vez de criar novos, a menos que um arquivo novo seja claramente necessário.
- Mantenha o ESTILO do código ao redor: convenções de nome, indentação, aspas, densidade de comentários. Escreva código que pareça escrito por quem escreveu o resto.
- Localize primeiro (buscar_no_codigo, ler_arquivo) e só então edite. Não adivinhe caminhos.
- escrever_arquivo grava o arquivo INTEIRO — leia o arquivo antes e reescreva o conteúdo completo já com a alteração, para não apagar o resto.
- Use executar_comando para rodar testes/build e verificar seu trabalho quando fizer sentido.
- Não faça commit nem mexa no histórico do git — isso é do usuário.
- Ao terminar, responda em texto (sem chamar ferramentas) com um resumo curto do que mudou.`

/** Escape nothing — this is prompt text; just splice the pieces together. */
export function buildSystemPrompt(opts: { tree?: string; guide?: string; files?: string[] }): string {
  const parts: string[] = [BEHAVIOR]
  if (opts.guide && opts.guide.trim()) {
    parts.push(`## GUIA DO PROJETO (GUIDE.md / AGENTS.md)\n\n${opts.guide.trim()}`)
  }
  if (opts.tree && opts.tree.trim()) {
    parts.push(`## ESTRUTURA DE ARQUIVOS\n\n${opts.tree.trim()}`)
  }
  if (opts.files && opts.files.length) {
    parts.push(
      `## ARQUIVOS INDICADOS PARA ESTA TAREFA\n\n` +
        `Comece por estes (edite-os se fizer sentido):\n` +
        opts.files.map((f) => `- ${f}`).join('\n')
    )
  }
  return parts.join('\n\n')
}

/** A GUIDE.md / AGENTS.md at the project root, or '' — best-effort. */
export function readProjectGuide(root: string): string {
  for (const name of ['GUIDE.md', 'AGENTS.md', 'CLAUDE.md']) {
    const p = confineToRoot(root, name)
    if (p && existsSync(p) && statSync(p).isFile()) {
      try {
        return readFileSync(p, 'utf-8')
      } catch {
        /* unreadable — try the next candidate */
      }
    }
  }
  return ''
}

/** A compact directory listing for the prompt: relative paths, one per line. */
export async function dirTree(root: string, cap = 400): Promise<string> {
  const { files, truncated } = await walkFiles(root, '.', cap)
  return files.join('\n') + (truncated ? '\n…(lista truncada)' : '')
}

// ---------------------------------------------------------------------------
// The loop (task 4).
// ---------------------------------------------------------------------------

/** Safety cap on model→tools rounds, so a stuck agent can't spin forever. */
export const CODE_AGENT_MAX_STEPS = 30

/** Everything the loop needs from the outside, all injectable for tests. */
export interface RunAgentDeps {
  /** One round-trip to the model with the tools attached. */
  callModel: (messages: AgentMessage[], tools: ToolDef[]) => Promise<{ message: AgentMessage; usage?: TokenUsage }>
  /** Ask the user to approve a write/command. Resolves true to run it. */
  approve: (call: { name: string; args: Record<string, unknown> }) => Promise<boolean>
  /** How executar_comando runs (defaults to a real shell). */
  run?: CommandRunner
  /** Announce a tool call as it's about to run (name + args). */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  /** Announce a tool result (short human summary). */
  onToolResult?: (name: string, summary: string) => void
  /** The model's prose between tool calls (its plan / final answer). */
  onText?: (text: string) => void
  /** Tokens billed by each model call. */
  onUsage?: (usage: TokenUsage) => void
  /** Checked between steps; true stops the run. */
  shouldAbort?: () => boolean
  maxSteps?: number
}

export interface RunAgentResult {
  /** The model's final text answer (empty if it never produced one). */
  answer: string
  /** How many model rounds ran. */
  steps: number
  /** True when the step cap or an abort ended it before a final answer. */
  stopped: boolean
}

/**
 * The tool-calling loop: send the conversation + tools to the model; while it
 * answers with tool_calls, run each (asking approval for writes/commands) and
 * feed the results back; stop when it answers with plain text, or at maxSteps.
 */
export async function runCodeAgent(
  systemPrompt: string,
  task: string,
  ctx: ToolContext,
  deps: RunAgentDeps
): Promise<RunAgentResult> {
  const maxSteps = deps.maxSteps && deps.maxSteps > 0 ? Math.floor(deps.maxSteps) : CODE_AGENT_MAX_STEPS
  const msgs: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task }
  ]

  for (let step = 0; step < maxSteps; step++) {
    if (deps.shouldAbort?.()) return { answer: 'Execução interrompida.', steps: step, stopped: true }

    const { message, usage } = await deps.callModel(msgs, CODE_AGENT_TOOLS)
    if (usage) deps.onUsage?.(usage)
    // Normalise: some providers omit content on a tool-only turn.
    const assistant: AgentMessage = {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls && message.tool_calls.length ? { tool_calls: message.tool_calls } : {})
    }
    msgs.push(assistant)

    const text = assistant.content.trim()
    if (text) deps.onText?.(text)

    const calls = assistant.tool_calls
    if (!calls || calls.length === 0) {
      return { answer: assistant.content, steps: step + 1, stopped: false }
    }

    for (const call of calls) {
      let args: Record<string, unknown> = {}
      let parseError = false
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        parseError = true
      }
      const name = call.function.name

      let result: ToolResult
      if (parseError) {
        result = jsonResult({ error: 'Argumentos inválidos (JSON)' }, `args inválidos: ${name}`)
      } else {
        deps.onToolCall?.(name, args)
        if (needsApproval(name) && !(await deps.approve({ name, args }))) {
          result = jsonResult({ error: 'Ação recusada pelo usuário' }, `recusado: ${name}`)
        } else {
          result = await runCodeTool(name, args, ctx)
        }
        deps.onToolResult?.(name, result.summary)
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: result.content })
    }
  }

  // Step cap hit: force one last text answer with tools disabled, so a run that
  // ran out of budget still summarises what it managed instead of ending mute.
  try {
    const { message, usage } = await deps.callModel(msgs, [])
    if (usage) deps.onUsage?.(usage)
    if (message.content?.trim()) deps.onText?.(message.content)
    return { answer: message.content ?? '', steps: maxSteps, stopped: true }
  } catch {
    return { answer: '', steps: maxSteps, stopped: true }
  }
}
