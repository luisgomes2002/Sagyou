// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect, type Socket } from 'net'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import {
  MCP_PERMISSIONS,
  MCP_STDIO_BRIDGE_SOURCE,
  startSagyouMcpBroker,
  type McpSession
} from '../modules/agent/sagyou-mcp'
import { McpWriteQueue, RendererMcpActionBridge } from '../modules/agent/mcp-write-queue'
import type { AiMemory } from '../modules/ai/memory'
import type { MemorySearchHit } from '../store'
import type { StoredConversation } from '../modules/conversations/conversation-types'

const memoryHit = (over: Record<string, unknown> = {}): MemorySearchHit =>
  ({
    memory: {
      id: 'memory-1',
      projectId: 'project-1',
      title: 'DecisÃ£o importante',
      body: 'Este corpo completo nÃ£o pode atravessar o MCP.',
      type: 'decisao',
      tags: ['arquitetura'],
      pinned: false
    },
    snippet: 'Trecho relevante da decisÃ£o.',
    ...over
  }) as unknown as MemorySearchHit

const servers: { close: () => void }[] = []

afterEach(() => {
  vi.restoreAllMocks()
  while (servers.length) servers.pop()?.close()
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

function malformedRequest(port: number, line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(port, '127.0.0.1')
    socket.once('error', reject)
    socket.once('connect', () => socket.write(line + '\n'))
    socket.once('data', (chunk) => {
      socket.end()
      resolve(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>)
    })
  })
}

function bridgeRequest(
  bridgePath: string,
  env: NodeJS.ProcessEnv,
  body: object
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let errors = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Bridge MCP não respondeu: ${errors}`))
    }, 5_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const line = output.split('\n')[0]
      if (!line) return
      clearTimeout(timeout)
      child.kill()
      resolve(JSON.parse(line) as Record<string, unknown>)
    })
    child.stderr.on('data', (chunk: string) => {
      errors += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.stdin.end(JSON.stringify(body) + '\n')
  })
}

function bridgeExitCode(bridgePath: string, env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], { env, stdio: ['pipe', 'ignore', 'pipe'] })
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
    child.stdin.end()
  })
}

function bridgeDropsMalformedInput(bridgePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const timeout = setTimeout(() => child.kill(), 100)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timeout)
      resolve(output)
    })
    child.stdin.end('{not-json\n')
  })
}

describe('Sagyou MCP broker', () => {
  it('uses a temporary token while allowing an explicit project read', async () => {
    const requestedProjects: (string | null | undefined)[] = []
    const broker = startSagyouMcpBroker({
      listProjects: () => [{ id: 'other', name: 'Outro' }],
      readTasks: (projectId) => {
        requestedProjects.push(projectId)
        return [{ projectId: projectId ?? 'all' }]
      },
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'one-run',
      runId: 'run-1',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { token: 'one-run', name: 'ler_tasks', arguments: { projectId: 'other' } }
    })

    expect(JSON.stringify(reply)).toContain('other')
    const listed = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { token: 'one-run', name: 'list_projects', arguments: {} }
    })
    expect(JSON.stringify(listed)).toContain('Outro')
    broker.grant({
      token: 'general-run',
      runId: 'run-general',
      projectId: null,
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    const general = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { token: 'general-run', name: 'ler_tasks', arguments: {} }
    })
    expect(JSON.stringify(general)).toContain('all')
    expect(requestedProjects).toEqual(['other', undefined])
  })

  it('rejects missing and expired capabilities before invoking a tool', async () => {
    let reads = 0
    let searches = 0
    const broker = startSagyouMcpBroker({
      readTasks: () => {
        reads += 1
        return []
      },
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => {
        searches += 1
        return []
      },
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'expired',
      runId: 'run-1',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() - 1
    })

    const [withoutToken, expired] = await Promise.all([
      request(broker.port(), {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_memory', arguments: { term: 'segredo' } }
      }),
      request(broker.port(), {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { token: 'expired', name: 'search_memory', arguments: { term: 'segredo' } }
      })
    ])

    expect(withoutToken.error).toBeTruthy()
    expect(expired.error).toBeTruthy()
    expect(reads).toBe(0)
    expect(searches).toBe(0)
  })

  it('rejects forged, revoked and unpermitted capabilities immediately on loopback', async () => {
    let reads = 0
    let writes = 0
    const broker = startSagyouMcpBroker({
      readTasks: () => {
        reads += 1
        return [{ projectId: 'fixed-project' }]
      },
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => {
        writes += 1
        return { ok: true }
      }
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    expect((broker.server.address() as { address: string }).address).toBe('127.0.0.1')
    const restricted: McpSession = {
      token: 'restricted-token',
      runId: 'run-restricted',
      projectId: 'fixed-project',
      financialProfileId: 'personal',
      permissions: ['ler_tasks'],
      expiresAt: Date.now() + 10_000
    }
    broker.grant(restricted)
    // The UI may change projects after the executor has started. The capability
    // must retain the project captured at grant time.
    restricted.projectId = 'swapped-project'

    const call = (token: string, name: string, id: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { token, name, arguments: { projectId: 'forged-project' } }
      })
    const listed = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: { token: 'restricted-token' }
    })
    expect((listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(
      ['ler_tasks']
    )
    expect((await call('forged-token', 'ler_tasks', 4)).error).toBeTruthy()
    expect((await call('restricted-token', 'criar_task', 5)).error).toBeTruthy()
    expect(reads).toBe(0)
    expect(writes).toBe(0)

    const allowed = await call('restricted-token', 'ler_tasks', 6)
    expect(JSON.stringify(allowed)).toContain('fixed-project')
    expect(reads).toBe(1)
    broker.revoke('restricted-token')
    expect((await call('restricted-token', 'ler_tasks', 7)).error).toBeTruthy()
    expect(reads).toBe(1)
  })

  it('routes an explicit task target through the granted run for approval', async () => {
    let received: {
      runId: string
      projectId: string | null
      args: Record<string, unknown>
    } | null = null
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async (session, args) => {
        received = { runId: session.runId, projectId: session.projectId, args }
        return { ok: true, id: 'created' }
      }
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'writer',
      runId: 'run-authorized',
      projectId: 'project-authorized',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        token: 'writer',
        name: 'criar_task',
        arguments: { titulo: 'Task segura', projectId: 'forged-project' }
      }
    })

    expect(reply.error).toBeUndefined()
    expect(received).toEqual({
      runId: 'run-authorized',
      projectId: 'project-authorized',
      args: { titulo: 'Task segura', projectId: 'forged-project' }
    })
  })

  it('injects the temporary token through the stdio bridge', async () => {
    const broker = startSagyouMcpBroker({
      readTasks: (projectId) => [{ projectId }],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'bridge-token',
      runId: 'run-bridge',
      projectId: 'bridge-project',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-'))
    const bridgePath = join(dir, 'bridge.cjs')
    writeFileSync(bridgePath, MCP_STDIO_BRIDGE_SOURCE, 'utf8')
    try {
      const reply = await bridgeRequest(
        bridgePath,
        {
          ...process.env,
          SAGYOU_MCP_PORT: String(broker.port()),
          SAGYOU_MCP_TOKEN: 'bridge-token'
        },
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ler_tasks' } }
      )
      expect(JSON.stringify(reply)).toContain('bridge-project')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps two stdio MCP sessions bounded to their capability across protocol calls', async () => {
    // This intentionally uses no Electron store or database. The broker receives
    // in-memory fixtures only, while the child process exercises the disposable
    // stdio bridge exactly as an external executor does.
    let now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const scopedReads: { domain: string; projectId: string | null | undefined; profileId: string }[] = []
    const broker = startSagyouMcpBroker({
      readScopedData: (domain, session, projectId) => {
        scopedReads.push({
          domain,
          projectId,
          profileId: session.financialProfileId
        })
        if (domain === 'financial') return [{ profileId: session.financialProfileId }]
        return Array.from({ length: 51 }, (_, index) => ({
          id: `${projectId}-${index}`,
          projectId,
          profileId: session.financialProfileId
        }))
      },
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    expect((broker.server.address() as { address: string }).address).toBe('127.0.0.1')

    const expiresAt = now + 100
    broker.grant({
      token: 'session-alpha',
      runId: 'run-alpha',
      projectId: 'project-alpha',
      financialProfileId: 'profile-alpha',
      permissions: ['read_tasks', 'read_financial_data'],
      expiresAt
    })
    broker.grant({
      token: 'session-beta',
      runId: 'run-beta',
      projectId: 'project-beta',
      financialProfileId: 'profile-beta',
      permissions: ['read_tasks', 'read_financial_data'],
      expiresAt
    })

    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-security-'))
    const bridgePath = join(dir, 'bridge.cjs')
    writeFileSync(bridgePath, MCP_STDIO_BRIDGE_SOURCE, 'utf8')
    const call = (token: string, body: object) =>
      bridgeRequest(
        bridgePath,
        {
          ...process.env,
          SAGYOU_MCP_PORT: String(broker.port()),
          SAGYOU_MCP_TOKEN: token
        },
        body
      )
    try {
      expect(
        await bridgeExitCode(bridgePath, {
          ...process.env,
          SAGYOU_MCP_PORT: String(broker.port()),
          SAGYOU_MCP_TOKEN: undefined
        })
      ).toBe(2)
      expect(
        await bridgeDropsMalformedInput(bridgePath, {
          ...process.env,
          SAGYOU_MCP_PORT: String(broker.port()),
          SAGYOU_MCP_TOKEN: 'session-alpha'
        })
      ).toBe('')

      const initialize = await call('session-alpha', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { token: 'forged-token' }
      })
      expect(initialize.result).toMatchObject({ protocolVersion: '2024-11-05' })

      const listed = await call('session-alpha', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      })
      expect(
        (listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
      ).toEqual(['read_tasks', 'read_financial_data'])

      const alphaTasks = await call('session-alpha', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'read_tasks',
          arguments: { projectId: 'project-beta', profileId: 'profile-beta', offset: 0, limit: 999 }
        }
      })
      const alphaPage = JSON.parse(
        (alphaTasks.result as { content: { text: string }[] }).content[0].text
      ) as { total: number; items: { projectId: string; profileId: string }[]; truncated: boolean }
      expect(alphaPage).toMatchObject({ total: 51, truncated: true })
      expect(alphaPage.items).toHaveLength(50)
      expect(alphaPage.items.every((item) => item.projectId === 'project-beta')).toBe(true)
      expect(alphaPage.items.every((item) => item.profileId === 'profile-alpha')).toBe(true)

      const betaFinancial = await call('session-beta', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'read_financial_data',
          arguments: { projectId: 'project-alpha', profileId: 'profile-alpha' }
        }
      })
      expect(JSON.stringify(betaFinancial)).toContain('profile-beta')
      expect(JSON.stringify(betaFinancial)).not.toContain('profile-alpha')
      expect(scopedReads).toEqual([
        { domain: 'tasks', projectId: 'project-beta', profileId: 'profile-alpha' },
        { domain: 'financial', projectId: 'project-alpha', profileId: 'profile-beta' }
      ])

      const forged = await call('forged-token', {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'read_tasks', arguments: {} }
      })
      expect(forged.error).toMatchObject({ message: expect.stringMatching(/inválida|expirada/i) })

      broker.revoke('session-alpha')
      const revoked = await call('session-alpha', {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'read_tasks', arguments: {} }
      })
      expect(revoked.error).toBeTruthy()

      now = expiresAt
      const expired = await call('session-beta', {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'read_tasks', arguments: {} }
      })
      expect(expired.error).toMatchObject({ message: expect.stringMatching(/expirada/i) })

      const malformed = await malformedRequest(broker.port(), '{not-json')
      expect(malformed.error).toMatchObject({
        message: expect.stringMatching(/mensagem MCP inválida/i)
      })

      const missingParameters = await request(broker.port(), {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: null
      })
      expect(missingParameters.error).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists approved scoped MCP memories only after the renderer path flushes', async () => {
    // The production store is intentionally replaced with this in-memory map:
    // the test covers the complete authority/approval protocol without loading
    // ElectronStorage, SQLite, or any user record.
    const memories = new Map<string, AiMemory>()
    type ApprovalMode = 'approve' | 'deny' | 'timeout' | 'flush-failure'
    const approvalByRun = new Map<string, ApprovalMode>([
      ['run-alpha', 'approve'],
      ['run-beta', 'approve']
    ])
    const rendererRequests: { runId: string; args: Record<string, unknown> }[] = []
    const renderer = new RendererMcpActionBridge<
      { runId: string; args: Record<string, unknown> },
      boolean
    >(({ requestId, payload }) => {
      rendererRequests.push(payload)
      const mode = approvalByRun.get(payload.runId) ?? 'deny'
      if (mode === 'approve' || mode === 'flush-failure') renderer.resolve(requestId, true)
      else if (mode === 'deny') renderer.resolve(requestId, false)
      // A timeout deliberately leaves the renderer request unresolved.
    }, 25)
    const writes = new McpWriteQueue((request) =>
      renderer.request({ runId: request.runId, args: request.args })
    )
    let flushes = 0
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: (projectId, term) =>
        [...memories.values()]
          .filter(
            (memory) =>
              (memory.projectId === null || memory.projectId === projectId) &&
              memory.title.toLocaleLowerCase().includes(term.toLocaleLowerCase())
          )
          .map((memory) => ({ memory, snippet: memory.body.slice(0, 240) })) as MemorySearchHit[],
      readMemory: (id) => memories.get(id) ?? null,
      touchMemory: () => {},
      memoriesForConflict: (projectId) =>
        [...memories.values()].filter(
          (memory) => memory.projectId === null || memory.projectId === projectId
        ),
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async (session, memory, redacted) => {
        const outcome = await writes.enqueue(
          {
            runId: session.runId,
            name: 'save_memory',
            args: { tipo: memory.type, titulo: memory.title, corpo: memory.body, tags: memory.tags }
          },
          async () => {
            if (approvalByRun.get(session.runId) === 'flush-failure')
              throw new Error('flush da memória falhou')
            // This represents the store's completed durable upsert. The broker
            // must not send success until this has happened.
            flushes += 1
            memories.set(memory.id, memory)
            return { ok: true, id: memory.id, ...(redacted ? { redacted: true } : {}) }
          }
        )
        return outcome.approved
          ? outcome.value!
          : { ok: false, error: 'Salvamento não aprovado pelo usuário.' }
      },
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    for (const [token, runId, projectId] of [
      ['memory-alpha', 'run-alpha', 'project-alpha'],
      ['memory-beta', 'run-beta', 'project-beta']
    ] as const) {
      broker.grant({
        token,
        runId,
        projectId,
        financialProfileId: 'personal',
        permissions: ['search_memory', 'read_memory', 'save_memory', 'check_memories'],
        expiresAt: Date.now() + 10_000
      })
    }

    const dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-memory-'))
    const bridgePath = join(dir, 'bridge.cjs')
    writeFileSync(bridgePath, MCP_STDIO_BRIDGE_SOURCE, 'utf8')
    const call = (token: string, name: string, arguments_: Record<string, unknown>, id: number) =>
      bridgeRequest(
        bridgePath,
        {
          ...process.env,
          SAGYOU_MCP_PORT: String(broker.port()),
          SAGYOU_MCP_TOKEN: token
        },
        { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } }
      )
    const result = (reply: Record<string, unknown>): Record<string, unknown> =>
      JSON.parse((reply.result as { content: { text: string }[] }).content[0].text) as Record<
        string,
        unknown
      >
    try {
      const approved = await call(
        'memory-alpha',
        'save_memory',
        {
          type: 'decisao',
          title: 'Segurança do broker',
          body: 'Nunca registre sk-abcdefghijklmnop em logs.',
          tags: ['mcp']
        },
        1
      )
      expect(result(approved)).toMatchObject({ ok: true, redacted: true })
      expect(flushes).toBe(1)
      expect(memories.size).toBe(1)
      const alphaMemory = [...memories.values()][0]
      expect(alphaMemory).toMatchObject({ projectId: 'project-alpha', type: 'decisao' })
      expect(alphaMemory.body).toContain('[REDIGIDO]')
      expect(alphaMemory.body).not.toContain('sk-abcdefghijklmnop')
      expect(JSON.stringify(rendererRequests[0])).not.toContain('sk-abcdefghijklmnop')

      const [alphaSecond, betaApproved] = await Promise.all([
        call(
          'memory-alpha',
          'save_memory',
          { type: 'fato', title: 'Escopo alpha', body: 'Somente alpha lê isto.' },
          2
        ),
        call(
          'memory-beta',
          'save_memory',
          { type: 'fato', title: 'Escopo beta', body: 'Somente beta lê isto.' },
          3
        )
      ])
      expect(result(alphaSecond)).toMatchObject({ ok: true })
      expect(result(betaApproved)).toMatchObject({ ok: true })
      expect(
        [...memories.values()].filter((memory) => memory.projectId === 'project-alpha')
      ).toHaveLength(2)
      expect(
        [...memories.values()].filter((memory) => memory.projectId === 'project-beta')
      ).toHaveLength(1)

      const searched = await call('memory-alpha', 'search_memory', { term: 'escopo' }, 4)
      expect(JSON.stringify(result(searched))).toContain('Escopo alpha')
      expect(JSON.stringify(result(searched))).not.toContain('Escopo beta')

      const readOwn = await call('memory-alpha', 'read_memory', { id: alphaMemory.id }, 5)
      expect(result(readOwn)).toMatchObject({ id: alphaMemory.id, scope: 'project' })
      const readOther = await call('memory-beta', 'read_memory', { id: alphaMemory.id }, 6)
      expect(result(readOther)).toMatchObject({ id: alphaMemory.id })
      const conflicts = await call('memory-alpha', 'check_memories', {}, 7)
      expect(result(conflicts)).toHaveProperty('conflicts')

      approvalByRun.set('run-beta', 'deny')
      const denied = await call(
        'memory-beta',
        'save_memory',
        { type: 'fato', title: 'Não salvar', body: 'recusada' },
        8
      )
      expect(result(denied)).toMatchObject({ ok: false })
      expect([...memories.values()].some((memory) => memory.title === 'Não salvar')).toBe(false)

      approvalByRun.set('run-alpha', 'timeout')
      const timedOut = await call(
        'memory-alpha',
        'save_memory',
        { type: 'fato', title: 'Expira', body: 'não grava' },
        9
      )
      expect(timedOut.error).toMatchObject({ message: expect.stringMatching(/não respondeu/i) })
      expect([...memories.values()].some((memory) => memory.title === 'Expira')).toBe(false)

      approvalByRun.set('run-beta', 'flush-failure')
      const flushFailure = await call(
        'memory-beta',
        'save_memory',
        { type: 'fato', title: 'Flush falha', body: 'não grava' },
        10
      )
      expect(flushFailure.error).toMatchObject({ message: 'flush da memória falhou' })
      expect([...memories.values()].some((memory) => memory.title === 'Flush falha')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('searches ranked project and global memories without exposing their bodies', async () => {
    let received: { projectId: string | null | undefined; term: string } | null = null
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: (projectId, term) => {
        received = { projectId, term }
        return [
          memoryHit({ memory: { ...memoryHit().memory, id: 'project-hit', projectId } }),
          memoryHit({ memory: { ...memoryHit().memory, id: 'global-hit', projectId: null } })
        ]
      },
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'memory-token',
      runId: 'run-memory',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { token: 'memory-token', name: 'search_memory', arguments: { term: 'decisÃ£o' } }
    })

    const text = (reply.result as { content: { text: string }[] }).content[0].text
    const result = JSON.parse(text) as {
      memories: { id: string; scope: string; snippet: string }[]
    }
    expect(received).toEqual({ projectId: 'project-1', term: 'decisÃ£o' })
    expect(result.memories.map((memory) => memory.id)).toEqual(['project-hit', 'global-hit'])
    expect(result.memories.map((memory) => memory.scope)).toEqual(['project', 'global'])
    expect(text).not.toContain('Este corpo completo')

    await request(broker.port(), {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        token: 'memory-token',
        name: 'search_memory',
        arguments: { term: 'decisão', projectId: 'project-2' }
      }
    })
    expect(received).toEqual({ projectId: 'project-2', term: 'decisão' })
  })

  it('offers project selection in memory search and caps snippets and results', async () => {
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () =>
        Array.from({ length: 10 }, (_, i) =>
          memoryHit({
            memory: { ...memoryHit().memory, id: `m-${i}` },
            snippet: 'x'.repeat(300)
          })
        ),
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'limit-token',
      runId: 'run-limit',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const listed = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/list',
      params: { token: 'limit-token' }
    })
    const searchTool = (
      listed.result as { tools: { name: string; inputSchema: { properties: object } }[] }
    ).tools.find((tool) => tool.name === 'search_memory')
    const readTool = (
      listed.result as { tools: { name: string; inputSchema: { properties: object } }[] }
    ).tools.find((tool) => tool.name === 'read_memory')
    expect(searchTool?.inputSchema.properties).toHaveProperty('projectId')
    expect(searchTool?.inputSchema.properties).not.toHaveProperty('includeArchived')
    expect(readTool?.inputSchema.properties).not.toHaveProperty('projectId')

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { token: 'limit-token', name: 'search_memory', arguments: { term: 'x' } }
    })
    const result = JSON.parse(
      (reply.result as { content: { text: string }[] }).content[0].text
    ) as {
      memories: { snippet: string }[]
    }
    expect(result.memories).toHaveLength(8)
    expect(result.memories[0].snippet).toHaveLength(240)
  })

  it('reads active memories across projects and touches successful reads', async () => {
    const touched: string[] = []
    const active = { ...memoryHit().memory, archivedAt: null }
    const authorized = { ...active, id: 'authorized', body: 'a'.repeat(6_100) }
    const global = { ...active, id: 'global', projectId: null }
    const other = { ...active, id: 'other', projectId: 'project-2' }
    const archived = { ...active, id: 'archived', archivedAt: '2026-01-01T00:00:00Z' }
    const byId = new Map<string, AiMemory>([
      ['authorized', authorized],
      ['global', global],
      ['other', other],
      ['archived', archived]
    ])
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: (id) => byId.get(id) ?? null,
      touchMemory: (id) => touched.push(id),
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'reader-token',
      runId: 'run-reader',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const call = (id: string, requestId: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: { token: 'reader-token', name: 'read_memory', arguments: { id } }
      })
    const [projectReply, globalReply, prefixReply, otherReply, archivedReply, missingReply] =
      await Promise.all([
        call('authorized', 8),
        call('global', 9),
        call('author', 10),
        call('other', 11),
        call('archived', 12),
        call('missing', 13)
      ])

    const project = JSON.parse(
      (projectReply.result as { content: { text: string }[] }).content[0].text
    ) as { body: string; truncated: boolean; warning: string }
    expect(project.body).toHaveLength(6_000)
    expect(project.truncated).toBe(true)
    expect(project.warning).toMatch(/evidência histórica/i)
    expect(globalReply.error).toBeUndefined()
    expect(otherReply.error).toBeUndefined()
    expect(touched.sort()).toEqual(['authorized', 'global', 'other'])
    for (const reply of [prefixReply, archivedReply, missingReply]) {
      expect(reply.error).toEqual({
        code: -32000,
        message: 'Memória indisponível nesta sessão MCP.'
      })
      expect(JSON.stringify(reply)).not.toContain('project-2')
      expect(JSON.stringify(reply)).not.toContain('archived')
    }
  })

  it('saves only approved, explicit learnings in the session project and redacts secrets', async () => {
    const persisted: AiMemory[] = []
    let mode: 'approve' | 'deny' | 'timeout' = 'approve'
    let saveCalls = 0
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async (_session, memory, redacted) => {
        saveCalls += 1
        if (mode === 'timeout') throw new Error('A aprovação expirou.')
        if (mode === 'deny') return { ok: false, error: 'Salvamento não aprovado pelo usuário.' }
        persisted.push(memory) // the response must wait until this simulated flush completes
        return { ok: true, id: memory.id, ...(redacted ? { redacted: true } : {}) }
      },
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'save-token',
      runId: 'run-save',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    const call = (arguments_: Record<string, unknown>, id: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { token: 'save-token', name: 'save_memory', arguments: arguments_ }
      })

    const approved = await call(
      {
        type: 'gotcha',
        title: 'Configuração',
        body: 'Nunca exponha sk-abcdefghijklmnop em logs.',
        tags: ['segurança'],
        projectId: 'forged-project'
      },
      14
    )
    const approvalResult = JSON.parse(
      (approved.result as { content: { text: string }[] }).content[0].text
    ) as { ok: boolean; redacted: boolean }
    expect(approvalResult).toMatchObject({ ok: true, redacted: true })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ projectId: 'project-1', type: 'gotcha' })
    expect(persisted[0].body).toContain('[REDIGIDO]')
    expect(persisted[0].body).not.toContain('sk-abcdefghijklmnop')

    mode = 'deny'
    const denied = await call({ type: 'fato', title: 'Não salvar', body: 'recusada' }, 15)
    expect(
      JSON.parse((denied.result as { content: { text: string }[] }).content[0].text)
    ).toMatchObject({
      ok: false
    })
    expect(persisted).toHaveLength(1)

    mode = 'timeout'
    const timedOut = await call({ type: 'fato', title: 'Expira', body: 'não grava' }, 16)
    expect(timedOut.error).toMatchObject({ message: 'A aprovação expirou.' })
    expect(persisted).toHaveLength(1)

    const invalid = await call({ title: 'Sem tipo', body: 'não é fato por padrão' }, 17)
    expect(invalid.error).toBeTruthy()
    const oversized = await call({ type: 'fato', title: 'x'.repeat(201), body: 'não grava' }, 18)
    expect(oversized.error).toBeTruthy()
    expect(saveCalls).toBe(3)
  })

  it('returns only scoped, non-handoff conflict pairs with bounded snippets', async () => {
    const active = { ...memoryHit().memory, archivedAt: null }
    const global = {
      ...active,
      id: 'global',
      projectId: null,
      title: 'Banco',
      body: 'Use Decimal.'
    }
    const project = {
      ...active,
      id: 'project',
      projectId: 'project-1',
      title: 'banco',
      body: 'Use string decimal.'
    }
    const duplicate = {
      ...active,
      id: 'duplicate',
      projectId: 'project-1',
      title: 'BANCO',
      body: 'Use Decimal.'
    }
    const handoff = {
      ...active,
      id: 'handoff',
      projectId: 'project-1',
      type: 'handoff' as const,
      title: 'Banco',
      body: 'Não deve aparecer.'
    }
    const otherProject = {
      ...active,
      id: 'other',
      projectId: 'project-2',
      title: 'Banco',
      body: 'Vazamento.'
    }
    let requestedProject: string | null | undefined
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: (projectId) => {
        requestedProject = projectId
        return [global, project, duplicate, handoff] // `otherProject` is intentionally excluded by scope.
      },
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'conflict-token',
      runId: 'run-conflict',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: { token: 'conflict-token', name: 'check_memories', arguments: {} }
    })
    const result = JSON.parse(
      (reply.result as { content: { text: string }[] }).content[0].text
    ) as { total: number; conflicts: { a: { id: string }; b: { id: string } }[] }
    expect(requestedProject).toBe('project-1')
    expect(result.total).toBe(2)
    expect(result.conflicts).toHaveLength(2)
    expect(JSON.stringify(result)).toContain('global')
    expect(JSON.stringify(result)).toContain('project')
    expect(JSON.stringify(result)).not.toContain('handoff')
    expect(JSON.stringify(result)).not.toContain(otherProject.id)
  })

  it('searches conversations across projects, rejects an empty term and bounds results', async () => {
    const calls: { projectId: string | null | undefined; term: string }[] = []
    const projectHits = Array.from({ length: 10 }, (_, index) => ({
      id: `project-${index}`,
      title: `Projeto ${index}`,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      snippet: index === 0 ? 'Mensagem de usuário sobre deploy.' : 'x'.repeat(300)
    }))
    const legacyHit = {
      id: 'legacy-general',
      title: 'Conversa antiga',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
      snippet: 'Contexto legado.'
    }
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: (projectId, term) => {
        calls.push({ projectId, term })
        return (projectId === undefined ? [legacyHit, ...projectHits] : projectHits) as never
      },
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'conversation-token',
      runId: 'run-conversation',
      projectId: 'project-1',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    broker.grant({
      token: 'general-token',
      runId: 'run-general',
      projectId: null,
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    const call = (token: string, term: string, id: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { token, name: 'search_conversations', arguments: { term } }
      })

    const projectReply = await call('conversation-token', 'deploy', 20)
    const project = JSON.parse(
      (projectReply.result as { content: { text: string }[] }).content[0].text
    ) as {
      total: number
      truncated: boolean
      conversations: { id: string; title: string; snippet: string }[]
    }
    expect(calls[0]).toEqual({ projectId: 'project-1', term: 'deploy' })
    expect(project).toMatchObject({ total: 10, truncated: true })
    expect(project.conversations).toHaveLength(8)
    expect(project.conversations[0]).toMatchObject({ id: 'project-0', title: 'Projeto 0' })
    expect(project.conversations[1].snippet).toHaveLength(240)

    const blank = await call('conversation-token', '   ', 21)
    expect(blank.error).toBeTruthy()
    expect(calls).toHaveLength(1)

    const generalReply = await call('general-token', 'legado', 22)
    expect(calls[1]).toEqual({ projectId: undefined, term: 'legado' })
    expect(JSON.stringify(generalReply)).toContain('legacy-general')
    expect(JSON.stringify(generalReply)).toContain('project-0')
  })

  it('reads transcripts across projects, drops status and attachments, and keeps the relevant tail', async () => {
    const protectedConversation = {
      id: 'protected',
      projectId: 'project-1',
      title: 'Decisão do projeto',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      messages: [
        { role: 'user' as const, content: 'Contexto inicial' },
        { role: 'status' as const, content: 'SEGREDO_STATUS', imageIds: ['attachment-id'] },
        { role: 'assistant' as const, content: `${'x'.repeat(8_100)} cauda importante` }
      ]
    }
    const legacyConversation = {
      ...protectedConversation,
      id: 'legacy',
      projectId: undefined,
      title: 'Conversa legada',
      messages: [{ role: 'user' as const, content: 'Legado geral' }]
    }
    const wrongProject = { ...protectedConversation, id: 'wrong', projectId: 'project-2' }
    const conversations = new Map<string, StoredConversation>([
      ['protected', protectedConversation],
      ['legacy', legacyConversation],
      ['wrong', wrongProject]
    ])
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: (id) => (conversations.get(id) as never) ?? null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    for (const [token, projectId] of [
      ['reader-project', 'project-1'],
      ['reader-general', null]
    ] as const) {
      broker.grant({
        token,
        runId: token,
        projectId,
        financialProfileId: 'personal',
        permissions: MCP_PERMISSIONS,
        expiresAt: Date.now() + 10_000
      })
    }
    const call = (token: string, id: string, requestId: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: { token, name: 'read_conversation', arguments: { id } }
      })

    const allowed = await call('reader-project', 'protected', 23)
    const result = JSON.parse(
      (allowed.result as { content: { text: string }[] }).content[0].text
    ) as { turns: { role: string; text: string }[]; truncated: boolean; warning: string }
    expect(result.truncated).toBe(true)
    expect(result.warning).toMatch(/evidência histórica/i)
    expect(result.turns.map((turn) => turn.role)).not.toContain('status')
    expect(JSON.stringify(result)).not.toContain('SEGREDO_STATUS')
    expect(JSON.stringify(result)).not.toContain('attachment-id')
    expect(result.turns.map((turn) => turn.text).join('').length).toBeLessThanOrEqual(8_000)
    expect(result.turns.at(-1)?.text).toContain('cauda importante')

    const [legacyAllowed, wrongAllowed, missingDenied] = await Promise.all([
      call('reader-project', 'legacy', 24),
      call('reader-project', 'wrong', 25),
      call('reader-project', 'missing', 26)
    ])
    expect(legacyAllowed.error).toBeUndefined()
    expect(wrongAllowed.error).toBeUndefined()
    expect(missingDenied.error).toMatchObject({ code: -32000 })
    const generalAllowed = await call('reader-general', 'legacy', 27)
    expect(JSON.stringify(generalAllowed)).toContain('Conversa legada')
  })

  it('pages data domains with a chosen project while retaining the financial profile', async () => {
    const calls: string[] = []
    const broker = startSagyouMcpBroker({
      readScopedData: (domain, session, projectId) => {
        calls.push(`${domain}:${projectId}:${session.financialProfileId}`)
        if (domain === 'financial')
          return [{ amount: '10.50', profileId: session.financialProfileId }]
        return Array.from({ length: 3 }, (_, index) => ({
          id: `${domain}-${index}`,
          projectId
        }))
      },
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
      searchMemory: () => [],
      readMemory: () => null,
      touchMemory: () => {},
      memoriesForConflict: () => [],
      searchConversations: () => [],
      readConversation: () => null,
      saveMemory: async () => ({ ok: false }),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'data-token',
      runId: 'run-data',
      projectId: 'project-1',
      financialProfileId: 'profile-1',
      permissions: MCP_PERMISSIONS,
      expiresAt: Date.now() + 10_000
    })
    const call = (name: string, arguments_: object, id: number) =>
      request(broker.port(), {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { token: 'data-token', name, arguments: arguments_ }
      })
    const tasks = await call('read_tasks', { offset: 1, limit: 1, projectId: 'forged' }, 28)
    const taskPage = JSON.parse(
      (tasks.result as { content: { text: string }[] }).content[0].text
    ) as { total: number; items: { projectId: string }[]; nextOffset: number }
    expect(taskPage).toMatchObject({ total: 3, nextOffset: 2 })
    expect(taskPage.items[0].projectId).toBe('forged')
    const financial = await call('read_financial_data', {}, 29)
    const financialPage = JSON.parse(
      (financial.result as { content: { text: string }[] }).content[0].text
    ) as { items: { amount: string }[] }
    expect(financialPage.items[0].amount).toBe('10.50')
    for (const name of ['read_project', 'read_notes', 'read_goals']) await call(name, {}, 30)
    expect(calls).toContain('tasks:forged:profile-1')
    expect(calls).toContain('financial:project-1:profile-1')
    expect(calls).toContain('project:project-1:profile-1')
    expect(calls).toContain('notes:project-1:profile-1')
    expect(calls).toContain('goals:project-1:profile-1')
  })
})
