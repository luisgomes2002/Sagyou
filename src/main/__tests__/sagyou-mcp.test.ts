// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { connect, type Socket } from 'net'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { MCP_STDIO_BRIDGE_SOURCE, startSagyouMcpBroker } from '../sagyou-mcp'

const servers: { close: () => void }[] = []

afterEach(() => {
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

describe('Sagyou MCP broker', () => {
  it('requires a scoped temporary token and never exposes another project', async () => {
    const broker = startSagyouMcpBroker({
      readTasks: (projectId) => [{ projectId }],
      readFinancial: () => [],
      readProjectData: () => ({}),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'one-run',
      runId: 'run-1',
      projectId: 'project-1',
      financialProfileId: 'personal',
      expiresAt: Date.now() + 10_000
    })

    const reply = await request(broker.port(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { token: 'one-run', name: 'ler_tasks', arguments: { projectId: 'other' } }
    })

    expect(JSON.stringify(reply)).toContain('project-1')
    expect(JSON.stringify(reply)).not.toContain('other')
  })

  it('rejects missing and expired capabilities before invoking a tool', async () => {
    let reads = 0
    const broker = startSagyouMcpBroker({
      readTasks: () => {
        reads += 1
        return []
      },
      readFinancial: () => [],
      readProjectData: () => ({}),
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'expired',
      runId: 'run-1',
      projectId: 'project-1',
      financialProfileId: 'personal',
      expiresAt: Date.now() - 1
    })

    const [withoutToken, expired] = await Promise.all([
      request(broker.port(), {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'ler_tasks' }
      }),
      request(broker.port(), {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { token: 'expired', name: 'ler_tasks' }
      })
    ])

    expect(withoutToken.error).toBeTruthy()
    expect(expired.error).toBeTruthy()
    expect(reads).toBe(0)
  })

  it('routes a write through the granted run rather than caller-supplied scope', async () => {
    let received: {
      runId: string
      projectId: string | null
      args: Record<string, unknown>
    } | null = null
    const broker = startSagyouMcpBroker({
      readTasks: () => [],
      readFinancial: () => [],
      readProjectData: () => ({}),
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
      createTask: async () => ({ ok: true })
    })
    servers.push(broker.server)
    await new Promise<void>((resolve) => broker.server.once('listening', resolve))
    broker.grant({
      token: 'bridge-token',
      runId: 'run-bridge',
      projectId: 'bridge-project',
      financialProfileId: 'personal',
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
})
