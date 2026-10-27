import { createServer, type Server, type Socket } from 'net'
import { buildMemory, findConflicts, type AiMemory, type MemoryType } from '../ai/memory'
import { randomUUID } from 'crypto'
import type { MemorySearchHit } from '../../store'
import { MCP_WRITE_TOOLS } from './mcp-write-tools'
import {
  MCP_MEMORY_WRITE_TOOLS,
  MCP_RENDERER_WRITE_TOOLS,
  type McpActionResult
} from './mcp-write-types'

export const MCP_PERMISSIONS = [
  'read_tasks',
  'read_project',
  'read_notes',
  'read_goals',
  'read_financial_data',
  'list_projects',
  'search_memory',
  'read_memory',
  'save_memory',
  'check_memories',
  'ler_tasks',
  'criar_task',
  'ler_financeiro',
  'ler_projeto',
  'read_logs',
  ...MCP_RENDERER_WRITE_TOOLS,
  ...MCP_MEMORY_WRITE_TOOLS
] as const

const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...MCP_RENDERER_WRITE_TOOLS,
  ...MCP_MEMORY_WRITE_TOOLS
])

export type McpPermission = (typeof MCP_PERMISSIONS)[number]

export interface McpSession {
  token: string
  runId: string
  projectId: string | null
  financialProfileId: string
  permissions: readonly McpPermission[]
  expiresAt: number
}

export interface McpBrokerDeps {
  readScopedData?: (
    domain: 'tasks' | 'project' | 'notes' | 'goals' | 'financial',
    session: McpSession,
    projectId: string | null | undefined
  ) => unknown[]
  listProjects?: () => unknown[]
  readTasks: (projectId: string | null | undefined) => unknown[]
  readFinancial: (profileId: string) => unknown
  readProjectData: (projectId: string | null | undefined) => unknown
  searchMemory: (projectId: string | null | undefined, term: string) => MemorySearchHit[]
  readMemory: (id: string) => AiMemory | null
  touchMemory: (id: string) => void
  memoriesForConflict: (projectId: string | null | undefined) => AiMemory[]
  saveMemory: (
    session: McpSession,
    memory: AiMemory,
    redacted: boolean
  ) => Promise<{ ok: boolean; id?: string; redacted?: boolean; error?: string }>
  createTask: (session: McpSession, args: Record<string, unknown>) => Promise<unknown>
  /** Diagnostic log reader; absent means read_logs returns no entries. */
  readLogs?: (query: { level?: string; area?: string; since?: string; limit: number }) => unknown
  /** Observes each tools/call: name, outcome and duration only, never arguments or results. */
  onToolCall?: (call: {
    runId: string
    tool: string
    outcome: 'ok' | 'refused' | 'error'
    ms: number
  }) => void
  /** Every tool of MCP_WRITE_TOOLS; absent means writes are unavailable. */
  write?: (
    session: McpSession,
    name: string,
    args: Record<string, unknown>
  ) => Promise<McpActionResult>
}

/** Source for a disposable stdio adapter written only into an agent worktree. */
export const MCP_STDIO_BRIDGE_SOURCE = `const net=require('net');
const port=Number(process.env.SAGYOU_MCP_PORT),token=process.env.SAGYOU_MCP_TOKEN;
if(!port||!token) process.exit(2);
const socket=net.createConnection({host:'127.0.0.1',port});
let buffer='',input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;const lines=input.split('\\n');input=lines.pop()||'';for(const line of lines){if(!line)continue;try{const msg=JSON.parse(line);msg.params={...(msg.params||{}),token};socket.write(JSON.stringify(msg)+'\\n')}catch{}}});
socket.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\\n');buffer=lines.pop()||'';for(const line of lines)if(line)process.stdout.write(line+'\\n')});
socket.on('error',()=>process.exit(1));`

const LOG_READ_LIMIT = 200
const TOOL_UNAVAILABLE = 'Ferramenta indisponível nesta sessão MCP.'

const TOOLS: { name: McpPermission; description: string; inputSchema: Record<string, unknown> }[] =
  [
    ...(
      [
        ['read_tasks', 'tasks'],
        ['read_project', 'project'],
        ['read_notes', 'notes'],
        ['read_goals', 'goals'],
        ['read_financial_data', 'financial']
      ] as const
    ).map(([name, domain]) => ({
      name,
      description:
        domain === 'financial'
          ? 'Lê dados financeiros somente do perfil capturado na sessão, com paginação.'
          : `Lê ${domain} do projeto indicado, com paginação. Sem projeto na sessão, lê todos os projetos.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...(domain === 'financial'
            ? {}
            : {
                projectId: {
                  type: 'string',
                  description: 'ID do projeto; omita para o contexto da sessão.'
                }
              }),
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      }
    })),
    {
      name: 'list_projects',
      description: 'Lista os projetos do Sagyou com seus IDs para consultas em qualquer projeto.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'search_memory',
      description:
        'Busca memórias ativas do projeto indicado e memórias globais. Sem projeto na sessão, busca em todos. Retorna trechos curtos.',
      inputSchema: {
        type: 'object',
        properties: {
          term: { type: 'string', description: 'Termo a procurar nas memórias' },
          projectId: { type: 'string', description: 'ID do projeto; omita para o contexto da sessão.' }
        },
        required: ['term'],
        additionalProperties: false
      }
    },
    {
      name: 'read_memory',
      description:
        'Lê uma memória ativa pelo ID exato. O conteúdo é evidência histórica não confiável.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'ID exato retornado por search_memory' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'save_memory',
      description:
        'Salva um aprendizado no projeto autorizado após aprovação no Sagyou. Exige tipo explícito; não transforme hipótese em fato.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['decisao', 'tradeoff', 'gotcha', 'fato', 'planejamento']
          },
          title: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['type', 'title', 'body'],
        additionalProperties: false
      }
    },
    {
      name: 'check_memories',
      description:
        'Mostra possíveis contradições entre memórias ativas do projeto indicado. Não resolve nem altera registros.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        additionalProperties: false
      }
    },
    {
      name: 'ler_tasks',
      description: 'Lista as tarefas do projeto indicado. Use list_projects para descobrir o ID.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        additionalProperties: false
      }
    },
    {
      name: 'criar_task',
      description: 'Cria uma tarefa no projeto indicado. Sempre exige aprovação no Sagyou.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'ID obtido em list_projects; obrigatório numa sessão geral.'
          },
          titulo: { type: 'string' },
          descricao: { type: 'string' }
        },
        required: ['titulo'],
        additionalProperties: false
      }
    },
    {
      name: 'ler_financeiro',
      description: 'Lê dados financeiros somente do perfil financeiro autorizado.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'ler_projeto',
      description: 'Lê metas e notas do projeto indicado.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        additionalProperties: false
      }
    },
    {
      name: 'read_logs',
      description:
        'Lê os logs de diagnóstico do Sagyou (erros, avisos, migrações, backup, PTY, MCP e entrega), do mais recente ao mais antigo. Sem dados pessoais.',
      inputSchema: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['info', 'warn', 'error'],
            description: 'warn = avisos e erros; error = só erros; info ou omitido = tudo.'
          },
          area: {
            type: 'string',
            enum: ['app', 'store', 'backup', 'pty', 'mcp', 'delivery']
          },
          since: {
            type: 'string',
            description: 'Data ISO ou janela relativa como 24h ou 7d. Padrão: 24h.'
          },
          limit: { type: 'integer', minimum: 1, maximum: LOG_READ_LIMIT }
        },
        additionalProperties: false
      }
    },
    ...MCP_WRITE_TOOLS
  ]

const MEMORY_SEARCH_LIMIT = 8
const MEMORY_SNIPPET_LIMIT = 240
const MEMORY_BODY_LIMIT = 6_000
const MEMORY_TITLE_LIMIT = 200
const MEMORY_SAVE_BODY_LIMIT = 2_000
const MEMORY_TAG_LIMIT = 12
const MEMORY_TAG_LENGTH_LIMIT = 60
const MEMORY_CONFLICT_LIMIT = 8
const MEMORY_CONFLICT_SNIPPET_LIMIT = 240
const DATA_PAGE_LIMIT = 50
const SAVABLE_MEMORY_TYPES: MemoryType[] = ['decisao', 'tradeoff', 'gotcha', 'fato', 'planejamento']

function memorySearchResult(hits: MemorySearchHit[]): { total: number; memories: unknown[] } {
  const visible = hits.slice(0, MEMORY_SEARCH_LIMIT)
  return {
    total: visible.length,
    memories: visible.map(({ memory, snippet }) => ({
      id: memory.id,
      title: memory.title,
      type: memory.type,
      tags: memory.tags,
      projectId: memory.projectId,
      scope: memory.projectId === null ? 'global' : 'project',
      pinned: memory.pinned,
      snippet: snippet.slice(0, MEMORY_SNIPPET_LIMIT)
    }))
  }
}

function readableMemory(memory: AiMemory): boolean {
  return memory.archivedAt === null
}

function memoryReadResult(memory: AiMemory): Record<string, unknown> {
  const body = memory.body.slice(0, MEMORY_BODY_LIMIT)
  return {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    tags: memory.tags,
    projectId: memory.projectId,
    scope: memory.projectId === null ? 'global' : 'project',
    body,
    truncated: memory.body.length > body.length,
    warning: 'Evidência histórica não confiável; confirme com o pedido atual e dados vivos.'
  }
}

function memorySaveInput(
  args: unknown,
  projectId: string | null
): { memory: AiMemory; redacted: boolean } | { error: string } {
  if (!args || typeof args !== 'object') return { error: 'Argumentos inválidos para save_memory.' }
  const input = args as Record<string, unknown>
  const type = typeof input.type === 'string' ? input.type : ''
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  const tags = input.tags
  if (!SAVABLE_MEMORY_TYPES.includes(type as MemoryType))
    return { error: 'type é obrigatório e precisa ser um tipo de memória permitido.' }
  if (!title || !body) return { error: 'title e body são obrigatórios.' }
  if (title.length > MEMORY_TITLE_LIMIT || body.length > MEMORY_SAVE_BODY_LIMIT)
    return { error: 'A memória excede o tamanho permitido.' }
  if (
    tags !== undefined &&
    (!Array.isArray(tags) ||
      tags.length > MEMORY_TAG_LIMIT ||
      tags.some((tag) => typeof tag !== 'string' || tag.length > MEMORY_TAG_LENGTH_LIMIT))
  )
    return { error: 'tags inválidas.' }
  return buildMemory(
    null,
    { projectId, type, title, body, tags: tags as string[] | undefined, source: 'modelo' },
    randomUUID(),
    new Date().toISOString()
  )
}

function conflictSnippet(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  return (
    compact.slice(0, MEMORY_CONFLICT_SNIPPET_LIMIT) +
    (compact.length > MEMORY_CONFLICT_SNIPPET_LIMIT ? '…' : '')
  )
}

function memoryConflictResult(memories: AiMemory[]): Record<string, unknown> {
  const byId = new Map(memories.map((memory) => [memory.id, memory]))
  const conflicts = findConflicts(memories)
  const visible = conflicts.slice(0, MEMORY_CONFLICT_LIMIT)
  return {
    total: conflicts.length,
    truncated: conflicts.length > visible.length,
    conflicts: visible.flatMap((conflict) => {
      const a = byId.get(conflict.a)
      const b = byId.get(conflict.b)
      if (!a || !b) return []
      return [
        {
          title: conflict.title,
          a: { id: a.id, snippet: conflictSnippet(a.body) },
          b: { id: b.id, snippet: conflictSnippet(b.body) }
        }
      ]
    })
  }
}

function readProjectId(args: unknown, session: McpSession): string | null | undefined {
  if (args && typeof args === 'object') {
    const requested = (args as Record<string, unknown>).projectId
    if (typeof requested === 'string' && requested.trim()) return requested.trim()
  }
  return session.projectId ?? undefined
}

function pageData(rows: unknown[], args: unknown): Record<string, unknown> {
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const offset =
    typeof input.offset === 'number' && Number.isInteger(input.offset) && input.offset >= 0
      ? input.offset
      : 0
  const requested =
    typeof input.limit === 'number' && Number.isInteger(input.limit) ? input.limit : DATA_PAGE_LIMIT
  const limit = Math.max(1, Math.min(requested, DATA_PAGE_LIMIT))
  const items = rows.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  return {
    total: rows.length,
    offset,
    items,
    truncated: nextOffset < rows.length,
    ...(nextOffset < rows.length ? { nextOffset } : {})
  }
}

function logQuery(args: unknown): {
  level?: string
  area?: string
  since?: string
  limit: number
} {
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : undefined
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.floor(input.limit)), LOG_READ_LIMIT)
      : 100
  return {
    ...(text(input.level) ? { level: text(input.level) } : {}),
    ...(text(input.area) ? { area: text(input.area) } : {}),
    ...(text(input.since) ? { since: text(input.since) } : {}),
    limit
  }
}

/** Outcome of one JSON-RPC reply line: protocol error, domain refusal ({ ok: false }) or ok. */
function replyOutcome(line: string): 'ok' | 'refused' | 'error' {
  try {
    const message = JSON.parse(line) as {
      error?: unknown
      result?: { content?: { text?: string }[] }
    }
    if (message.error)
      return (message.error as { message?: unknown }).message === TOOL_UNAVAILABLE
        ? 'refused'
        : 'error'
    const text = message.result?.content?.[0]?.text
    const payload = text ? (JSON.parse(text) as { ok?: unknown }) : null
    return payload && typeof payload === 'object' && payload.ok === false ? 'refused' : 'ok'
  } catch {
    return 'ok'
  }
}

function reply(socket: Socket, id: unknown, result: unknown): void {
  socket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function failure(socket: Socket, id: unknown, message: string): void {
  socket.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n')
}

/**
 * Local-only MCP broker. A CLI never receives database access: it gets a
 * random, expiring capability whose project and financial-profile scope is
 * resolved here before every tool response.
 */
export function startSagyouMcpBroker(deps: McpBrokerDeps): {
  server: Server
  port: () => number
  grant: (session: McpSession) => void
  revoke: (token: string) => void
} {
  const sessions = new Map<string, McpSession>()
  const server = createServer((socket) => {
    // A disposable stdio bridge may exit immediately after receiving its reply.
    // Treat that peer reset as session teardown, not as an uncaught main-process error.
    socket.on('error', () => {})
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const request = JSON.parse(line) as {
            id?: unknown
            method?: string
            params?: Record<string, unknown>
          }
          const token = typeof request.params?.token === 'string' ? request.params.token : ''
          const session = sessions.get(token)
          if (!session || session.expiresAt <= Date.now()) {
            sessions.delete(token)
            failure(socket, request.id, 'Sessão MCP inválida ou expirada.')
            continue
          }
          if (request.method === 'initialize') {
            reply(socket, request.id, {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'Sagyou', version: '1' }
            })
          } else if (request.method === 'tools/list') {
            reply(socket, request.id, {
              tools: TOOLS.filter((tool) => session.permissions.includes(tool.name))
            })
          } else if (request.method === 'tools/call') {
            const name = request.params?.name
            // Same socket, but each reply also reports the call (no arguments or results).
            const startedAt = Date.now()
            const call = {
              write: (line: string) => {
                socket.write(line)
                deps.onToolCall?.({
                  runId: session.runId,
                  // Never echo an arbitrary name the agent invented into the log.
                  tool: MCP_PERMISSIONS.includes(name as McpPermission) ? String(name) : 'unknown',
                  outcome: replyOutcome(line),
                  ms: Date.now() - startedAt
                })
                return true
              }
            } as unknown as Socket
            if (
              typeof name !== 'string' ||
              !MCP_PERMISSIONS.includes(name as McpPermission) ||
              !session.permissions.includes(name as McpPermission)
            ) {
              failure(call, request.id, TOOL_UNAVAILABLE)
              continue
            }
            if (WRITE_TOOL_NAMES.has(name)) {
              const args = request.params?.arguments
              if (!deps.write) {
                failure(call, request.id, TOOL_UNAVAILABLE)
                continue
              }
              // A domain refusal is an ordinary reply, so the agent can read it and adapt.
              void deps
                .write(
                  session,
                  name,
                  args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
                )
                .catch(
                  (error: unknown): McpActionResult => ({
                    ok: false,
                    error: error instanceof Error ? error.message : 'A escrita MCP falhou.'
                  })
                )
                .then((result) =>
                  reply(call, request.id, {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                  })
                )
              continue
            }
            const dataDomain = {
              read_tasks: 'tasks',
              read_project: 'project',
              read_notes: 'notes',
              read_goals: 'goals',
              read_financial_data: 'financial'
            } as const
            if (typeof name === 'string' && name in dataDomain) {
              const domain = dataDomain[name as keyof typeof dataDomain]
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      pageData(
                        deps.readScopedData?.(
                          domain,
                          session,
                          readProjectId(request.params?.arguments, session)
                        ) ?? [],
                        request.params?.arguments
                      )
                    )
                  }
                ]
              })
            } else if (name === 'read_logs') {
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      deps.readLogs?.(logQuery(request.params?.arguments)) ?? {
                        entries: [],
                        truncated: false
                      }
                    )
                  }
                ]
              })
            } else if (name === 'list_projects') {
              reply(call, request.id, {
                content: [{ type: 'text', text: JSON.stringify(deps.listProjects?.() ?? []) }]
              })
            } else if (name === 'search_memory') {
              const args = request.params?.arguments
              const searchArgs =
                args && typeof args === 'object' ? (args as Record<string, unknown>) : null
              const term =
                searchArgs && typeof searchArgs.term === 'string' ? searchArgs.term.trim() : ''
              if (!term) failure(call, request.id, 'term Ã© obrigatÃ³rio.')
              else
                reply(call, request.id, {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        memorySearchResult(
                          deps.searchMemory(readProjectId(request.params?.arguments, session), term)
                        )
                      )
                    }
                  ]
                })
            } else if (name === 'read_memory') {
              const args = request.params?.arguments
              const readArgs =
                args && typeof args === 'object' ? (args as Record<string, unknown>) : null
              const id = readArgs && typeof readArgs.id === 'string' ? readArgs.id.trim() : ''
              const memory = id ? deps.readMemory(id) : null
              // Return one indistinguishable refusal for a missing, archived or
              // out-of-scope ID so a forged probe cannot learn its metadata.
              if (!memory || !readableMemory(memory))
                failure(call, request.id, 'Memória indisponível nesta sessão MCP.')
              else {
                deps.touchMemory(memory.id)
                reply(call, request.id, {
                  content: [{ type: 'text', text: JSON.stringify(memoryReadResult(memory)) }]
                })
              }
            } else if (name === 'save_memory') {
              const prepared = memorySaveInput(request.params?.arguments, session.projectId)
              if ('error' in prepared) failure(call, request.id, prepared.error)
              else
                void deps
                  .saveMemory(session, prepared.memory, prepared.redacted)
                  .then((result) =>
                    reply(call, request.id, {
                      content: [{ type: 'text', text: JSON.stringify(result) }]
                    })
                  )
                  .catch((error: unknown) =>
                    failure(
                      call,
                      request.id,
                      error instanceof Error ? error.message : 'Não foi possível salvar a memória.'
                    )
                  )
            } else if (name === 'check_memories') {
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      memoryConflictResult(
                        deps.memoriesForConflict(readProjectId(request.params?.arguments, session))
                      )
                    )
                  }
                ]
              })
            } else if (name === 'ler_tasks')
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      deps.readTasks(readProjectId(request.params?.arguments, session))
                    )
                  }
                ]
              })
            else if (name === 'ler_financeiro')
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(deps.readFinancial(session.financialProfileId))
                  }
                ]
              })
            else if (name === 'ler_projeto')
              reply(call, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      deps.readProjectData(readProjectId(request.params?.arguments, session))
                    )
                  }
                ]
              })
            else if (name === 'criar_task') {
              const args = request.params?.arguments
              void deps
                .createTask(
                  session,
                  args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
                )
                .then((result) =>
                  reply(call, request.id, {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                  })
                )
                .catch((error: unknown) =>
                  failure(
                    call,
                    request.id,
                    error instanceof Error ? error.message : 'Não foi possível criar a task.'
                  )
                )
            } else failure(call, request.id, TOOL_UNAVAILABLE)
          } else if (request.method === 'notifications/initialized') {
            // MCP notification: deliberately no response.
          } else failure(socket, request.id, 'Método MCP não suportado.')
        } catch {
          failure(socket, null, 'Mensagem MCP inválida.')
        }
      }
    })
  })
  server.listen(0, '127.0.0.1')
  return {
    server,
    port: () => (server.address() as { port: number } | null)?.port ?? 0,
    grant: (session) => {
      // Capture primitives and a frozen permission list. Later UI selection
      // changes, or a caller retaining this object, cannot widen a live run.
      sessions.set(session.token, {
        ...session,
        permissions: Object.freeze([...session.permissions])
      })
    },
    revoke: (token) => sessions.delete(token)
  }
}
