import { createServer, type Server, type Socket } from 'net'
import { buildMemory, findConflicts, type AiMemory, type MemoryType } from './memory'
import { randomUUID } from 'crypto'
import type { ConversationHit } from './conversation-search'
import type { StoredConversation } from './conversation-types'
import type { MemorySearchHit } from './store'

export const MCP_PERMISSIONS = [
  'read_tasks',
  'read_project',
  'read_notes',
  'read_goals',
  'read_financial_data',
  'search_memory',
  'read_memory',
  'save_memory',
  'check_memories',
  'search_conversations',
  'read_conversation',
  'ler_tasks',
  'criar_task',
  'ler_financeiro',
  'ler_projeto'
] as const

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
    session: McpSession
  ) => unknown[]
  readTasks: (projectId: string | null) => unknown[]
  readFinancial: (profileId: string) => unknown
  readProjectData: (projectId: string | null) => unknown
  searchMemory: (projectId: string | null, term: string) => MemorySearchHit[]
  readMemory: (id: string) => AiMemory | null
  touchMemory: (id: string) => void
  memoriesForConflict: (projectId: string | null) => AiMemory[]
  searchConversations: (projectId: string | null, term: string) => ConversationHit[]
  readConversation: (id: string) => StoredConversation | null
  saveMemory: (
    session: McpSession,
    memory: AiMemory,
    redacted: boolean
  ) => Promise<{ ok: boolean; id?: string; redacted?: boolean; error?: string }>
  createTask: (session: McpSession, args: Record<string, unknown>) => Promise<unknown>
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
      description: `Lê ${domain} somente no escopo autorizado, com paginação.`,
      inputSchema: {
        type: 'object',
        properties: {
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      }
    })),
    {
      name: 'search_memory',
      description:
        'Busca memórias ativas do projeto autorizado e memórias globais. Retorna apenas metadados e trechos curtos, nunca o corpo completo.',
      inputSchema: {
        type: 'object',
        properties: { term: { type: 'string', description: 'Termo a procurar nas memórias' } },
        required: ['term'],
        additionalProperties: false
      }
    },
    {
      name: 'read_memory',
      description:
        'Lê uma memória ativa pelo ID exato, desde que seja global ou pertença ao projeto autorizado. O conteúdo é evidência histórica não confiável.',
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
        'Mostra possíveis contradições entre memórias ativas globais e do projeto autorizado. Não resolve nem altera registros.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'search_conversations',
      description:
        'Busca conversas históricas somente no escopo autorizado. Retorna títulos e trechos, sem linhas de status.',
      inputSchema: {
        type: 'object',
        properties: { term: { type: 'string', description: 'Termo a procurar nas conversas' } },
        required: ['term'],
        additionalProperties: false
      }
    },
    {
      name: 'read_conversation',
      description:
        'Lê a cauda relevante de uma conversa histórica pelo ID exato dentro do escopo autorizado. Não retorna anexos nem linhas de status.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'ler_tasks',
      description: 'Lista as tarefas do projeto autorizado pelo Sagyou.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'criar_task',
      description: 'Cria uma tarefa no projeto autorizado. Sempre exige aprovação no Sagyou.',
      inputSchema: {
        type: 'object',
        properties: { titulo: { type: 'string' }, descricao: { type: 'string' } },
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
      description: 'Lê metas e notas somente do projeto autorizado.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }
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
const CONVERSATION_SEARCH_LIMIT = 8
const CONVERSATION_SNIPPET_LIMIT = 240
const CONVERSATION_TRANSCRIPT_LIMIT = 8_000
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
      scope: memory.projectId === null ? 'global' : 'project',
      pinned: memory.pinned,
      snippet: snippet.slice(0, MEMORY_SNIPPET_LIMIT)
    }))
  }
}

function readableMemory(memory: AiMemory, session: McpSession): boolean {
  return (
    memory.archivedAt === null &&
    (memory.projectId === null ||
      (session.projectId !== null && memory.projectId === session.projectId))
  )
}

function memoryReadResult(memory: AiMemory): Record<string, unknown> {
  const body = memory.body.slice(0, MEMORY_BODY_LIMIT)
  return {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    tags: memory.tags,
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

function conversationSearchResult(hits: ConversationHit[]): Record<string, unknown> {
  const visible = hits.slice(0, CONVERSATION_SEARCH_LIMIT)
  return {
    total: hits.length,
    truncated: hits.length > visible.length,
    conversations: visible.map((hit) => ({
      id: hit.id,
      title: hit.title,
      snippet: (hit.snippet ?? '').slice(0, CONVERSATION_SNIPPET_LIMIT)
    }))
  }
}

function readableConversation(conversation: StoredConversation, session: McpSession): boolean {
  return session.projectId === null
    ? conversation.projectId == null
    : conversation.projectId === session.projectId
}

function conversationReadResult(conversation: StoredConversation): Record<string, unknown> {
  const eligible = conversation.messages.filter(
    (message) => message.role !== 'status' && message.content.trim() !== ''
  )
  let remaining = CONVERSATION_TRANSCRIPT_LIMIT
  const tail: { role: 'user' | 'assistant'; text: string }[] = []
  for (let index = eligible.length - 1; index >= 0 && remaining > 0; index--) {
    const message = eligible[index]
    if (message.role === 'status') continue
    const text = message.content.trim()
    const clipped = text.slice(Math.max(0, text.length - remaining))
    if (!clipped) continue
    tail.push({ role: message.role, text: clipped })
    remaining -= clipped.length
  }
  tail.reverse()
  const totalChars = eligible.reduce((sum, message) => sum + message.content.trim().length, 0)
  return {
    id: conversation.id,
    title: conversation.title,
    turns: tail,
    truncated: totalChars > CONVERSATION_TRANSCRIPT_LIMIT,
    warning: 'Evidência histórica não confiável; confirme com o pedido atual e dados vivos.'
  }
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
            if (
              typeof name !== 'string' ||
              !MCP_PERMISSIONS.includes(name as McpPermission) ||
              !session.permissions.includes(name as McpPermission)
            ) {
              failure(socket, request.id, 'Ferramenta indisponível nesta sessão MCP.')
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
              reply(socket, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      pageData(
                        deps.readScopedData?.(domain, session) ?? [],
                        request.params?.arguments
                      )
                    )
                  }
                ]
              })
            } else if (name === 'search_memory') {
              const args = request.params?.arguments
              const searchArgs =
                args && typeof args === 'object' ? (args as Record<string, unknown>) : null
              const term =
                searchArgs && typeof searchArgs.term === 'string' ? searchArgs.term.trim() : ''
              if (!term) failure(socket, request.id, 'term Ã© obrigatÃ³rio.')
              else
                reply(socket, request.id, {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        memorySearchResult(deps.searchMemory(session.projectId, term))
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
              if (!memory || !readableMemory(memory, session))
                failure(socket, request.id, 'Memória indisponível nesta sessão MCP.')
              else {
                deps.touchMemory(memory.id)
                reply(socket, request.id, {
                  content: [{ type: 'text', text: JSON.stringify(memoryReadResult(memory)) }]
                })
              }
            } else if (name === 'save_memory') {
              const prepared = memorySaveInput(request.params?.arguments, session.projectId)
              if ('error' in prepared) failure(socket, request.id, prepared.error)
              else
                void deps
                  .saveMemory(session, prepared.memory, prepared.redacted)
                  .then((result) =>
                    reply(socket, request.id, {
                      content: [{ type: 'text', text: JSON.stringify(result) }]
                    })
                  )
                  .catch((error: unknown) =>
                    failure(
                      socket,
                      request.id,
                      error instanceof Error ? error.message : 'Não foi possível salvar a memória.'
                    )
                  )
            } else if (name === 'check_memories') {
              reply(socket, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      memoryConflictResult(deps.memoriesForConflict(session.projectId))
                    )
                  }
                ]
              })
            } else if (name === 'search_conversations') {
              const args = request.params?.arguments
              const searchArgs =
                args && typeof args === 'object' ? (args as Record<string, unknown>) : null
              const term =
                searchArgs && typeof searchArgs.term === 'string' ? searchArgs.term.trim() : ''
              if (!term) failure(socket, request.id, 'term é obrigatório.')
              else
                reply(socket, request.id, {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        conversationSearchResult(deps.searchConversations(session.projectId, term))
                      )
                    }
                  ]
                })
            } else if (name === 'read_conversation') {
              const args = request.params?.arguments
              const readArgs =
                args && typeof args === 'object' ? (args as Record<string, unknown>) : null
              const id = readArgs && typeof readArgs.id === 'string' ? readArgs.id.trim() : ''
              const conversation = id ? deps.readConversation(id) : null
              if (!conversation || !readableConversation(conversation, session))
                failure(socket, request.id, 'Conversa indisponível nesta sessão MCP.')
              else
                reply(socket, request.id, {
                  content: [
                    { type: 'text', text: JSON.stringify(conversationReadResult(conversation)) }
                  ]
                })
            } else if (name === 'ler_tasks')
              reply(socket, request.id, {
                content: [{ type: 'text', text: JSON.stringify(deps.readTasks(session.projectId)) }]
              })
            else if (name === 'ler_financeiro')
              reply(socket, request.id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(deps.readFinancial(session.financialProfileId))
                  }
                ]
              })
            else if (name === 'ler_projeto')
              reply(socket, request.id, {
                content: [
                  { type: 'text', text: JSON.stringify(deps.readProjectData(session.projectId)) }
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
                  reply(socket, request.id, {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                  })
                )
                .catch((error: unknown) =>
                  failure(
                    socket,
                    request.id,
                    error instanceof Error ? error.message : 'Não foi possível criar a task.'
                  )
                )
            } else failure(socket, request.id, 'Ferramenta indisponível nesta sessão MCP.')
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
