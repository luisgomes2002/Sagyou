// @vitest-environment node
//
// The broker with the external token (Configurações → Acesso MCP externo):
// scope by mode, the token's default project and financial profile, expired
// and renewed tokens, and the fixed bridge that reads the port from a file.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpExternalStore, type McpExternalScope } from '../modules/agent/mcp-external'
import { EXTERNAL_EXPIRED_MESSAGE, EXTERNAL_RUN_ID } from '../modules/agent/mcp-external-policy'
import {
  MCP_EXTERNAL_BRIDGE_SOURCE,
  externalPermissions,
  startSagyouMcpBroker,
  type McpBrokerDeps,
  type McpSession
} from '../modules/agent/sagyou-mcp'

const servers: { close: () => void }[] = []
const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  while (servers.length) servers.pop()?.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function request(port: number, body: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(port, '127.0.0.1')
    socket.once('error', reject)
    socket.once('connect', () => socket.write(JSON.stringify(body) + '\n'))
    socket.once('data', (chunk) => {
      socket.end()
      resolve(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>)
    })
  })
}

const call = (
  port: number,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> =>
  request(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { token, name, arguments: args }
  })

const listTools = async (port: number, token: string): Promise<string[]> => {
  const reply = await request(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: { token }
  })
  const tools = (reply.result as { tools: { name: string }[] } | undefined)?.tools ?? []
  return tools.map((tool) => tool.name)
}

const errorOf = (reply: Record<string, unknown>): string =>
  String((reply.error as { message?: string } | undefined)?.message ?? '')

function sessionFor(scope: McpExternalScope): McpSession {
  return {
    token: 'external',
    runId: EXTERNAL_RUN_ID,
    projectId: scope.projectId,
    financialProfileId: scope.financialProfileId,
    permissions: externalPermissions(scope.mode)
  }
}

async function brokerWith(
  external: McpBrokerDeps['externalSession'],
  over: Partial<McpBrokerDeps> = {}
): Promise<ReturnType<typeof startSagyouMcpBroker>> {
  const broker = startSagyouMcpBroker({
    readTasks: () => [],
    readFinancial: () => [],
    readProjectData: () => ({}),
    searchMemory: () => [],
    readMemory: () => null,
    touchMemory: () => {},
    memoriesForConflict: () => [],
    saveMemory: async () => ({ ok: true }),
    createTask: async () => ({ ok: true }),
    externalSession: external,
    ...over
  })
  servers.push(broker.server)
  if (!broker.server.listening)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
  return broker
}

const READ_SCOPE: McpExternalScope = {
  projectId: 'p-padrao',
  financialProfileId: 'trabalho',
  mode: 'read'
}

describe('broker com o token externo', () => {
  it('só leitura não lista nem executa escritas, inclusive save_memory e criar_task', async () => {
    const write = vi.fn()
    const broker = await brokerWith((token) => (token === 'ok' ? sessionFor(READ_SCOPE) : null), {
      write
    })
    const names = await listTools(broker.port(), 'ok')
    expect(names).toContain('read_tasks')
    expect(names).toContain('list_projects')
    for (const name of ['update_task', 'create_task', 'save_memory', 'criar_task', 'delete_task'])
      expect([name, names.includes(name)]).toEqual([name, false])
    expect(errorOf(await call(broker.port(), 'ok', 'update_task', { id: 't1' }))).toBe(
      'Ferramenta indisponível nesta sessão MCP.'
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('leitura e escrita lista tudo', async () => {
    const broker = await brokerWith(() => sessionFor({ ...READ_SCOPE, mode: 'read-write' }))
    const names = await listTools(broker.port(), 'ok')
    expect(names).toContain('update_task')
    expect(names).toContain('delete_task')
    expect(names).toContain('criar_task')
  })

  it('lê com o projeto padrão e o perfil financeiro do token', async () => {
    const scoped = vi.fn(() => [{ id: 't1' }])
    const financial = vi.fn(() => ({ ok: true }))
    const broker = await brokerWith(() => sessionFor(READ_SCOPE), {
      readScopedData: scoped,
      readFinancial: financial
    })
    await call(broker.port(), 'ok', 'read_tasks')
    expect(scoped).toHaveBeenCalledWith(
      'tasks',
      expect.objectContaining({ runId: EXTERNAL_RUN_ID, projectId: 'p-padrao' }),
      'p-padrao'
    )
    await call(broker.port(), 'ok', 'ler_financeiro')
    expect(financial).toHaveBeenCalledWith('trabalho')
  })

  it('registra o uso de cada chamada autorizada', async () => {
    const used = vi.fn()
    const broker = await brokerWith(() => sessionFor(READ_SCOPE), { onExternalUse: used })
    await call(broker.port(), 'ok', 'list_projects')
    expect(used).toHaveBeenCalledTimes(1)
    await call(broker.port(), 'ok', 'update_task')
    expect(used).toHaveBeenCalledTimes(1)
  })

  it('token vencido responde a mensagem de renovar; desconhecido, a de sempre', async () => {
    const refused = vi.fn()
    const broker = await brokerWith((token) => (token === 'velho' ? 'expired' : null), {
      onExternalRefused: refused
    })
    expect(errorOf(await call(broker.port(), 'velho', 'list_projects'))).toBe(
      EXTERNAL_EXPIRED_MESSAGE
    )
    expect(refused).toHaveBeenCalledWith('expired')
    expect(errorOf(await call(broker.port(), 'outro', 'list_projects'))).toBe(
      'Sessão MCP inválida ou expirada.'
    )
  })

  it('depois de renovar, o token antigo deixa de valer na hora', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-'))
    dirs.push(dir)
    const store = createMcpExternalStore({ file: join(dir, 'mcp-external.json'), now: Date.now })
    const external = (token: string): McpSession | 'expired' | null => {
      const verified = store.verify(token)
      if (verified.ok) return { ...sessionFor(verified.scope), token }
      return verified.reason === 'expired' ? 'expired' : null
    }
    const broker = await brokerWith(external, { listProjects: () => [{ id: 'p1' }] })
    const { token: first } = store.create(READ_SCOPE)
    expect(errorOf(await call(broker.port(), first, 'list_projects'))).toBe('')
    const { token: second } = store.renew()!
    expect(errorOf(await call(broker.port(), first, 'list_projects'))).toBe(
      'Sessão MCP inválida ou expirada.'
    )
    expect(errorOf(await call(broker.port(), second, 'list_projects'))).toBe('')
    store.revoke()
    expect(errorOf(await call(broker.port(), second, 'list_projects'))).toBe(
      'Sessão MCP inválida ou expirada.'
    )
  })

  it('uma run do Fleet continua tendo precedência e o mesmo comportamento', async () => {
    const external = vi.fn(() => null)
    const broker = await brokerWith(external, { listProjects: () => [] })
    broker.grant({
      token: 'run-token',
      runId: 'run-1',
      projectId: null,
      financialProfileId: 'personal',
      permissions: externalPermissions('read-write')
    })
    expect(errorOf(await call(broker.port(), 'run-token', 'list_projects'))).toBe('')
    expect(external).not.toHaveBeenCalled()
  })
})

describe('ponte do token externo', () => {
  it('não carrega segredo e lê a porta do arquivo a cada conexão', async () => {
    expect(MCP_EXTERNAL_BRIDGE_SOURCE).toContain('SAGYOU_MCP_PORT_FILE')
    expect(MCP_EXTERNAL_BRIDGE_SOURCE).toContain('SAGYOU_MCP_TOKEN')
    const broker = await brokerWith(
      (token) => (token === 'segredo' ? sessionFor(READ_SCOPE) : null),
      {
        listProjects: () => [{ id: 'p1', name: 'Pela ponte' }]
      }
    )
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-bridge-'))
    dirs.push(dir)
    const bridge = join(dir, 'mcp-external-bridge.cjs')
    const portFile = join(dir, 'mcp-external-port')
    writeFileSync(bridge, MCP_EXTERNAL_BRIDGE_SOURCE)
    writeFileSync(portFile, String(broker.port()))
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [bridge], {
        env: { ...process.env, SAGYOU_MCP_PORT_FILE: portFile, SAGYOU_MCP_TOKEN: 'segredo' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let out = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('A ponte não respondeu'))
      }, 5000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        out += chunk
        if (out.includes('\n')) {
          clearTimeout(timeout)
          child.kill()
          resolve(out)
        }
      })
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_projects', arguments: {} }
        }) + '\n'
      )
    })
    expect(output).toContain('Pela ponte')
  })

  it('sem arquivo de porta, sai sem conectar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-bridge-'))
    dirs.push(dir)
    const bridge = join(dir, 'mcp-external-bridge.cjs')
    writeFileSync(bridge, MCP_EXTERNAL_BRIDGE_SOURCE)
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [bridge], {
        env: {
          ...process.env,
          SAGYOU_MCP_PORT_FILE: join(dir, 'nao-existe'),
          SAGYOU_MCP_TOKEN: 'x'
        }
      })
      child.once('close', resolve)
    })
    expect(code).toBe(2)
  })
})
