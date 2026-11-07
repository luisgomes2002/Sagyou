// @vitest-environment node
//
// The broker with the external token (Configurações → Acesso MCP externo):
// full access with no expiry (spec 2026-11-03-acesso-remoto), replaced and
// revoked tokens, and the fixed bridge that reads the port from a file.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { connect, createServer, type AddressInfo, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_EXECUTOR_MCP_PERMISSIONS } from '../modules/agent/agent-mcp-session'
import { createMcpExternalStore } from '../modules/agent/mcp-external'
import {
  EXTERNAL_CUT_MESSAGE,
  EXTERNAL_LOCKED_WRITE_MESSAGE,
  EXTERNAL_RUN_ID
} from '../modules/agent/mcp-external-policy'
import { externalRefusal } from '../modules/agent/mcp-external-lock'
import { MCP_APPROVAL_REQUIRED } from '../modules/agent/mcp-write-tools'
import {
  EXTERNAL_PERMISSIONS,
  MCP_EXTERNAL_BRIDGE_SOURCE,
  MCP_LOCKED_MESSAGE,
  MCP_PERMISSIONS,
  externalHelloProof,
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

/** The session main builds for a valid external token (index.ts externalSession). */
function externalSessionFor(token = 'external'): McpSession {
  return {
    token,
    runId: EXTERNAL_RUN_ID,
    projectId: null,
    financialProfileId: null,
    permissions: EXTERNAL_PERMISSIONS
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

describe('broker com o token externo', () => {
  it('lista exatamente as ferramentas de uma sessão do Fleet', async () => {
    const broker = await brokerWith((token) => (token === 'ok' ? externalSessionFor(token) : null))
    const names = await listTools(broker.port(), 'ok')
    expect([...names].sort()).toEqual([...CODE_EXECUTOR_MCP_PERMISSIONS].sort())
    expect([...names].sort()).toEqual([...MCP_PERMISSIONS].sort())
  })

  it('sem projeto padrão: leituras sem projectId leem todos os projetos', async () => {
    const scoped = vi.fn(() => [{ id: 't1' }])
    const broker = await brokerWith(() => externalSessionFor(), { readScopedData: scoped })
    await call(broker.port(), 'ok', 'read_tasks')
    expect(scoped).toHaveBeenCalledWith(
      'tasks',
      expect.objectContaining({ runId: EXTERNAL_RUN_ID, projectId: null }),
      undefined,
      undefined
    )
  })

  it('finanças: todos os perfis, com filtro opcional profileId', async () => {
    const scoped = vi.fn(() => [])
    const financial = vi.fn(() => [])
    const broker = await brokerWith(() => externalSessionFor(), {
      readScopedData: scoped,
      readFinancial: financial
    })
    await call(broker.port(), 'ok', 'read_financial_data')
    expect(scoped).toHaveBeenLastCalledWith(
      'financial',
      expect.objectContaining({ financialProfileId: null }),
      undefined,
      undefined
    )
    await call(broker.port(), 'ok', 'read_financial_data', { profileId: 'trabalho' })
    expect(scoped).toHaveBeenLastCalledWith('financial', expect.anything(), undefined, 'trabalho')
    await call(broker.port(), 'ok', 'ler_financeiro')
    expect(financial).toHaveBeenLastCalledWith(null, undefined)
    await call(broker.port(), 'ok', 'ler_financeiro', { profileId: 'trabalho' })
    expect(financial).toHaveBeenLastCalledWith(null, 'trabalho')
  })

  it('uma run do Fleet não escolhe outro perfil financeiro', async () => {
    const financial = vi.fn(() => [])
    const broker = await brokerWith(() => null, { readFinancial: financial })
    broker.grant({
      token: 'run-token',
      runId: 'run-1',
      projectId: null,
      financialProfileId: 'personal',
      permissions: CODE_EXECUTOR_MCP_PERMISSIONS
    })
    await call(broker.port(), 'run-token', 'ler_financeiro', { profileId: 'trabalho' })
    expect(financial).toHaveBeenLastCalledWith('personal', undefined)
  })

  it('registra o uso de cada chamada autorizada', async () => {
    const used = vi.fn()
    const broker = await brokerWith(() => externalSessionFor(), { onExternalUse: used })
    await call(broker.port(), 'ok', 'list_projects')
    expect(used).toHaveBeenCalledTimes(1)
    await call(broker.port(), 'ok', 'ferramenta_inventada')
    expect(used).toHaveBeenCalledTimes(1)
  })

  it('token desconhecido responde a mensagem de sempre', async () => {
    const broker = await brokerWith(() => null)
    expect(errorOf(await call(broker.port(), 'outro', 'list_projects'))).toBe(
      'Sessão MCP inválida ou expirada.'
    )
  })

  it('não vence; gerar outro ou revogar tira o token antigo na hora', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-'))
    dirs.push(dir)
    let now = Date.UTC(2026, 10, 3)
    const store = createMcpExternalStore({ file: join(dir, 'mcp-external.json'), now: () => now })
    const external = (token: string): McpSession | null =>
      store.verify(token).ok ? externalSessionFor(token) : null
    const broker = await brokerWith(external, { listProjects: () => [{ id: 'p1' }] })
    const { token: first } = store.create()
    expect(errorOf(await call(broker.port(), first, 'list_projects'))).toBe('')
    now += 365 * 86400000
    expect(errorOf(await call(broker.port(), first, 'list_projects'))).toBe('')
    const { token: second } = store.create()
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
      permissions: CODE_EXECUTOR_MCP_PERMISSIONS
    })
    expect(errorOf(await call(broker.port(), 'run-token', 'list_projects'))).toBe('')
    expect(external).not.toHaveBeenCalled()
  })
})

describe('Sagyou bloqueado ("Ler com o Sagyou bloqueado")', () => {
  // What index.ts wires: the external token follows its option, Fleet runs the lock.
  const lockedDeps = (
    allowWhileLocked: boolean,
    cut = false
  ): Pick<McpBrokerDeps, 'isRunLive' | 'isLocked'> => ({
    isRunLive: () => true,
    isLocked: (runId, kind) =>
      runId === EXTERNAL_RUN_ID
        ? (externalRefusal({ cut, locked: true, locking: false, allowWhileLocked, kind }) ??
          false)
        : true
  })

  it('com a opção, o token externo lê mas não escreve com o app bloqueado', async () => {
    const write = vi.fn<NonNullable<McpBrokerDeps['write']>>(async () => ({ ok: true, id: 'x' }))
    const createTask = vi.fn(async () => ({ ok: true }))
    const broker = await brokerWith(() => externalSessionFor(), {
      ...lockedDeps(true),
      listProjects: () => [{ id: 'p1' }],
      write,
      createTask
    })
    expect(errorOf(await call(broker.port(), 'ok', 'list_projects'))).toBe('')
    expect(errorOf(await call(broker.port(), 'ok', 'update_task', { id: 't1' }))).toBe(
      EXTERNAL_LOCKED_WRITE_MESSAGE
    )
    expect(errorOf(await call(broker.port(), 'ok', 'criar_task', { titulo: 'X' }))).toBe(
      EXTERNAL_LOCKED_WRITE_MESSAGE
    )
    expect(write).not.toHaveBeenCalled()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('com o acesso cortado, tools/call recusa com o texto do corte, mas tools/list responde', async () => {
    const broker = await brokerWith(() => externalSessionFor(), {
      ...lockedDeps(true, true),
      listProjects: () => [{ id: 'p1' }]
    })
    expect(errorOf(await call(broker.port(), 'ok', 'list_projects'))).toBe(EXTERNAL_CUT_MESSAGE)
    expect((await listTools(broker.port(), 'ok')).length).toBeGreaterThan(0)
  })

  it('sem a opção, recebe a mensagem de bloqueio (não "Sessão inválida")', async () => {
    const broker = await brokerWith(() => externalSessionFor(), {
      ...lockedDeps(false),
      listProjects: () => [{ id: 'p1' }]
    })
    expect(errorOf(await call(broker.port(), 'ok', 'list_projects'))).toBe(MCP_LOCKED_MESSAGE)
  })

  it('uma run do Fleet bloqueada recusa mesmo com a opção ligada', async () => {
    const broker = await brokerWith(() => null, {
      ...lockedDeps(true),
      listProjects: () => [{ id: 'p1' }]
    })
    broker.grant({
      token: 'run-token',
      runId: 'run-1',
      projectId: null,
      financialProfileId: 'personal',
      permissions: CODE_EXECUTOR_MCP_PERMISSIONS
    })
    expect(errorOf(await call(broker.port(), 'run-token', 'list_projects'))).toBe(
      MCP_LOCKED_MESSAGE
    )
  })

  it('informa se a chamada bloqueada é leitura ou escrita', async () => {
    const isLocked = vi.fn<NonNullable<McpBrokerDeps['isLocked']>>(() => false)
    const broker = await brokerWith(() => externalSessionFor(), {
      isLocked,
      listProjects: () => [],
      write: async () => ({ ok: true, id: 'x' })
    })
    await call(broker.port(), 'ok', 'list_projects')
    expect(isLocked).toHaveBeenLastCalledWith(EXTERNAL_RUN_ID, 'read')
    await call(broker.port(), 'ok', 'update_task', { id: 't1' })
    expect(isLocked).toHaveBeenLastCalledWith(EXTERNAL_RUN_ID, 'write')
    await call(broker.port(), 'ok', 'criar_task', { titulo: 'X' })
    expect(isLocked).toHaveBeenLastCalledWith(EXTERNAL_RUN_ID, 'write')
  })
})

describe('escritas pelo token externo', () => {
  it('toda escrita que tinha cartão chega à escrita, inclusive save_memory', async () => {
    const write = vi.fn<NonNullable<McpBrokerDeps['write']>>(async () => ({ ok: true, id: 'x' }))
    const saveMemory = vi.fn(async () => ({ ok: true }))
    const broker = await brokerWith(() => externalSessionFor(), { write, saveMemory })
    for (const name of MCP_APPROVAL_REQUIRED)
      expect([name, errorOf(await call(broker.port(), 'ok', name, { id: 'x' }))]).toEqual([
        name,
        ''
      ])
    for (const name of ['delete_task', 'create_transaction', 'archive_project'])
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ runId: EXTERNAL_RUN_ID }),
        name,
        { id: 'x' }
      )
    await call(broker.port(), 'ok', 'save_memory', {
      type: 'decisao',
      title: 'Pelo celular',
      body: 'Decidido fora de casa.'
    })
    expect(saveMemory).toHaveBeenCalledWith(
      expect.objectContaining({ runId: EXTERNAL_RUN_ID }),
      expect.anything(),
      expect.any(Boolean)
    )
  })

  it('criar_task passa para o token externo', async () => {
    const createTask = vi.fn(async () => ({ ok: true, id: 't9' }))
    const broker = await brokerWith(() => externalSessionFor(), { createTask })
    const reply = await call(broker.port(), 'ok', 'criar_task', { titulo: 'Pelo celular' })
    expect(errorOf(reply)).toBe('')
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ runId: EXTERNAL_RUN_ID }),
      expect.objectContaining({ titulo: 'Pelo celular' })
    )
  })

  it('uma sessão do Fleet continua levando delete_task à escrita (com o cartão de lá)', async () => {
    const write = vi.fn<NonNullable<McpBrokerDeps['write']>>(async () => ({ ok: true, id: 'x' }))
    const broker = await brokerWith(() => null, { write })
    broker.grant({
      token: 'run-token',
      runId: 'run-1',
      projectId: null,
      financialProfileId: 'personal',
      permissions: CODE_EXECUTOR_MCP_PERMISSIONS
    })
    await call(broker.port(), 'run-token', 'delete_task', { id: 't1' })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }), 'delete_task', {
      id: 't1'
    })
  })
})

describe('ponte do token externo', () => {
  const SECRET = 'segredo-desta-abertura'

  function runBridge(
    bridge: string,
    env: NodeJS.ProcessEnv,
    stdin: string
  ): Promise<{ out: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bridge], { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('A ponte não respondeu'))
      }, 5000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        out += chunk
        if (out.includes('\n')) child.kill()
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        resolve({ out, code })
      })
      child.stdin.write(stdin)
    })
  }

  const listCall =
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    }) + '\n'

  it('o broker responde o desafio só com o segredo desta abertura', async () => {
    const broker = await brokerWith(() => null, { externalHelloSecret: () => SECRET })
    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 'sagyou-hello',
      method: 'sagyou/hello',
      params: { nonce: 'abc' }
    })
    expect((reply.result as { proof: string }).proof).toBe(externalHelloProof(SECRET, 'abc'))
    const without = await brokerWith(() => null)
    const refused = await request(without.port(), {
      jsonrpc: '2.0',
      id: 'sagyou-hello',
      method: 'sagyou/hello',
      params: { nonce: 'abc' }
    })
    expect(errorOf(refused)).toBe('Sessão MCP inválida ou expirada.')
  })

  it('confere o broker e só então manda o token', async () => {
    const broker = await brokerWith(
      (token) => (token === 'segredo' ? externalSessionFor(token) : null),
      {
        externalHelloSecret: () => SECRET,
        listProjects: () => [{ id: 'p1', name: 'Pela ponte' }]
      }
    )
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-bridge-'))
    dirs.push(dir)
    const bridge = join(dir, 'mcp-external-bridge.cjs')
    const portFile = join(dir, 'mcp-external-port')
    writeFileSync(bridge, MCP_EXTERNAL_BRIDGE_SOURCE)
    writeFileSync(portFile, `${broker.port()}\n${SECRET}`)
    const { out } = await runBridge(
      bridge,
      { ...process.env, SAGYOU_MCP_PORT_FILE: portFile, SAGYOU_MCP_TOKEN: 'segredo' },
      listCall
    )
    expect(out).toContain('Pela ponte')
    expect(out).not.toContain('sagyou-hello')
  })

  // Security review: a stale port file (Windows shutdown skips before-quit) let
  // whoever took the port receive the token.
  it('numa porta velha tomada por outro programa, sai sem mandar o token', async () => {
    const received: string[] = []
    const impostor = createServer((socket) => {
      socket.on('error', () => {})
      socket.on('data', (chunk) => {
        received.push(chunk.toString('utf8'))
        socket.write(
          JSON.stringify({ jsonrpc: '2.0', id: 'sagyou-hello', result: { proof: 'falsa' } }) + '\n'
        )
      })
    })
    servers.push(impostor)
    await new Promise<void>((resolve) => impostor.listen(0, '127.0.0.1', resolve))
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-bridge-'))
    dirs.push(dir)
    const bridge = join(dir, 'mcp-external-bridge.cjs')
    const portFile = join(dir, 'mcp-external-port')
    writeFileSync(bridge, MCP_EXTERNAL_BRIDGE_SOURCE)
    writeFileSync(portFile, `${(impostor.address() as AddressInfo).port}\n${SECRET}`)
    const { code } = await runBridge(
      bridge,
      { ...process.env, SAGYOU_MCP_PORT_FILE: portFile, SAGYOU_MCP_TOKEN: 'token-secreto' },
      listCall
    )
    expect(code).toBe(3)
    expect(received.join('')).not.toContain('token-secreto')
  })

  it('sem arquivo de porta ou sem segredo, sai sem conectar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-bridge-'))
    dirs.push(dir)
    const bridge = join(dir, 'mcp-external-bridge.cjs')
    writeFileSync(bridge, MCP_EXTERNAL_BRIDGE_SOURCE)
    const onlyPort = join(dir, 'so-porta')
    writeFileSync(onlyPort, '4567')
    for (const file of [join(dir, 'nao-existe'), onlyPort]) {
      const { code } = await runBridge(
        bridge,
        { ...process.env, SAGYOU_MCP_PORT_FILE: file, SAGYOU_MCP_TOKEN: 'x' },
        ''
      )
      expect(code).toBe(2)
    }
  })
})
