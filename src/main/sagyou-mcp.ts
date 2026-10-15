import { createServer, type Server, type Socket } from 'net'

export interface McpSession {
  token: string
  runId: string
  projectId: string | null
  financialProfileId: string
  expiresAt: number
}

export interface McpBrokerDeps {
  readTasks: (projectId: string | null) => unknown[]
  readFinancial: (profileId: string) => unknown
  readProjectData: (projectId: string | null) => unknown
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

const TOOLS = [
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
          if (!session || session.expiresAt < Date.now()) {
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
            reply(socket, request.id, { tools: TOOLS })
          } else if (request.method === 'tools/call') {
            const name = request.params?.name
            if (name === 'ler_tasks')
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
    grant: (session) => sessions.set(session.token, session),
    revoke: (token) => sessions.delete(token)
  }
}
