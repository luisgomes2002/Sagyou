// Native code agent — a tool-calling loop that reads, writes and runs commands
// in a project's code folder, driven by an OpenAI-compatible provider.
//
// The agent runs in-process with no OS-level sandbox of its own, so the only
// barriers between the model and the disk are (1) `confineToRoot`, which pins
// every path to the project folder, and (2) per-action approval, asked before
// any write or command runs. Both are load-bearing; neither is optional.
// Shell commands are further confined by ai-jail (see ./ai-jail.ts).
//
// No Electron in here on purpose: the model call, the approval prompt and the
// command runner are all injected (RunAgentDeps), so the loop and the tool
// handlers are testable against a temp dir and a stub provider. index.ts wires
// the real provider, the IPC approval round-trip and child_process.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import { dirname } from 'path'
import { promisify } from 'util'
import {
  confineToRoot,
  walkFiles,
  extractSymbol,
  extractLines,
  detectSymbols,
  searchFiles
} from './code-files'
import { fetchWeb, type FetchResult } from './web-fetch'
import { renderWeb } from './web-render'

const execAsync = promisify(exec)

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
  /** True when the result came from a short-lived cache without disk IO.
   *  The caller uses this to avoid counting the read toward brake limits. */
  cached?: boolean
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

/** Short-lived cache for ler_arquivo — same file re-read within 5s skips IO. */
const READ_CACHE_TTL_MS = 5_000
const readCache = new Map<string, { at: number; content: string }>()

// ---------------------------------------------------------------------------
// Read brakes — keep a runaway model from burning its step budget on loops.
//
// Identical to the chat agent's brakes in ../renderer/src/ai/agent.ts but
// adapted to the code agent's tool names and run-scoped state pattern. None of
// these are module-global — each call to runCodeAgent gets its own counters.
// ---------------------------------------------------------------------------

/** How many identical read calls before the brake fires. */
const READ_REPEAT_LIMIT = 3

/** How many blind whole-file reads of the same path before the brake fires. */
const BLIND_FILE_READ_LIMIT = 2

/** Max search terms kept for fuzzy-dup detection. */
const SEARCH_HISTORY_MAX = 5

function bumpCount(counts: Map<string, number>, key: string): number {
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return n
}

/**
 * Returns a key for blind whole-file reads, or null when the call is scoped
 * (simbolo / linha_inicio / linha_fim / inicio) or isn't a ler_arquivo call.
 */
function blindFileReadSignature(name: string, args: Record<string, unknown>): string | null {
  if (name !== 'ler_arquivo') return null
  const caminho = typeof args.caminho === 'string' ? args.caminho.trim() : ''
  if (!caminho) return null
  const targeted =
    (typeof args.simbolo === 'string' && (args.simbolo as string).trim() !== '') ||
    typeof args.linha_inicio === 'number' ||
    typeof args.linha_fim === 'number' ||
    typeof args.inicio === 'number'
  if (targeted) return null
  return `ler_arquivo:${caminho}`
}

/**
 * Warns when the model searches for a term that overlaps with an earlier
 * search — the earlier results likely already cover this one. Returns the
 * warning string or null. Side-effect: records the term in history.
 */
function fuzzySearchWarning(history: string[], args: Record<string, unknown>): string | null {
  const raw = args.termo
  const term = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!term) return null
  let warning: string | null = null
  for (const prev of history) {
    if (prev === term) continue
    if (prev.includes(term) || term.includes(prev)) {
      warning =
        `Você já buscou por "${prev}" nesta execução — os resultados anteriores ` +
        `provavelmente já cobrem "${term}". Prefira reusá-los a repetir a busca.`
      break
    }
  }
  history.push(term)
  while (history.length > SEARCH_HISTORY_MAX) history.shift()
  return warning
}

/** Merge an `aviso` into a JSON result. Non-JSON results are left untouched. */
function withAviso(result: string, aviso: string): string {
  try {
    const parsed = JSON.parse(result)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...parsed, aviso })
    }
  } catch {
    // not JSON — leave it alone
  }
  return result
}

function fn(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters } }
}

/** The tools the code agent exposes, in Portuguese to match the rest of the app. */
// ---------------------------------------------------------------------------
// Research sub-agent — a lighter tool set for web/docs research tasks.
// The sub-agent runs with a smaller step budget and can't mutate the project.
// ---------------------------------------------------------------------------

/** Max steps for a research sub-agent spawned via pesquisar_agente. */
export const RESEARCH_AGENT_MAX_STEPS = 15
/** A parent run may delegate only bounded, independent research. */
export const MAX_RESEARCH_SUBAGENTS_PER_RUN = 2
/** Prevent a research report from becoming the next prompt's whole context. */
export const RESEARCH_RESULT_CHAR_CAP = 6_000
/** A single completion must not fan out into an unbounded tool payload. */
export const MAX_TOOL_CALLS_PER_STEP = 8

/** Read-only tools the research sub-agent may call. No writes, no shell. */
export const RESEARCH_AGENT_TOOLS: ToolDef[] = [
  fn(
    'listar_arquivos',
    'Lista os arquivos do projeto (recursivo; exclui node_modules/.git/dist). ' +
      'Se truncado, use inicio=nextOffset para continuar.',
    {
      type: 'object',
      properties: {
        subpasta: { type: 'string', description: 'Subpasta relativa (opcional)' },
        inicio: {
          type: 'number',
          description: 'Posição na lista (opcional, use nextOffset da resposta anterior)'
        },
        max_arquivos: { type: 'number', description: 'Máximo de arquivos (opcional, teto 400)' }
      },
      additionalProperties: false
    }
  ),
  fn(
    'ler_arquivo',
    'Lê um arquivo pelo caminho relativo. ' +
      '💡 Prefira simbolo (extrai função/classe) ou linha_inicio/linha_fim a ler o arquivo todo. ' +
      'Se truncado, use inicio=nextOffset para continuar.',
    {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
        simbolo: { type: 'string', description: 'Nome da função/classe a extrair (opcional)' },
        linha_inicio: { type: 'number', description: 'Primeira linha 1-based (opcional)' },
        linha_fim: { type: 'number', description: 'Última linha 1-based (opcional)' },
        inicio: { type: 'number', description: 'Posição em caracteres (opcional, padrão 0)' },
        max_chars: { type: 'number', description: 'Máx caracteres (opcional, teto 60000)' }
      },
      required: ['caminho'],
      additionalProperties: false
    }
  ),
  fn(
    'buscar_no_codigo',
    'Busca texto no código. Retorna ocorrências agrupadas por arquivo com linha e contexto. ' +
      'Filtre com incluir (ex: "*.ts") para reduzir ruído.',
    {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'Texto a buscar' },
        incluir: {
          type: 'string',
          description: 'Só arquivos que batem este padrão (ex: "*.ts", opcional)'
        },
        excluir: {
          type: 'string',
          description: 'Exclui arquivos que batem este padrão (ex: "*.test.ts", opcional)'
        },
        contexto: {
          type: 'number',
          description: 'Linhas de contexto ao redor de cada match (opcional, padrão 0)'
        }
      },
      required: ['termo'],
      additionalProperties: false
    }
  ),
  fn(
    'buscar_na_web',
    'Pesquisa uma página na internet. Use para consultar documentação, ' +
      'exemplos de código, APIs, ou qualquer informação online antes de editar. ' +
      'O conteúdo é limitado a ~8000 caracteres. Se a página exigir JavaScript ' +
      '(SPA), use renderizar_js=true.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL completa da página (http:// ou https://)' },
        renderizar_js: {
          type: 'boolean',
          description:
            'Renderiza a página num navegador headless (executa JavaScript). Mais ' +
            'lento; use só quando o fetch simples devolver pouco texto (opcional, padrão false)'
        }
      },
      required: ['url'],
      additionalProperties: false
    }
  )
]

export const CODE_AGENT_TOOLS: ToolDef[] = [
  fn(
    'listar_arquivos',
    'Lista os arquivos do projeto (recursivo; exclui node_modules/.git/dist). ' +
      'Se truncado, use inicio=nextOffset para continuar.',
    {
      type: 'object',
      properties: {
        subpasta: { type: 'string', description: 'Subpasta relativa (opcional)' },
        inicio: {
          type: 'number',
          description: 'Posição na lista (opcional, use nextOffset da resposta anterior)'
        },
        max_arquivos: { type: 'number', description: 'Máximo de arquivos (opcional, teto 400)' }
      },
      additionalProperties: false
    }
  ),
  fn(
    'ler_arquivo',
    'Lê um arquivo pelo caminho relativo. ' +
      '💡 Prefira simbolo (extrai função/classe) ou linha_inicio/linha_fim a ler o arquivo todo. ' +
      'Se truncado, use inicio=nextOffset para continuar.',
    {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
        simbolo: { type: 'string', description: 'Nome da função/classe a extrair (opcional)' },
        linha_inicio: { type: 'number', description: 'Primeira linha 1-based (opcional)' },
        linha_fim: { type: 'number', description: 'Última linha 1-based (opcional)' },
        inicio: { type: 'number', description: 'Posição em caracteres (opcional, padrão 0)' },
        max_chars: { type: 'number', description: 'Máx caracteres (opcional, teto 60000)' }
      },
      required: ['caminho'],
      additionalProperties: false
    }
  ),
  fn(
    'buscar_no_codigo',
    'Busca texto no código. Retorna ocorrências agrupadas por arquivo com linha e contexto. ' +
      'Filtre com incluir (ex: "*.ts") para reduzir ruído.',
    {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'Texto a buscar' },
        incluir: {
          type: 'string',
          description: 'Só arquivos que batem este padrão (ex: "*.ts", opcional)'
        },
        excluir: {
          type: 'string',
          description: 'Exclui arquivos que batem este padrão (ex: "*.test.ts", opcional)'
        },
        contexto: {
          type: 'number',
          description: 'Linhas de contexto ao redor de cada match (opcional, padrão 0)'
        }
      },
      required: ['termo'],
      additionalProperties: false
    }
  ),
  fn(
    'buscar_na_web',
    'Pesquisa uma página na internet. Use para consultar documentação, ' +
      'exemplos de código, APIs, ou qualquer informação online antes de editar. ' +
      'O conteúdo é limitado a ~8000 caracteres. Se a página exigir JavaScript ' +
      '(SPA), use renderizar_js=true.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL completa da página (http:// ou https://)' },
        renderizar_js: {
          type: 'boolean',
          description:
            'Renderiza a página num navegador headless (executa JavaScript). Mais ' +
            'lento; use só quando o fetch simples devolver pouco texto (opcional, padrão false)'
        }
      },
      required: ['url'],
      additionalProperties: false
    }
  ),
  fn(
    'escrever_arquivo',
    'Cria, sobrescreve ou edita um arquivo (requer aprovação). ' +
      '💡 Para edição pontual, prefira "procura"/"substitui" — só o trecho alterado é enviado. ' +
      '💡💡 Para MÚLTIPLAS edições no mesmo arquivo, use "edicoes": ' +
      '[{procura:"x",substitui:"y"}, ...] — todas são aplicadas em sequência ' +
      'numa única chamada, economizando passos.',
    {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo' },
        conteudo: {
          type: 'string',
          description: 'Conteúdo completo (obrigatório se não usar procura+substitui nem edicoes)'
        },
        procura: {
          type: 'string',
          description: 'Texto exato a substituir (opcional, use com substitui)'
        },
        substitui: {
          type: 'string',
          description: 'Novo texto no lugar de procura (opcional, use com procura)'
        },
        edicoes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              procura: { type: 'string', description: 'Texto exato a substituir' },
              substitui: { type: 'string', description: 'Novo texto' }
            },
            required: ['procura', 'substitui'],
            additionalProperties: false
          },
          description:
            'Múltiplas edições procura+substitui no mesmo arquivo em uma chamada (opcional)'
        }
      },
      required: ['caminho'],
      additionalProperties: false
    }
  ),
  fn(
    'rodar_subagente',
    'Dispara um sub-agente de pesquisa (read-only) para consultar documentação, ' +
      'exemplos ou APIs na web e no código. O sub-agente NÃO pode escrever nem executar comandos — ' +
      'só ler arquivos, buscar no código e acessar a internet. ' +
      'Use para pesquisas paralelas: dispare vários de uma vez e aguarde os resultados. ' +
      '⚠️ Máximo de ' +
      RESEARCH_AGENT_MAX_STEPS +
      ' passos por sub-agente. Retorna um resumo em texto.',
    {
      type: 'object',
      properties: {
        tarefa: {
          type: 'string',
          description:
            'A pergunta ou tarefa de pesquisa que o sub-agente deve investigar. ' +
            'Seja específico: inclua o que buscar, onde procurar e o formato esperado da resposta.'
        }
      },
      required: ['tarefa'],
      additionalProperties: false
    }
  ),
  fn(
    'executar_comando',
    'Roda um comando shell na raiz do projeto (requer aprovação). Timeout e saída limitados.',
    {
      type: 'object',
      properties: {
        comando: { type: 'string', description: 'Comando (ex.: "npm test")' },
        timeout_ms: {
          type: 'number',
          description: 'Timeout em ms (opcional, padrão 60000, teto 300000)'
        }
      },
      required: ['comando'],
      additionalProperties: false
    }
  )
]

/** Discovery tools — dropped from the set when the caller pins target files. */
const DISCOVERY_TOOLS = new Set(['listar_arquivos', 'buscar_no_codigo'])

/**
 * The tool set for a run. When the caller has pinned the target files, drop the
 * discovery tools: the agent's biggest waste is spending its step budget on
 * grep/list to re-find files it was already handed (and whose contents are now
 * inlined in the prompt). `ler_arquivo` stays — a pinned file may be larger than
 * the inlined preview, so paging the rest with `inicio` is still legitimate.
 */
export function codeToolsFor(opts: { pinnedFiles: boolean }): ToolDef[] {
  if (!opts.pinnedFiles) return CODE_AGENT_TOOLS
  return CODE_AGENT_TOOLS.filter((t) => !DISCOVERY_TOOLS.has(t.function.name))
}

/** Tools that mutate the disk / run code — gated behind per-action approval. */
const APPROVAL_TOOLS = new Set(['escrever_arquivo', 'executar_comando', 'rodar_subagente'])

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
  opts: { cwd: string; timeoutMs: number; shouldAbort?: () => boolean }
) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut?: boolean }>

/** Default runner: child_process.exec, async so it never freezes the main loop. */
export const defaultCommandRunner: CommandRunner = (command, { cwd, timeoutMs, shouldAbort }) =>
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
    // Abort poll: check shouldAbort every second and kill if the user stopped
    // the run. Without this, a 300s command is unkillable until it finishes.
    if (shouldAbort) {
      const interval = setInterval(() => {
        if (shouldAbort()) {
          child.kill('SIGTERM')
          clearInterval(interval)
        }
      }, 1_000)
      child.on('close', () => clearInterval(interval))
    }
  })

/** Everything a tool handler needs: the confined root and how to run commands. */
export interface ToolContext {
  /** Nesting depth for sub-agents. Omitted or 0 = top-level agent. */
  subAgentDepth?: number
  /** Research is useful only when bounded; kept per parent run, never global. */
  researchAgentsStarted?: number
  /** The project folder every path is confined to. */
  root: string
  run?: CommandRunner
  /** Checked periodically during long shell commands; true = abort early. */
  shouldAbort?: () => boolean
  /** Render a web page with JavaScript (SPA support). Only wired in production. */
  renderWeb?: (
    raw: unknown,
    deps?: { limiter?: unknown; timeoutMs?: number }
  ) => Promise<FetchResult>
}

function jsonResult(obj: unknown, summary: string, cached?: boolean): ToolResult {
  return { content: JSON.stringify(obj), summary, ...(cached ? { cached } : {}) }
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
        return await readFileTool(args, ctx)
      case 'buscar_no_codigo':
        return await searchCode(args, ctx)
      case 'buscar_na_web': {
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        if (!url) return { content: JSON.stringify({ error: 'URL vazia' }), summary: 'URL vazia' }
        const render =
          args.renderizar_js === true || args.render === true || args.renderizar === true
        const result = render ? await renderWeb(url) : await fetchWeb(url)
        if ('error' in result)
          return { content: JSON.stringify({ error: result.error }), summary: result.error }
        return {
          content: JSON.stringify({
            conteudo: result.content,
            url: result.url,
            truncado: result.truncated ?? false
          }),
          summary: `${url} (${result.truncated ? 'truncado' : (result.content?.length ?? 0) + ' chars'})`
        }
      }
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
  const total = files.length
  const pageSize = clampNum(args.max_arquivos, 200, 400)
  const start =
    typeof args.inicio === 'number' && args.inicio > 0
      ? Math.min(Math.floor(args.inicio), total)
      : 0
  const slice = files.slice(start, start + pageSize)
  const end = start + slice.length
  const truncado = truncated || end < total
  const extra: Record<string, unknown> = {}
  if (truncado) extra.nextOffset = end
  return jsonResult(
    { arquivos: slice, total, inicio: start, truncado, ...extra },
    `${slice.length}/${total} arquivo(s) em ${sub}${truncado ? '+' : ''}`
  )
}

async function readFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const rel = typeof args.caminho === 'string' ? args.caminho : ''
  if (!rel) return jsonResult({ error: 'Caminho vazio' }, 'caminho vazio')
  const full = confineToRoot(ctx.root, rel)
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    return jsonResult({ error: 'Arquivo inválido ou fora do projeto' }, `inválido: ${rel}`)
  }
  // Short-lived cache: mesma leitura em <5s evita IO repetido.
  const cached = readCache.get(full)
  if (cached && Date.now() - cached.at < READ_CACHE_TTL_MS) {
    // Update TTL on access so a file read across multiple steps stays warm.
    cached.at = Date.now()
  }
  const content = cached ? cached.content : await readFile(full, 'utf-8')
  const fromCache = !!cached
  if (!cached) {
    readCache.set(full, { at: Date.now(), content })
    if (readCache.size > 100) readCache.clear()
  }
  const total = content.length

  // Scoped read: a named symbol or a line range takes priority over paging.
  const simbolo =
    typeof args.simbolo === 'string' && args.simbolo.trim() !== '' ? args.simbolo.trim() : undefined
  const lineStart = typeof args.linha_inicio === 'number' ? args.linha_inicio : undefined
  const lineEnd = typeof args.linha_fim === 'number' ? args.linha_fim : undefined
  if (simbolo) {
    const extracted = extractSymbol(content, simbolo)
    if (extracted) {
      return jsonResult(
        {
          conteudo: extracted.content,
          simbolo,
          linha_inicio: extracted.linhaInicio,
          linha_fim: extracted.linhaFim
        },
        `leu ${simbolo} em ${rel}`,
        fromCache
      )
    }
    const symbols = detectSymbols(content)
    return jsonResult(
      { error: `Símbolo "${simbolo}" não encontrado`, simbolos: symbols },
      `símbolo "${simbolo}" não encontrado`,
      fromCache
    )
  }
  if (lineStart != null) {
    const extracted = extractLines(content, lineStart, lineEnd)
    return jsonResult(
      {
        conteudo: extracted.content,
        linha_inicio: extracted.linhaInicio,
        linha_fim: extracted.linhaFim
      },
      `leu linhas ${extracted.linhaInicio}-${extracted.linhaFim} de ${rel}`,
      fromCache
    )
  }

  const page = clampNum(args.max_chars, READ_LIMIT_DEFAULT, READ_LIMIT_MAX)
  const start =
    typeof args.inicio === 'number' && Number.isFinite(args.inicio) && args.inicio > 0
      ? Math.min(Math.floor(args.inicio), total)
      : 0
  const slice = content.slice(start, start + page)
  const end = start + slice.length
  const truncado = end < total
  const extra: Record<string, unknown> = {}
  if (truncado) extra.proximoInicio = end
  // When the file is larger than one page and no scope/paging was specified, offer
  // the symbol map so the model can re-read just what it needs.
  if (!truncado && total > page && !args.inicio && !args.simbolo && lineStart == null) {
    extra.simbolos = detectSymbols(content)
    extra.dica =
      'Arquivo grande demais para uma página. Use simbolo, linha_inicio/linha_fim ou inicio para ler trechos específicos.'
  }
  return jsonResult(
    { conteudo: slice, total, inicio: start, truncado, ...extra },
    `leu ${rel} (${slice.length}/${total} chars)`,
    fromCache
  )
}

/** Escape a string for safe use in a shell command. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''")
}

/** Parse grep -rn output lines into structured matches. */
function parseGrepOutput(lines: string[]): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = []
  // grep -rn output: "file:line:text" or "--" as group separator with -C
  for (const raw of lines) {
    if (!raw || raw === '--') continue
    const m = raw.match(/^([^:]+):(\d+):(.*)/)
    if (m) {
      out.push({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) })
      if (out.length >= SEARCH_MATCH_CAP) break
    }
  }
  return out
}

async function searchCode(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const termo = typeof args.termo === 'string' ? args.termo : ''
  if (!termo) return jsonResult({ error: 'Termo vazio' }, 'termo vazio')

  const incluir = typeof args.incluir === 'string' ? args.incluir.trim() : ''
  const excluir = typeof args.excluir === 'string' ? args.excluir.trim() : ''
  const contexto =
    typeof args.contexto === 'number' && args.contexto > 0 ? Math.floor(args.contexto) : 0

  // Try subprocess grep first (much faster than readFile per file), fall
  // back to the async readFile method when grep isn't available or fails.
  let matches: { file: string; line: number; text: string }[] = []
  let grepFailed = false

  try {
    const escaped = shellEscape(termo)
    const includeArg = incluir ? `--include="${shellEscape(incluir)}"` : ''
    const excludeArg = excluir ? `--exclude="${shellEscape(excluir)}"` : ''
    const contextArg = contexto > 0 ? `-C ${contexto}` : ''
    // -I: skip binary, -n: line numbers, --no-heading: no filename header per group
    const cmd = `grep -rnI --no-heading ${contextArg} ${includeArg} ${excludeArg} -m ${SEARCH_MATCH_CAP} -- '${escaped}' ${shellEscape(ctx.root)}`
    const { stdout } = await execAsync(cmd, {
      cwd: ctx.root,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000
    })
    const rawLines = stdout.split('\n').filter(Boolean)
    matches = parseGrepOutput(rawLines)
    // grep exits with 1 when no matches — not an error for us.
  } catch (e) {
    grepFailed = true
  }

  // Fallback: use shared searchFiles when grep is unavailable or found nothing.
  if (grepFailed || matches.length === 0) {
    const result = await searchFiles(ctx.root, termo, {
      cap: SEARCH_MATCH_CAP,
      contexto,
      incluir,
      excluir
    })
    matches = result.matches.map((m) => ({ file: m.file, line: m.line, text: m.text }))
  }

  // Group by file for the model (same format as before).
  const byFile = new Map<
    string,
    { linha: number; texto: string; antes?: string; depois?: string }[]
  >()
  for (const m of matches) {
    const arr = byFile.get(m.file) ?? []
    arr.push({ linha: m.line, texto: m.text })
    byFile.set(m.file, arr)
  }
  const arquivos = [...byFile].map(([arquivo, ocorrencias]) => ({ arquivo, ocorrencias }))
  return jsonResult(
    { arquivos, total: matches.length, truncado: matches.length >= SEARCH_MATCH_CAP },
    `"${termo}": ${matches.length} ocorrência(s) em ${arquivos.length} arquivo(s)`
  )
}

/** Find the closest matching line in text, for fuzzy error recovery. */
function closestMatch(
  needle: string,
  haystack: string
): { line: number; text: string; score: number } {
  const lines = haystack.split('\n')
  let best = { line: 0, text: '', score: 0 }
  const nLower = needle.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    let score = 0
    const lLower = l.toLowerCase()
    // Count common characters in order (simple similarity)
    let ni = 0
    for (const ch of lLower) {
      if (ni < nLower.length && ch === nLower[ni]) ni++
    }
    score = ni / nLower.length
    if (score > best.score) best = { line: i + 1, text: l.trim().slice(0, 120), score }
  }
  return best
}

/** Compute a simple line diff summary between two texts. */
function diffSummary(
  oldText: string,
  newText: string
): { linhasAdicionadas: number; linhasRemovidas: number } {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  // Count differing lines via simple LCS-like approach (not full)
  let added = 0
  let removed = 0
  const oMap = new Map<string, number>()
  for (const l of oldLines) oMap.set(l, (oMap.get(l) ?? 0) + 1)
  for (const l of newLines) {
    const n = oMap.get(l)
    if (n && n > 0) {
      oMap.set(l, n - 1)
    } else {
      added++
    }
  }
  for (const [, n] of oMap) if (n > 0) removed += n
  return { linhasAdicionadas: added, linhasRemovidas: removed }
}

function writeFileTool(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const rel = typeof args.caminho === 'string' ? args.caminho : ''
  if (!rel) return jsonResult({ error: 'Caminho vazio' }, 'caminho vazio')
  const full = confineToRoot(ctx.root, rel)
  if (!full) return jsonResult({ error: 'Caminho fora do projeto' }, `fora da raiz: ${rel}`)

  // Safety helper: when a procura fails, include a context snippet from the file
  // so the model can fix the search text without an extra read step.
  const failWithContext = (needle: string, content: string): ToolResult => {
    const closest = closestMatch(needle, content)
    const lines = content.split('\n')
    const ctxStart = Math.max(0, closest.line - 4)
    const ctxEnd = Math.min(lines.length, closest.line + 3)
    const snippet = lines
      .slice(ctxStart, ctxEnd)
      .map((l, i) => `${ctxStart + i + 1}: ${l}`)
      .join('\n')
    const suggestion =
      closest.score > 0.5
        ? `O texto mais próximo está na linha ${closest.line}: "${closest.text}". Contexto:\n${snippet}`
        : `Trecho ao redor da área esperada:\n${snippet}`
    return jsonResult(
      { error: `"${needle}" não encontrado. ${suggestion}` },
      'texto não encontrado'
    )
  }

  // Batch edit mode: varios [{procura, substitui}] de uma vez (#2, #9).
  const edicoes = Array.isArray(args.edicoes) ? args.edicoes : []
  if (edicoes.length > 0) {
    if (!existsSync(full))
      return jsonResult({ error: 'Arquivo não existe para editar' }, 'arquivo não existe')
    let content = readFileSync(full, 'utf-8')
    let aplicadas = 0
    for (const ed of edicoes) {
      const p = typeof ed.procura === 'string' ? ed.procura : ''
      const s = typeof ed.substitui === 'string' ? ed.substitui : ''
      if (!p || !s) continue
      if (!content.includes(p)) return failWithContext(p, content)
      content = content.replace(p, s)
      aplicadas++
    }
    if (aplicadas === 0) return jsonResult({ error: 'Nenhuma edição aplicada' }, 'sem mudança')
    writeFileSync(full, content, 'utf-8')
    return jsonResult(
      { ok: true, caminho: rel, edicoes: aplicadas, bytes: Buffer.byteLength(content, 'utf-8') },
      `batch edit em ${rel}: ${aplicadas} mudança(s)`
    )
  }

  // Patch mode: procura + substitui — substitui só um trecho sem reescrever o arquivo inteiro.
  const procura = typeof args.procura === 'string' ? args.procura : ''
  const substitui = typeof args.substitui === 'string' ? args.substitui : ''
  if (procura || substitui) {
    if (!procura)
      return jsonResult({ error: 'procura é obrigatório com substitui' }, 'procura vazio')
    if (!substitui)
      return jsonResult({ error: 'substitui é obrigatório com procura' }, 'substitui vazio')
    if (!existsSync(full))
      return jsonResult({ error: 'Arquivo não existe para fazer patch' }, 'arquivo não existe')
    const content = readFileSync(full, 'utf-8')
    if (!content.includes(procura)) return failWithContext(procura, content)
    const newContent = content.replace(procura, substitui)
    if (newContent === content) {
      return jsonResult({ error: 'substituição não alterou o arquivo' }, 'sem mudança')
    }
    writeFileSync(full, newContent, 'utf-8')
    const diff = diffSummary(content, newContent)
    return jsonResult(
      { ok: true, caminho: rel, patch: true, substituicoes: 1, ...diff },
      `patch em ${rel}: +${diff.linhasAdicionadas} -${diff.linhasRemovidas}`
    )
  }

  // Full content mode: escreve o arquivo inteiro.
  if (typeof args.conteudo !== 'string') {
    return jsonResult(
      { error: 'Informe conteudo (completo), procura+substitui (patch) ou edicoes (batch)' },
      'conteúdo inválido'
    )
  }
  const existed = existsSync(full)
  const oldContent = existed ? readFileSync(full, 'utf-8') : ''
  // Safety check: if the new content drops >30% of lines, flag it — the model
  // may have omitted previous agents' changes by accident.
  const oldLines = oldContent.split('\n').length
  const newLines = args.conteudo.split('\n').length
  const droppedLines = oldLines - newLines
  const alarm = existed && oldLines > 20 && droppedLines > oldLines * 0.3
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, args.conteudo, 'utf-8')
  const diff = existed
    ? diffSummary(oldContent, args.conteudo)
    : { linhasAdicionadas: args.conteudo.split('\n').length, linhasRemovidas: 0 }
  const extra: Record<string, unknown> = {}
  if (alarm) {
    extra.aviso = `⚠️ O novo conteúdo tem ${newLines} linhas, contra ${oldLines} do original (${droppedLines} a menos). Se uma funcionalidade anterior sumiu, você pode ter omitido ela sem querer. Leia o arquivo de novo e use procura+substitui ou edicoes para alterações pontuais.`
  }
  return jsonResult(
    {
      ok: true,
      caminho: rel,
      criado: !existed,
      bytes: Buffer.byteLength(args.conteudo, 'utf-8'),
      ...diff,
      ...extra
    },
    `${existed ? 'sobrescreveu' : 'criou'} ${rel} (+${diff.linhasAdicionadas} -${diff.linhasRemovidas})${alarm ? ' ⚠️ PERDA DE LINES?' : ''}`
  )
}

async function runCommand(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const comando = typeof args.comando === 'string' ? args.comando.trim() : ''
  if (!comando) return jsonResult({ error: 'Comando vazio' }, 'comando vazio')
  const timeoutMs = clampNum(args.timeout_ms, COMMAND_TIMEOUT_DEFAULT_MS, COMMAND_TIMEOUT_MAX_MS)
  const runner = ctx.run ?? defaultCommandRunner
  const { stdout, stderr, code, timedOut } = await runner(comando, {
    cwd: ctx.root,
    timeoutMs,
    shouldAbort: ctx.shouldAbort
  })
  // Cap the combined output: a command that prints megabytes must not blow up
  // the context that every later step of the run pays for again.
  const cap = (s: string): string =>
    s.length > COMMAND_OUTPUT_CAP ? s.slice(0, COMMAND_OUTPUT_CAP) + '\n…(saída truncada)' : s
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
const BEHAVIOR = `Você é um agente de código autônomo. Sua tarefa: implementar a mudança pedida editando arquivos do projeto.

⚠️  REGRA MAIS IMPORTANTE: Sua função é **implementar com ferramentas**, não só responder com texto. A tarefa que você recebeu descreve O QUE fazer e EM QUAIS arquivos. Você DEVE usar escrever_arquivo para criar ou modificar cada arquivo listado. Uma resposta em texto sem edições NÃO conta como tarefa concluída — você será reavaliado até produzir as mudanças. Se algo não existe no código ainda, é porque VOCÊ precisa criá-lo. Não conclua com "não é necessário implementar" a menos que a tarefa explicitamente peça só análise.

Só responda com texto DEPOIS que todos os arquivos estiverem escritos.

Regras:
- EDITE arquivos existentes em vez de criar novos (a menos que necessário).
- Mantenha o ESTILO do código ao redor (nomes, indentação, aspas, comentários).
- Se os arquivos já vierem indicados, vá direto. Senão, busque com buscar_no_codigo/ler_arquivo. Nunca adivinhe caminhos.
- escrever_arquivo tem DOIS modos: (1) conteudo — escreve o ARQUIVO INTEIRO, perigoso porque pode apagar mudanças anteriores; (2) procura+substitui — só troca um trecho, seguro. **Sempre prefira procura+substitui para edições pontuais.** Use conteudo só quando for criar um arquivo novo ou reescrever ele inteiro de propósito.
- Antes da primeira escrita, faça um plano curto: qual arquivo, o que muda, o que pode quebrar.
- Faça a MENOR mudança que resolve a task. Não reformate nem "melhore" código vizinho.
- Use executar_comando para rodar testes/build/lint e verificar.
- ⚠️  ANTES DE CONCLUIR: rode \`npm run typecheck\` para verificar erros de tipo. Se houver erros, LEIA cada um e conserte. Depois rode os testes com \`npx vitest run <arquivo-de-teste>\`. Se typecheck e testes passarem, responda com resumo.
- Comando falhou? LEIA o erro e conserte. Não repita o mesmo comando nem chute sem ler.
- ⚠️ AMBIENTE QUEBRADO: Se um comando falhar com código 127 (comando não encontrado) ou stderr contiver "not found", o ambiente NÃO tem Node.js/npm disponíveis. NÃO tente achar binários no filesystem — é perda de tempo. Apenas reporte no resumo: "Typecheck não pôde ser executado — node/npm não disponível neste ambiente. Rode \`npm run typecheck\` manualmente." e conclua. O mesmo vale para qualquer comando que dependa de ferramentas fora do projeto.
- Git: por padrão NÃO mexa no git — commits são feitos pelo usuário após revisar o diff.
  Se a tarefa pedir EXPLICITAMENTE operações de git, use executar_comando:
  \`git status --short\` — estado dos arquivos modificados
  \`git diff\` / \`git diff --stat\` — vê as alterações
  \`git diff --cached\` — vê o que já está em stage
  \`git log --oneline -10\` — últimos commits
  \`git add <arquivo>\` ou \`git add -A\` — stage
  \`git commit -m "mensagem"\` — commita. Use Conventional Commits em pt-BR:
    tipo: feat, fix, refactor, docs, style, test, chore, perf, ci
    formato: \`tipo(escopo): resumo curto e imperativo\`
    exemplos: \`feat(AI): tela de chat\`  \`fix(kanban): corrige drag-and-drop entre colunas\`  \`refactor(store): extrai lógica de persistência\`
  \`git push\` — sobe para o remote
  Se a tarefa NÃO mencionar git, mantenha o padrão: não commite nem mexa no git.
- Ao terminar, responda em texto com resumo do que mudou.

### Pesquisa na web
Você pode usar \`buscar_na_web\` para pesquisar documentação, exemplos de código ou qualquer informação online. **Sempre que estiver na dúvida sobre uma API, lib ou abordagem, pesquise primeiro** — é melhor gastar 1 passo pesquisando do que 5 passos tentando adivinhar. Prefira sites oficiais (npm, MDN, docs da lib). Cuidado com conteúdo gerado por IA que pode estar desatualizado.`

/** One pinned file's contents, to be inlined into the system prompt. */
export interface InlinedFile {
  path: string
  content: string
}

/** Cap on a single inlined file. A bigger file is truncated with a note and the
 *  agent pages the rest with ler_arquivo(inicio) — the whole prompt is resent
 *  every step, so an unbounded paste would tax the entire run. */
export const INLINE_FILE_CHAR_CAP = 6000
/** Cap on the total inlined across all pinned files, for the same reason. */
export const INLINE_TOTAL_CHAR_CAP = 12000

/**
 * Render pinned files as a numbered, capped block for the system prompt, so the
 * agent edits from context instead of spending a read step per file. Lines are
 * 1-based (matching an editor) so the model can reason about line ranges. A file
 * past the per-file cap — or once the total budget is spent — is truncated or
 * omitted and named in `omitted`, so the caller can tell the agent (and the log)
 * to read those on demand.
 */
export function inlineFilesBlock(files: InlinedFile[]): { text: string; omitted: string[] } {
  const parts: string[] = []
  const omitted: string[] = []
  let budget = INLINE_TOTAL_CHAR_CAP
  for (const f of files) {
    const cap = Math.min(INLINE_FILE_CHAR_CAP, budget)
    if (cap <= 0) {
      omitted.push(f.path)
      continue
    }
    const truncated = f.content.length > cap
    const slice = truncated ? f.content.slice(0, cap) : f.content
    budget -= slice.length
    if (truncated) omitted.push(f.path)
    const numbered = slice
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
      .join('\n')
    parts.push(
      `### ${f.path}${truncated ? ' (parcial — use ler_arquivo com "inicio" para o resto)' : ''}\n${numbered}`
    )
  }
  return { text: parts.join('\n\n'), omitted }
}

/** Escape nothing — this is prompt text; just splice the pieces together. */
export function buildSystemPrompt(opts: {
  tree?: string
  guide?: string
  files?: string[]
  /** Pre-rendered numbered contents of the pinned files (see inlineFilesBlock).
   *  When present, discovery is off and the agent edits from context. */
  fileContents?: string
  /** Preformatted memory briefing (see formatMemoriesForPrompt), shared with the chat. */
  memories?: string
  /** Preformatted briefing of relevant past conversations (see briefConversationsForTask). */
  conversas?: string
  /** Scope decisions already agreed with the user, to be respected without re-deciding. */
  decisoes?: string[]
  /** When true, the agent must NOT run commands (shell, typecheck, tests) — the
   *  environment lacks Node. The BEHAVIOR typecheck rule is overridden. */
  noCommands?: boolean
}): string {
  const parts: string[] = [BEHAVIOR]
  if (opts.noCommands) {
    parts.push(
      '## INSTRUÇÃO (sobrescreve as regras de comandos acima)\n\n' +
        '⚠️  NÃO execute nenhum comando shell nesta run. O ambiente NÃO tem ' +
        'Node.js, npm nem binários externos. Não tente rodar typecheck, testes, ' +
        'lint ou qualquer comando — é perda de tempo e passos. Apenas edite os ' +
        'arquivos e responda com o resumo. Não tente achar binários alternativos.'
    )
  }
  if (opts.memories && opts.memories.trim()) {
    parts.push(opts.memories.trim())
  }
  if (opts.conversas && opts.conversas.trim()) {
    parts.push(opts.conversas.trim())
  }
  // Decisions the chat already settled with the user: constraints, not
  // suggestions. High in the prompt so the agent honours them before it starts
  // editing, and doesn't reopen a fallback/scope choice that was already made.
  const decisoes = (opts.decisoes ?? []).map((d) => d.trim()).filter((d) => d)
  if (decisoes.length) {
    parts.push(
      `## DECISÕES JÁ TOMADAS (RESPEITE, NÃO RE-DECIDA)\n\n` +
        `Estas escolhas já foram acertadas com o usuário. Siga-as sem re-perguntar nem ` +
        `reabrir a discussão:\n` +
        decisoes.map((d) => `- ${d}`).join('\n')
    )
  }
  if (opts.guide && opts.guide.trim()) {
    parts.push(`## GUIA DO PROJETO (GUIDE.md / AGENTS.md)\n\n${opts.guide.trim()}`)
  }
  if (opts.tree && opts.tree.trim()) {
    parts.push(`## ESTRUTURA DE ARQUIVOS\n\n${opts.tree.trim()}`)
  }
  if (opts.fileContents && opts.fileContents.trim()) {
    // Pinned + inlined: the files are already here with line numbers and the
    // discovery tools are off, so tell the agent plainly not to re-fetch them.
    parts.push(
      `## ARQUIVOS INDICADOS (JÁ NO CONTEXTO)\n\n` +
        `Estes são os arquivos a editar; o conteúdo abaixo já vem com números de linha. ` +
        `NÃO gaste passos relendo nem buscando — edite direto a partir daqui. ` +
        `As ferramentas de busca (listar_arquivos, buscar_no_codigo) estão desativadas nesta run. ` +
        `Se um arquivo estiver marcado "parcial", use ler_arquivo com "inicio" para ver o resto.\n\n` +
        opts.fileContents.trim()
    )
  } else if (opts.files && opts.files.length) {
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

/** Safety cap on model→tools rounds, so a stuck agent can't spin forever.
 *  ⚠️ Each step resends the whole accumulated history, so cost grows worse than
 *  linearly in this number — it's a circuit breaker, not a budget. Raised to 60
 *  to give weaker models room to recover (read error → fix → re-run costs a few
 *  steps per edit, and a run that succeeds still stops early, so the ceiling only
 *  bites on a genuinely failing run); the real fix is spending fewer steps, not a
 *  higher ceiling. */
export const CODE_AGENT_MAX_STEPS = 100

/** Budget selected by the IPC launcher when the user did not configure one. */
export function suggestCodeAgentSteps(task: string): number {
  const text = task
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  const broadRedesign =
    /\b(refaca|redesenh|redesign|design.*(pagina|tela)|pagina.*(inteira|toda)|tela.*(inteira|toda)|layout completo)\b/.test(
      text
    )
  if (broadRedesign) return 25

  const narrow = /\b(css|font-size|fonte|cor|label|tag|formatduration|cronometro)\b/.test(text)
  const change = /\b(corri|implement|adicione|altere|mude|reduz|aument|troque|ajuste)\w*/.test(text)
  if (narrow && change) return 4
  if (
    /\b(arquitetura|migr|refator.*ampl|varios arquivos|multiplos arquivos|integracao|performance|investig|depura|debug)\w*/.test(
      text
    )
  )
    return 15
  return change ? 8 : 15
}

/**
 * How many steps between progressive summarisation passes. Longer than the
 * chat agent (8) because the code agent reads/writes large files and needs
 * more context to stay coherent. Still keeps per-step cost bounded.
 */
const SUMMARIZE_INTERVAL = 10

/** How many recent messages to keep intact after summarisation (≈ 3 exchanges). */
const KEEP_RECENT = 6

/** Everything the loop needs from the outside, all injectable for tests. */
export interface RunAgentDeps {
  /** One round-trip to the model with the tools attached. */
  callModel: (
    messages: AgentMessage[],
    tools: ToolDef[]
  ) => Promise<{ message: AgentMessage; usage?: TokenUsage }>
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
  /** Tool set to offer the model. Defaults to CODE_AGENT_TOOLS; a pinned-file
   *  run passes the reduced set from codeToolsFor (no discovery tools). */
  tools?: ToolDef[]
  /** A transient model-call failure is being retried: attempt (1-based), the
   *  max, the backoff in ms, and why. For the panel's "retentando em Ns…" line. */
  onRetry?: (attempt: number, max: number, waitMs: number, reason: string) => void
  /** Backoff sleep, injectable so tests don't wait real seconds. Defaults to real. */
  sleep?: (ms: number) => Promise<void>
  /** The current step is beginning: step (1-based) of maxSteps. Drives the
   *  panel's live "Passo X/Y" counter alongside the running token total. */
  onStep?: (step: number, maxSteps: number) => void
}

export interface RunAgentResult {
  /** The model's final text answer (empty if it never produced one). */
  answer: string
  /** How many model rounds ran. */
  steps: number
  /** True when the step cap or an abort ended it before a final answer. */
  stopped: boolean
}

// ---------------------------------------------------------------------------
// Resilient model calls.
//
// A run holds all its progress in `msgs`, so a single transient failure — a
// provider 5xx, a dropped socket, a request timeout — must NOT throw the whole
// run away and make the user re-send from zero. The model call (and only the
// model call — never a tool, which would double a write) retries with
// exponential backoff. A permanent failure (a 4xx like a bad key) fails fast
// instead: retrying it only delays the real message by three backoffs. Mirrors
// ai/agent.ts's callModelResilient on the chat side.
// ---------------------------------------------------------------------------

/** Retries a failed model call gets before the run gives up. */
export const CODE_AGENT_MAX_RETRIES = 3
/** First backoff step; each retry doubles it → 2s, 4s, 8s. */
export const CODE_AGENT_RETRY_BASE_MS = 2000

/**
 * Whether a failed model call is worth retrying. Transient conditions requalify
 * (429 rate limit, 408 request timeout, the provider's own 5xx); a permanent
 * 4xx does not. No status = the call never reached a response (DNS, refused,
 * dropped socket) — the classic transient case, so it retries.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  return status >= 500 && status < 600
}

/** The HTTP status a thrown model error carries, if any (the OpenAI SDK sets it). */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * One model round-trip with retry + exponential backoff. Throws only when the
 * failure is permanent, the run was stopped, or the retries are spent — the
 * caller turns that into a graceful pause, not a crash.
 */
async function callModelWithRetry(
  deps: RunAgentDeps,
  msgs: AgentMessage[],
  tools: ToolDef[]
): Promise<{ message: AgentMessage; usage?: TokenUsage }> {
  const sleep = deps.sleep ?? realSleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.callModel(msgs, tools)
    } catch (err) {
      const status = statusOf(err)
      if (attempt >= CODE_AGENT_MAX_RETRIES || !isRetryableStatus(status) || deps.shouldAbort?.()) {
        throw err
      }
      const waitMs = CODE_AGENT_RETRY_BASE_MS * 2 ** attempt
      const reason = err instanceof Error ? err.message : 'falha de conexão'
      deps.onRetry?.(attempt + 1, CODE_AGENT_MAX_RETRIES, waitMs, reason)
      await sleep(waitMs)
    }
  }
}

/**
 * The tool-calling loop: send the conversation + tools to the model; while it
 * answers with tool_calls, run each (asking approval for writes/commands) and
 * feed the results back; stop when it answers with plain text, or at maxSteps.
 */
// ---------------------------------------------------------------------------
// Research sub-agent — a lighter loop for web/docs research tasks.
// Runs with a smaller step budget and can't mutate the project.
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for a research sub-agent. The agent is told it can
 * only read/search — no writes, no shell commands — and asked to be concise.
 */
function buildResearchPrompt(tarefa: string): string {
  return `Você é um sub-agente de pesquisa. Sua função é investigar e responder à pergunta abaixo usando as ferramentas disponíveis. Você NÃO pode escrever arquivos nem executar comandos — apenas ler código, buscar no repositório e acessar a internet.

## Tarefa
${tarefa}

## Regras
- Use buscar_na_web para consultar documentação, exemplos de código ou APIs antes de responder.
- Responda APENAS com informação factual baseada no que você encontrou.
- Se não encontrar a resposta, diga claramente que não encontrou.
- Seja conciso e direto; evite divagações.
- Inclua fontes (URLs, caminhos de arquivos) quando aplicável.
- Use no máximo ${RESEARCH_AGENT_MAX_STEPS} passos. Se atingir o limite, resuma o que encontrou.`
}

/**
 * Handle a rodar_subagente tool call from the code agent loop.
 *
 * Checks the depth limit (max 1), then spawns a research sub-agent with the
 * same callModel so credentials/config are reused. Returns the sub-agent's
 * final text as the tool result.
 */
async function handleResearchSubAgent(
  args: Record<string, unknown>,
  ctx: ToolContext,
  callModel: (
    messages: AgentMessage[],
    tools: ToolDef[]
  ) => Promise<{ message: AgentMessage; usage?: TokenUsage }>,
  onUsage?: (usage: TokenUsage) => void
): Promise<ToolResult> {
  const depth = (ctx.subAgentDepth ?? 0) + 1
  if (depth > 1) {
    return {
      content: JSON.stringify({
        erro: 'Profundidade máxima de sub-agentes atingida (1). Sub-agentes não podem disparar novos sub-agentes.'
      }),
      summary: 'Sub-agente rejeitado: profundidade máxima'
    }
  }

  if ((ctx.researchAgentsStarted ?? 0) >= MAX_RESEARCH_SUBAGENTS_PER_RUN) {
    return {
      content: JSON.stringify({
        erro: `Limite de ${MAX_RESEARCH_SUBAGENTS_PER_RUN} sub-agentes por execução atingido.`
      }),
      summary: 'Sub-agente rejeitado: limite por execução'
    }
  }
  ctx.researchAgentsStarted = (ctx.researchAgentsStarted ?? 0) + 1

  const tarefa = typeof args.tarefa === 'string' ? args.tarefa.trim() : ''
  if (!tarefa) {
    return {
      content: JSON.stringify({ erro: 'O argumento "tarefa" é obrigatório.' }),
      summary: 'Erro: tarefa obrigatória'
    }
  }

  try {
    const resultado = await runResearchAgent(tarefa, ctx.root, callModel, onUsage)
    const content =
      resultado.length > RESEARCH_RESULT_CHAR_CAP
        ? resultado.slice(0, RESEARCH_RESULT_CHAR_CAP) + '\n…(resumo do sub-agente truncado)'
        : resultado
    return { content, summary: `Sub-agente concluído: ${tarefa.slice(0, 80)}` }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      content: JSON.stringify({ erro: `Sub-agente falhou: ${msg}` }),
      summary: 'Sub-agente falhou'
    }
  }
}

/**
 * Run a research sub-agent loop.
 *
 * The sub-agent gets a system prompt built from the task, a user message, and
 * up to RESEARCH_AGENT_MAX_STEPS iterations. It can only use the read-only
 * RESEARCH_AGENT_TOOLS. No writes, no shell commands, no approval round-trips.
 *
 * Exported so index.ts can wire a standalone IPC handler for the chat agent's
 * rodar_subagente tool (renderer → IPC → this function).
 */
export async function runResearchAgent(
  tarefa: string,
  root: string,
  callModel: (
    messages: AgentMessage[],
    tools: ToolDef[]
  ) => Promise<{ message: AgentMessage; usage?: TokenUsage }>,
  onUsage?: (usage: TokenUsage) => void
): Promise<string> {
  const systemPrompt = buildResearchPrompt(tarefa)
  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: tarefa }
  ]

  const tools = RESEARCH_AGENT_TOOLS
  const ctx: ToolContext = { root, subAgentDepth: 1 }

  // Read brakes for the sub-agent — same as the main agent's but scoped to this
  // sub-run. Without these a sub-agent can loop on the same URL or file until
  // its 15-step cap, burning tokens and real HTTP requests.
  const readRepeatsSub = new Map<string, number>()

  for (let step = 0; step < RESEARCH_AGENT_MAX_STEPS; step++) {
    const { message, usage } = await callModel(messages, tools)
    if (usage) onUsage?.(usage)
    messages.push(message)

    // No tool calls → agent is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || 'Sub-agente concluiu sem resposta.'
    }

    // Execute each tool call and feed results back
    for (const tc of message.tool_calls) {
      if (tc.type !== 'function') continue
      const name = tc.function.name
      let args: Record<string, unknown>
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch {
        args = {}
      }

      // Read-repeat brake: block the same web fetch / file read after N calls.
      const sig = `${name}:${JSON.stringify(args)}`
      const count = bumpCount(readRepeatsSub, sig)
      const brake =
        count >= READ_REPEAT_LIMIT
          ? JSON.stringify({
              error:
                name === 'buscar_no_codigo'
                  ? 'Esta busca já foi executada nesta execução com os mesmos argumentos. Use o resultado anterior; não repita a busca.'
                  : `Você já fez esta chamada ${READ_REPEAT_LIMIT}x com os mesmos argumentos e obteve o mesmo resultado. Não repita — responda com o que já tem.`
            })
          : null

      let result: ToolResult
      if (brake) {
        result = { content: brake, summary: `bloqueado (sub): ${name}` }
      } else {
        result = await runCodeTool(name, args, ctx)
      }
      messages.push({
        role: 'tool',
        content: result.content,
        tool_call_id: tc.id
      })
    }
  }

  // Max steps reached — ask the model to summarise
  messages.push({
    role: 'user',
    content:
      'Você atingiu o limite de passos. Resuma suas descobertas em um parágrafo conciso, destacando as informações mais relevantes para a tarefa.'
  })
  const { message, usage } = await callModel(messages, [])
  if (usage) onUsage?.(usage)
  return message.content || 'Sub-agente atingiu o limite de passos sem produzir resposta.'
}

/**
 * Ask the model to summarise conversation history into a compact block,
 * preserving decisions, file changes, current state, and next steps.
 * Called periodically so the per-step cost stays bounded instead of
 * growing with every message read/written.
 */
async function summarizeHistory(
  deps: RunAgentDeps,
  midMsgs: AgentMessage[],
  previousSummary: string
): Promise<string> {
  const prefix = previousSummary
    ? `Resumo anterior:\n${previousSummary}\n\n---\n\nNovos turnos:\n\n`
    : ''
  const midText = midMsgs
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : '(n/a)'
      const cap = m.role === 'tool' ? 300 : 500
      return `${m.role}: ${content.slice(0, cap)}`
    })
    .join('\n\n')
  const prompt: AgentMessage[] = [
    {
      role: 'system',
      content:
        'Resuma o historico de conversa abaixo (max 500 tokens). Inclua: decisoes tomadas, ' +
        'arquivos alterados, estado atual da tarefa, e o que falta fazer. Seja conciso.'
    },
    { role: 'user', content: `${prefix}${midText.slice(0, 40_000)}` }
  ]
  try {
    const { message, usage } = await deps.callModel(prompt, [])
    if (usage) deps.onUsage?.(usage)
    return (message.content ?? '').trim().slice(0, 3_000)
  } catch {
    return previousSummary
  }
}

export async function runCodeAgent(
  systemPrompt: string,
  task: string,
  ctx: ToolContext,
  deps: RunAgentDeps
): Promise<RunAgentResult> {
  // Wire the run's abort signal into the tool context so long-running shell
  // commands (executar_comando) can be killed mid-flight.
  ctx.shouldAbort = ctx.shouldAbort ?? (() => deps.shouldAbort?.() ?? false)

  const maxSteps =
    deps.maxSteps && deps.maxSteps > 0 ? Math.floor(deps.maxSteps) : CODE_AGENT_MAX_STEPS
  const tools = deps.tools ?? CODE_AGENT_TOOLS
  let msgs: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task }
  ]

  // Per-run read-brake state — each call to runCodeAgent starts fresh.
  const readRepeats = new Map<string, number>()
  const blindFileReads = new Map<string, number>()
  const totalFileReads = new Map<string, number>()
  const searchHistory: string[] = []
  // Exact searches must be blocked even when their filesystem result is cached:
  // the cache saves IO, but re-sending the same result still costs tokens.
  const seenSearches = new Set<string>()
  const commandRepeats = new Map<string, number>()
  const COMMAND_REPEAT_LIMIT = 3

  // Write tracking — what the agent has touched so far this run.
  let editedFiles = new Set<string>()
  const MAX_EDITED_FILES = 20
  // Whether any brake has fired this run — compaction is skipped when the agent
  // is already struggling, because dropping context only makes things worse.
  let brakesFired = false

  // Steps spent per file — forces the agent to move on after stalling on one file.
  const stepsOnCurrentFile = new Map<string, number>()
  const MAX_STEPS_PER_FILE = 10
  const FILE_BLOCK_LIMIT = 15

  /** Track a successful write — counts files, warns at limit. */
  const trackWrite = (args: Record<string, unknown>): string | null => {
    const caminho = typeof args.caminho === 'string' ? args.caminho.trim() : ''
    if (!caminho) return null
    editedFiles = new Set(editedFiles)
    editedFiles.add(caminho)
    if (editedFiles.size >= MAX_EDITED_FILES) {
      return `Você já editou ${editedFiles.size} arquivos — o limite é ${MAX_EDITED_FILES}. Conclua com o que tem.`
    }
    return null
  }

  // Steps-on-file tracker: bumps the counter for every read AND write tool that
  // targets a specific file path. After MAX_STEPS_PER_FILE cumulative steps on
  // one file without touching a different one, nudges the agent to move on.
  const bumpFileStep = (args: Record<string, unknown>): string | null => {
    const keys = [
      typeof args.caminho === 'string' ? args.caminho.trim() : '',
      typeof args.arquivo === 'string' ? args.arquivo.trim() : ''
    ].filter(Boolean)
    if (keys.length === 0) return null
    // Find the most recently active file (multi-arg tools pick one).
    const key = keys[0]
    const n = bumpCount(stepsOnCurrentFile, key)
    if (n >= MAX_STEPS_PER_FILE && editedFiles.size > 0) {
      // Reset so it doesn't fire again on the next step.
      stepsOnCurrentFile.delete(key)
      const others = [...editedFiles].filter((f) => f !== key)
      if (others.length > 0) {
        return `Você já gastou ${n} passos em "${key}". Passe para o próximo arquivo: ${others.join(', ')}.`
      }
    }
    return null
  }

  // Inertia brake: if the agent reads and searches for too long without writing
  // a single file, force it to start implementing. Compaction can erase the
  // early context that motivated the reads, creating a perpetual discovery loop.
  let writesSoFar = 0
  let readsSinceLastWrite = 0
  const INERTIA_LIMIT = 8

  // Typecheck gate (#7): the agent cannot conclude with a text answer until
  // typecheck has been run explicitly (via executar_comando) and passed at least
  // once after the last edit.
  let typecheckRan = false
  let typecheckPassed = false
  let envBroken = false
  let gateAttempts = 0

  // Progressive summarisation state — compresses the middle of the history
  // every SUMMARIZE_INTERVAL steps, keeping per-step cost bounded.
  let rollingSummary = ''
  let lastSummaryStep = 0

  // Watch for explicit typecheck invocations via executar_comando.
  // When the agent runs typecheck manually and it passes, clear the gate.
  const trackTypecheck = (summary: string, content: string): void => {
    if (!summary.includes('typecheck') && !summary.includes('tsc')) return
    typecheckRan = true
    // Exit code 127 or "not found" = node/npm missing from the environment.
    // This is unfixable from inside the sandbox — treat as passed for the gate.
    if (content.includes('"code":127') || content.includes('not found')) {
      typecheckPassed = true
      envBroken = true
      return
    }
    if (!content.includes('error TS') && !content.includes('❌') && !content.includes('falhou')) {
      typecheckPassed = true
      envBroken = false
    }
  }

  // Progress snapshot (#8): a compact list of what was edited, injected into
  // compaction so the model remembers even after history is summarised.
  const editLog: string[] = []

  for (let step = 0; step < maxSteps; step++) {
    if (deps.shouldAbort?.())
      return { answer: 'Execução interrompida.', steps: step, stopped: true }
    deps.onStep?.(step + 1, maxSteps)

    let message: AgentMessage
    let usage: TokenUsage | undefined
    try {
      ;({ message, usage } = await callModelWithRetry(deps, msgs, tools))
    } catch (err) {
      // Retries spent or a permanent failure: pause gracefully instead of
      // crashing the run with "code 1". The files written so far are on disk and
      // in the diff; the note says what happened and that nothing after it ran.
      const reason = err instanceof Error ? err.message : 'falha de conexão'
      const note =
        `Conexão com o modelo falhou (${reason}). O agente pausou após ${step} passo(s) — ` +
        `as mudanças já feitas estão no diff. Reenvie a tarefa para continuar.`
      deps.onText?.(note)
      return { answer: note, steps: step, stopped: true }
    }
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
      // Conclusion gate (#7): if the agent wrote files but never ran typecheck,
      // reject the conclusion and force a verification step. Fires at most twice.
      // Exception: when the environment is broken (node/npm not available), skip
      // the gate and let the conclusion through — it's unfixable from in here.
      if (writesSoFar > 0 && !typecheckPassed && gateAttempts < 2) {
        gateAttempts++
        const gate = envBroken
          ? 'O ambiente não tem node/npm disponível. Conclua sem typecheck e avise no resumo.'
          : typecheckRan
            ? 'O typecheck falhou. Leia o erro acima, conserte os problemas e rode typecheck de novo.'
            : 'Você editou arquivos mas não rodou typecheck. Rode `npm run typecheck` antes de concluir.'
        msgs.push({ role: 'user', content: gate })
        deps.onText?.(`⛔ ${gate}`)
        continue
      }
      return { answer: assistant.content, steps: step + 1, stopped: false }
    }

    // Parse all tool call args first.
    const parsed = calls.map((call) => {
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        return { call, args: args as Record<string, unknown>, parseError: null as string | null }
      } catch {
        return {
          call,
          args: {} as Record<string, unknown>,
          parseError: 'Argumentos inválidos (JSON)'
        }
      }
    })

    // Split into reads (run in parallel) and writes (run sequentially with approval).
    const results = new Array<{ id: string; content: string; summary: string }>(parsed.length)
    const readIdx = parsed
      .map((p, i) => (!p.parseError && !needsApproval(p.call.function.name) ? i : -1))
      .filter((i) => i >= 0)
    const writeIdx = parsed
      .map((p, i) => (!p.parseError && needsApproval(p.call.function.name) ? i : -1))
      .filter((i) => i >= 0)

    // Inertia brake: after many read-only steps the agent is stuck in a
    // discovery loop. Fire regardless of whether writes happened earlier — a
    // mid-work reading spree is still a reading spree. The tool responses
    // complete the turn (no orphaned tool_calls) and the nudge rides on each.
    const inertiaFired =
      readsSinceLastWrite >= INERTIA_LIMIT && readIdx.length > 0 && writeIdx.length === 0
    if (inertiaFired) {
      // Build a specific nudge: name the first file that hasn't been edited yet,
      // or the most recently read file, so the model knows exactly where to start.
      let target = 'nos arquivos da tarefa'
      if (editedFiles.size > 0) {
        target = `no próximo arquivo (já editou: ${[...editedFiles].join(', ')})`
      } else if (parsed.length > 0) {
        const firstRead = parsed[readIdx[0]]
        if (firstRead) {
          const f = typeof firstRead.args.caminho === 'string' ? firstRead.args.caminho.trim() : ''
          if (f) target = `em "${f}"`
        }
      }
      const nudge = JSON.stringify({
        error:
          `Você já fez ${readsSinceLastWrite} leituras/buscas sem usar escrever_arquivo uma vez. ` +
          `Pare de ler — você já tem informação suficiente. ` +
          `Use escrever_arquivo com procura+substitui AGORA ${target}.`
      })
      for (const i of readIdx) {
        const name = parsed[i].call.function.name
        results[i] = {
          id: parsed[i].call.id,
          content: nudge,
          summary: `bloqueado (inércia: ${name})`
        }
      }
      deps.onText?.(
        `🛑 ${readsSinceLastWrite} leituras sem write — respostas bloqueadas. O agente DEVE usar escrever_arquivo.`
      )
      brakesFired = true
    }

    // Track read count for the inertia brake — incremented per-read inside the
    // loop, only when the result was NOT a cache hit (a cached re-read is free).

    // Run all reads in parallel (skipped when inertia just fired — results already set).
    if (readIdx.length && !inertiaFired) {
      const readResults = await Promise.all(
        readIdx.map(async (i) => {
          const { call, args } = parsed[i]
          const name = call.function.name

          // Read brakes: peek at current counts (no side-effect) before running.
          // Counters are bumped only after execution, and only when the result
          // was NOT served from the readCache — a cached re-read costs nothing.
          const sig = `${name}:${JSON.stringify(args)}`
          const blindSig = blindFileReadSignature(name, args)
          const fileKey =
            name === 'ler_arquivo' && typeof args.caminho === 'string' ? args.caminho.trim() : ''

          // An exact search is redundant even when the result is cached: it would
          // still be appended to the model context and billed again.
          if (name === 'buscar_no_codigo' && seenSearches.has(sig)) {
            deps.onToolResult?.(name, 'bloqueado (busca repetida)')
            brakesFired = true
            return {
              i,
              id: call.id,
              content: JSON.stringify({
                error:
                  'Esta busca já foi executada nesta execução com os mesmos argumentos. Use o resultado anterior; não repita a busca.'
              }),
              summary: `bloqueado: `
            }
          }
          if (name === 'buscar_no_codigo') seenSearches.add(sig)

          // Exact-repeat brake
          if (
            (name === 'buscar_no_codigo' && (readRepeats.get(sig) ?? 0) >= 1) ||
            (readRepeats.get(sig) ?? 0) >= READ_REPEAT_LIMIT
          ) {
            deps.onToolResult?.(name, 'bloqueado (leitura repetida)')
            brakesFired = true
            return {
              i,
              id: call.id,
              content: JSON.stringify({
                error: `Você já fez esta chamada ${READ_REPEAT_LIMIT}x com os mesmos argumentos e obteve o mesmo resultado. Não repita — responda com o que já tem.`
              }),
              summary: `bloqueado: ${name}`
            }
          }
          // Blind whole-file brake
          if (blindSig && (blindFileReads.get(blindSig) ?? 0) >= BLIND_FILE_READ_LIMIT) {
            const caminho = typeof args.caminho === 'string' ? args.caminho : 'esse arquivo'
            deps.onToolResult?.(name, 'bloqueado (leitura repetida)')
            brakesFired = true
            return {
              i,
              id: call.id,
              content: JSON.stringify({
                error: `Você já leu "${caminho}" inteiro nesta execução. Se precisa de um trecho específico, use "simbolo", "linha_inicio"/"linha_fim" ou "inicio" — não releia o arquivo todo.`
              }),
              summary: `bloqueado: ${name}`
            }
          }
          // Total reads per file brake (catches paginated loops)
          if (fileKey && (totalFileReads.get(fileKey) ?? 0) > 8) {
            deps.onToolResult?.(name, 'bloqueado (leitura repetida)')
            brakesFired = true
            return {
              i,
              id: call.id,
              content: JSON.stringify({
                error: `Você já leu "${fileKey}" mais de 8x nesta execução. As informações que precisa já estão no histórico — pare de ler e comece a editar.`
              }),
              summary: `bloqueado: ${name}`
            }
          }

          deps.onToolCall?.(name, args)
          let toolResult = await runCodeTool(name, args, ctx)

          // Only bump brake counters when the result was NOT a cache hit.
          // A cached re-read is free — it didn't cost IO or pollute the context.
          if (!toolResult.cached) {
            bumpCount(readRepeats, sig)
            if (blindSig) bumpCount(blindFileReads, blindSig)
            if (fileKey) bumpCount(totalFileReads, fileKey)
            // Only count toward inertia if it was a real (non-cached) read.
            readsSinceLastWrite++
          }

          // Track steps per file (#10): warn if stalling on one file too long.
          const fileNudge = bumpFileStep(args)
          if (fileNudge) {
            toolResult = { ...toolResult, summary: `${toolResult.summary} (${fileNudge})` }
            deps.onText?.(`📂 ${fileNudge}`)
          }

          // Fuzzy-duplicate search still runs, but carries a nudge to reuse
          // the earlier results instead of re-searching a variation.
          if (name === 'buscar_no_codigo') {
            const aviso = fuzzySearchWarning(searchHistory, args)
            if (aviso) toolResult = { ...toolResult, content: withAviso(toolResult.content, aviso) }
          }

          deps.onToolResult?.(name, toolResult.summary)
          return { i, id: call.id, content: toolResult.content, summary: toolResult.summary }
        })
      )
      for (const r of readResults)
        results[r.i] = { id: r.id, content: r.content, summary: r.summary }
    }

    // Writes and commands run in the model order. A command often validates a
    // preceding edit, so parallel approval or execution can validate stale code.
    const runWrite = async (i: number) => {
      const { call, args } = parsed[i]
      const name = call.function.name
      let content: string
      let summary: string
      if (!(await deps.approve({ name, args }))) {
        content = JSON.stringify({ error: 'Ação recusada pelo usuário' })
        summary = `recusado: ${name}`
      } else {
        deps.onToolCall?.(name, args)

        // Command-repeat brake (#1): block the same shell command after N
        // identical calls — the error is elsewhere, not in the code.
        if (name === 'executar_comando') {
          const cmdSig = `executar_comando:${JSON.stringify(args)}`
          const cmdN = bumpCount(commandRepeats, cmdSig)
          if (cmdN >= COMMAND_REPEAT_LIMIT) {
            content = JSON.stringify({
              error: `Você já rodou este comando ${COMMAND_REPEAT_LIMIT}x. Se ele falhou, o erro não está no código — pode ser o ambiente (node/npm indisponível) ou um problema externo. Conclua com o que tem e avise no resumo.`
            })
            summary = `bloqueado (comando repetido ${cmdN}x)`
            brakesFired = true
            deps.onToolResult?.(name, summary)
            return { i, content, summary }
          }
        }

        // File-step hard block (#6): after FILE_BLOCK_LIMIT cumulative steps on
        // one file, block writes to it — the agent is stalling.
        if (name === 'escrever_arquivo') {
          const caminho = typeof args.caminho === 'string' ? args.caminho.trim() : ''
          if (caminho) {
            const fileSteps = stepsOnCurrentFile.get(caminho) ?? 0
            if (fileSteps >= FILE_BLOCK_LIMIT) {
              content = JSON.stringify({
                error: `Você já gastou ${fileSteps} passos em "${caminho}" — o limite é ${FILE_BLOCK_LIMIT}. Passe para outro arquivo ou conclua a tarefa.`
              })
              summary = `bloqueado: ${fileSteps} passos em ${caminho}`
              brakesFired = true
              deps.onToolResult?.(name, summary)
              return { i, content, summary }
            }
          }
        }

        let toolResult: ToolResult
        if (name === 'rodar_subagente') {
          toolResult = await handleResearchSubAgent(args, ctx, deps.callModel, deps.onUsage)
        } else {
          toolResult = await runCodeTool(name, args, ctx)
        }
        content = toolResult.content
        summary = toolResult.summary
        if (name === 'escrever_arquivo') {
          const ok = !content.includes('"error"') && !content.includes('texto não encontrado')
          if (ok) {
            writesSoFar++
            readsSinceLastWrite = 0
            typecheckPassed = false // revalidate after new edit
            const warn = trackWrite(args)
            if (warn) {
              summary = `${summary} (⚠️ ${warn})`
              deps.onText?.(`⚠️ ${warn}`)
            }
            // Progress snapshot (#8): record what changed for compaction.
            const diffMatch = summary.match(/patch em (.+): \+(\d+) -(\d+)/)
            if (diffMatch) editLog.push(`${diffMatch[1]}: +${diffMatch[2]}/-${diffMatch[3]}`)
            else editLog.push(summary)

            // Track steps per file (#10): warn if stalling.
            const fileNudge = bumpFileStep(args)
            if (fileNudge) {
              summary = `${summary} (${fileNudge})`
              deps.onText?.(`📂 ${fileNudge}`)
            }
          }
        }
        // Auto-typecheck after writes — but only when ALL writes in this batch
        // are done, not after each individual write (#6). Deferred to after the
        // write loop completes, so a half-edited file isn't flagged as broken.
        if (name === 'executar_comando') {
          // Shell commands are reads too — count them toward the inertia brake
          // so sed/grep loops don't escape detection.
          readsSinceLastWrite++
          // Track explicit typecheck invocations for the conclusion gate.
          trackTypecheck(summary, content)
        }
      }
      deps.onToolResult?.(name, summary)
      return { i, content, summary }
    }

    // One pending approval at a time keeps both the UI and side effects ordered.
    for (const i of writeIdx) {
      const { content, summary } = await runWrite(i)
      results[i] = { id: parsed[i].call.id, content, summary }
    }

    // After the first successful write batch, track that the agent has produced
    // code. The conclusion gate will enforce one final typecheck later.

    // Handle parse errors (no execution needed).
    for (let i = 0; i < parsed.length; i++) {
      if (results[i]) continue
      const { call, parseError } = parsed[i]
      if (parseError) {
        results[i] = {
          id: call.id,
          content: JSON.stringify({ error: parseError }),
          summary: `args inválidos: ${call.function.name}`
        }
      }
    }

    // Push results in original order.
    for (const r of results) {
      msgs.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    }

    // Compaction: when several steps remain and the history is large, summarise
    // old turns into a compact block. Uses deps.callModel directly (no tools).
    // Threshold is ~15k tokens (4 chars ≈ 1 token, conservative).
    // Skipped when any brake has fired — the agent is already struggling and
    // dropping context only compounds the problem.
    if (!brakesFired && step < maxSteps - 3 && step > 2 && msgs.length > 8) {
      const totalChars = msgs.reduce(
        (s, m) => s + (typeof m.content === 'string' ? m.content.length : 0),
        0
      )
      if (totalChars > 60_000) {
        // Walk backwards from the end to find a compact boundary that does NOT
        // split a tool call from its response. A tool message whose parent
        // assistant is not in the tail causes a 400 error from the provider.
        // We keep enough messages to cover at least a minimal complete turn.
        const MIN_KEEP = 4
        let tailStart = msgs.length - MIN_KEEP
        if (tailStart < 2) tailStart = 2

        // Ensure no tool message in the tail has its parent assistant in mid.
        for (let attempt = 0; attempt < 10; attempt++) {
          const tail = msgs.slice(tailStart)
          const tailToolCallIds = new Set<string>()
          for (const m of tail) {
            if (m.role === 'assistant' && m.tool_calls) {
              for (const tc of m.tool_calls) tailToolCallIds.add(tc.id)
            }
          }
          let orphaned = false
          for (const m of tail) {
            if (m.role === 'tool' && m.tool_call_id && !tailToolCallIds.has(m.tool_call_id)) {
              // Find the parent assistant in mid and expand tailStart to include it.
              for (let j = tailStart - 1; j >= 1; j--) {
                const candidate = msgs[j]
                if (
                  candidate.role === 'assistant' &&
                  candidate.tool_calls?.some((tc) => tc.id === m.tool_call_id)
                ) {
                  tailStart = j
                  orphaned = true
                  break
                }
              }
              if (orphaned) break
            }
          }
          if (!orphaned) break
        }

        const head = msgs.slice(0, 1)
        const tail = msgs.slice(tailStart)
        const mid = msgs.slice(1, tailStart)
        const midText = mid
          .map(
            (m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : '(n/a)'}`
          )
          .join('\n\n')
        const compactPrompt: AgentMessage[] = [
          {
            role: 'system',
            content:
              'Resuma a conversa abaixo em português, preservando decisões, arquivos alterados e o que falta fazer. Máx 3000 caracteres. Seja conciso.'
          },
          { role: 'user', content: midText.slice(0, 50000) }
        ]
        try {
          const { message, usage } = await deps.callModel(compactPrompt, [])
          if (usage) deps.onUsage?.(usage)
          const summary = (message.content ?? '').trim()
          if (summary && summary.length < 5000) {
            const extras: string[] = []
            if (editedFiles.size > 0) {
              extras.push(`Arquivos já modificados: ${[...editedFiles].join(', ')}`)
            }
            if (editLog.length > 0) {
              extras.push(`Log de edições: ${editLog.slice(-10).join('; ')}`)
            }
            const prefix = extras.length > 0 ? `${extras.join('\n')}\n\n` : ''
            msgs = [
              head[0],
              { role: 'user', content: `${prefix}[Resumo de turnos anteriores]\n${summary}` },
              ...tail
            ]
            deps.onText?.('📦 Histórico compactado para economizar tokens.')
          }
        } catch {
          // compaction failure is non-critical
        }
      }
    }

    // Progressive summarisation: every SUMMARIZE_INTERVAL steps compress
    // the middle of the history into a rolling summary. This keeps the
    // per-step token cost bounded — same pattern as the chat agent.
    //
    // Only when the agent isn't already struggling (brakesFired) and when
    // enough history has been built.
    if (
      !brakesFired &&
      step > 4 &&
      step < maxSteps - 3 &&
      step - lastSummaryStep >= SUMMARIZE_INTERVAL
    ) {
      try {
        // Safe cut: no tool orphan in the tail.
        let cut = Math.max(2, msgs.length - KEEP_RECENT)
        const tailTcIds = new Set<string>()
        for (let i = cut; i < msgs.length; i++) {
          if (msgs[i].role === 'tool' && msgs[i].tool_call_id) {
            tailTcIds.add(msgs[i].tool_call_id!)
          }
        }
        for (let i = cut - 1; i >= 2 && tailTcIds.size > 0; i--) {
          for (const tc of msgs[i].tool_calls ?? []) {
            tailTcIds.delete(tc.id)
          }
          if (tailTcIds.size === 0) {
            cut = i
            break
          }
        }
        const mid = msgs.slice(2, cut)
        const tail = msgs.slice(cut)
        if (mid.length > 0) {
          const summary = await summarizeHistory(deps, mid, rollingSummary)
          rollingSummary = summary
          const extras: string[] = []
          if (editedFiles.size > 0) {
            extras.push(`Arquivos ja modificados: ${[...editedFiles].join(', ')}`)
          }
          if (editLog.length > 0) {
            extras.push(`Log: ${editLog.slice(-5).join('; ')}`)
          }
          const prefix = extras.length > 0 ? `${extras.join('\n')}\n\n` : ''
          msgs = [
            msgs[0],
            msgs[1],
            { role: 'user', content: `${prefix}[RESUMO DO HISTORICO ANTERIOR]\n${summary}` },
            ...tail
          ]
          lastSummaryStep = step
          deps.onText?.('📦 Histórico sumarizado (economia de tokens).')
        }
      } catch {
        // summarisation failure is non-critical
      }
    }
  }

  // Step cap hit: force one last text answer with tools disabled, so a run that
  // ran out of budget still summarises what it managed instead of ending mute.
  try {
    const { message, usage } = await callModelWithRetry(deps, msgs, [])
    if (usage) deps.onUsage?.(usage)
    if (message.content?.trim()) deps.onText?.(message.content)
    return { answer: message.content ?? '', steps: maxSteps, stopped: true }
  } catch {
    return { answer: '', steps: maxSteps, stopped: true }
  }
}
