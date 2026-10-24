// @vitest-environment node

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { connect } from 'net'
import { tmpdir } from 'os'
import { isAbsolute, join, relative } from 'path'
import { promisify } from 'util'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionRegistry } from '../modules/agent/agent-session'
import { AgentWorktreeManager } from '../modules/agent/agent-worktree'
import { collectAgentPatch, validatePatchScope } from '../modules/agent/agent-diff'
import { deliverApprovedPatch, type DeliveryCoordinator } from '../modules/agent/agent-delivery'
import { prepareAgentMcpSession } from '../modules/agent/agent-mcp-session'
import { McpWriteQueue } from '../modules/agent/mcp-write-queue'
import {
  MCP_PERMISSIONS,
  startSagyouMcpBroker,
  type McpBrokerDeps,
  type McpSession
} from '../modules/agent/sagyou-mcp'

/**
 * Security gaps not covered by sagyou-mcp / agent-infrastructure tests. Everything
 * here runs on fake broker dependencies and throwaway git repos in the OS temp dir:
 * no SQLite file, no userData, no real Sagyou record is ever read.
 */

const execFileAsync = promisify(execFile)
const made: string[] = []
const servers: { close: () => void }[] = []
let sequence = 0

afterEach(() => {
  while (servers.length) servers.pop()?.close()
})

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true })
})

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', dir, ...args], { windowsHide: true })
}

async function newRepo(commit: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sagyou-sec-'))
  made.push(dir)
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await writeFile(join(dir, 'tracked.txt'), 'before\n')
  if (commit) {
    await git(dir, ['add', 'tracked.txt'])
    await git(dir, ['commit', '-qm', 'base'])
  }
  return dir
}

const coordinator: DeliveryCoordinator = {
  hasDirectRun: () => false,
  waitForDirectRun: async () => false,
  deliver: async (_dir, action) => action()
}

function runId(prefix: string): string {
  sequence += 1
  return `${prefix}-${process.pid}-${Date.now()}-${sequence}`
}

function newManager(): AgentWorktreeManager {
  return new AgentWorktreeManager(
    new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
  )
}

function brokerDeps(overrides: Partial<McpBrokerDeps> = {}): McpBrokerDeps {
  return {
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
    createTask: async () => ({ ok: true }),
    ...overrides
  }
}

async function startBroker(deps: McpBrokerDeps): Promise<ReturnType<typeof startSagyouMcpBroker>> {
  const broker = startSagyouMcpBroker(deps)
  servers.push(broker.server)
  await new Promise<void>((resolve) => broker.server.once('listening', resolve))
  return broker
}

function sendLine(port: number, line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('error', reject)
    socket.once('connect', () => socket.write(line + '\n'))
    socket.once('data', (chunk) => {
      socket.end()
      resolve(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>)
    })
  })
}

const rpc = (port: number, body: object): Promise<Record<string, unknown>> =>
  sendLine(port, JSON.stringify(body))

function session(token: string, overrides: Partial<McpSession> = {}): McpSession {
  return {
    token,
    runId: `run-${token}`,
    projectId: 'project-a',
    financialProfileId: 'profile-a',
    permissions: MCP_PERMISSIONS,
    expiresAt: Date.now() + 60_000,
    ...overrides
  }
}

describe('MCP broker: malformed messages', () => {
  it('answers every malformed shape with an error, runs no tool and stays alive', async () => {
    const readScopedData = vi.fn(() => [])
    const createTask = vi.fn(async () => ({ ok: true }))
    const broker = await startBroker(brokerDeps({ readScopedData, createTask }))
    broker.grant(session('valid'))

    const lines = [
      'null',
      '42',
      '"text"',
      '[]',
      '{"params":"oops"}',
      '{"method":"tools/call"}',
      '{broken'
    ]
    for (const line of lines) {
      const reply = await sendLine(broker.port(), line)
      expect(reply.error, line).toBeTruthy()
    }

    // A token that is not a string never matches a capability.
    for (const token of [123, { toString: 'valid' }, ['valid'], null]) {
      const reply = await rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { token, name: 'read_tasks', arguments: {} }
      })
      expect(reply.error).toBeTruthy()
    }
    expect(readScopedData).not.toHaveBeenCalled()
    expect(createTask).not.toHaveBeenCalled()

    // The broker still serves a valid session after all of the above.
    const ok = await rpc(broker.port(), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: { token: 'valid' }
    })
    expect(ok.error).toBeUndefined()
  })

  it('rejects an unknown method, a non-string tool name and an unlisted tool', async () => {
    const createTask = vi.fn(async () => ({ ok: true }))
    const broker = await startBroker(brokerDeps({ createTask }))
    broker.grant(session('valid'))

    for (const params of [
      { token: 'valid', name: 42, arguments: {} },
      { token: 'valid', name: 'drop_database', arguments: {} },
      { token: 'valid', name: '__proto__', arguments: {} },
      { token: 'valid', arguments: {} }
    ]) {
      const reply = await rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params
      })
      expect(reply.error).toBeTruthy()
    }
    const method = await rpc(broker.port(), {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { token: 'valid' }
    })
    expect(method.error).toMatchObject({ message: expect.stringMatching(/não suportado/i) })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('does not echo a rejected token or its arguments back to the caller', async () => {
    const broker = await startBroker(brokerDeps())
    const reply = await rpc(broker.port(), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { token: 'super-secret-guess', name: 'read_tasks', arguments: { x: 'leak-me' } }
    })
    expect(JSON.stringify(reply)).not.toContain('super-secret-guess')
    expect(JSON.stringify(reply)).not.toContain('leak-me')
  })
})

describe('MCP broker: profile and project isolation', () => {
  it('resolves the financial profile from the capability, never from arguments', async () => {
    const seen: { profile: string; projectId: unknown }[] = []
    const broker = await startBroker(
      brokerDeps({
        readScopedData: (domain, granted, projectId) => {
          seen.push({ profile: granted.financialProfileId, projectId })
          return domain === 'financial' ? [{ profileId: granted.financialProfileId }] : []
        }
      })
    )
    broker.grant(session('alpha', { financialProfileId: 'profile-alpha', projectId: 'project-a' }))
    broker.grant(session('beta', { financialProfileId: 'profile-beta', projectId: 'project-b' }))

    const read = (token: string, args: object): Promise<Record<string, unknown>> =>
      rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { token, name: 'read_financial_data', arguments: args }
      })

    const a = JSON.stringify(
      await read('alpha', { financialProfileId: 'profile-beta', profileId: 'profile-beta' })
    )
    const b = JSON.stringify(await read('beta', { financialProfileId: 'profile-alpha' }))
    expect(a).toContain('profile-alpha')
    expect(a).not.toContain('profile-beta')
    expect(b).toContain('profile-beta')
    expect(b).not.toContain('profile-alpha')
    expect(seen.map((entry) => entry.profile)).toEqual(['profile-alpha', 'profile-beta'])
  })

  it('defaults a read to the captured project and a general session to every project', async () => {
    const projects: unknown[] = []
    const broker = await startBroker(
      brokerDeps({
        readScopedData: (_domain, _granted, projectId) => {
          projects.push(projectId)
          return []
        }
      })
    )
    broker.grant(session('scoped', { projectId: 'project-a' }))
    broker.grant(session('general', { projectId: null }))
    const read = (token: string): Promise<Record<string, unknown>> =>
      rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { token, name: 'read_tasks', arguments: { projectId: '   ' } }
      })

    await read('scoped')
    await read('general')
    // A blank projectId is not a request for another project.
    expect(projects).toEqual(['project-a', undefined])
  })

  it('does not let one run write through another run capability', async () => {
    const created: string[] = []
    const broker = await startBroker(
      brokerDeps({
        createTask: async (granted) => {
          created.push(granted.runId)
          return { ok: true }
        }
      })
    )
    broker.grant(session('one', { runId: 'run-one' }))
    broker.grant(session('two', { runId: 'run-two', permissions: ['read_tasks'] }))
    const create = (token: string): Promise<Record<string, unknown>> =>
      rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { token, name: 'criar_task', arguments: { title: 'x', runId: 'run-one' } }
      })

    expect((await create('two')).error).toBeTruthy()
    await create('one')
    expect(created).toEqual(['run-one'])
  })
})

describe('MCP write approval and Stop', () => {
  it('returns a refusal to the CLI and persists nothing when the approval is denied', async () => {
    const persisted = vi.fn(async () => ({ ok: true }))
    const queue = new McpWriteQueue(async () => false)
    const broker = await startBroker(
      brokerDeps({
        createTask: async (granted, args) => {
          const outcome = await queue.enqueue(
            { runId: granted.runId, name: 'criar_task', args },
            persisted
          )
          if (!outcome.approved) throw new Error('Escrita MCP recusada.')
          return outcome.value
        }
      })
    )
    broker.grant(session('writer'))

    const reply = await rpc(broker.port(), {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { token: 'writer', name: 'criar_task', arguments: { title: 'x' } }
    })
    expect(reply.error).toMatchObject({ message: 'Escrita MCP recusada.' })
    expect(persisted).not.toHaveBeenCalled()
  })

  it('fails a pending write closed when Stop tears the run down', async () => {
    const persisted = vi.fn(async () => ({ ok: true }))
    const queue = new McpWriteQueue(() => new Promise<boolean>(() => {}))
    const broker = await startBroker(
      brokerDeps({
        createTask: async (granted, args) =>
          (await queue.enqueue({ runId: granted.runId, name: 'criar_task', args }, persisted)).value
      })
    )
    broker.grant(session('writer', { runId: 'run-stop' }))

    const pending = rpc(broker.port(), {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { token: 'writer', name: 'criar_task', arguments: { title: 'x' } }
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    queue.rejectRun('run-stop')
    broker.revoke('writer')

    expect((await pending).error).toBeTruthy()
    expect(persisted).not.toHaveBeenCalled()
  })

  it('stops honouring the token once the prepared session is cleaned up', async () => {
    const broker = await startBroker(brokerDeps({ readScopedData: () => [{ ok: true }] }))
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-sec-mcp-'))
    made.push(dir)
    const prepared = await prepareAgentMcpSession({
      broker,
      token: 'run-token',
      runId: 'run-cleanup',
      projectId: 'project-a',
      financialProfileId: 'profile-a',
      permissions: MCP_PERMISSIONS,
      worktreeDir: dir,
      executor: 'claude-code',
      executable: process.execPath,
      args: [],
      env: {},
      expiresAt: Date.now() + 60_000
    })
    const call = (): Promise<Record<string, unknown>> =>
      rpc(broker.port(), {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { token: 'run-token', name: 'read_tasks', arguments: {} }
      })

    expect((await call()).error).toBeUndefined()
    // The token lives in the environment only: never in args or the config file.
    expect(prepared.args.join(' ')).not.toContain('run-token')
    expect(await readFile(join(dir, '.sagyou-mcp.json'), 'utf8')).not.toContain('run-token')

    await prepared.cleanup()
    expect((await call()).error).toBeTruthy()
    expect(existsSync(join(dir, '.sagyou-mcp-bridge.cjs'))).toBe(false)
  })
})

describe('worktree: traversal and path safety', () => {
  it.each([
    ['parent traversal', '../escape'],
    ['nested traversal', '../../escape'],
    ['backslash traversal', String.raw`..\..\escape`]
  ])('keeps the worktree inside the managed root for a hostile run id (%s)', async (_n, id) => {
    const repo = await newRepo(true)
    const manager = newManager()
    const root = join(tmpdir(), 'sagyou-worktrees')
    // `sagyou-wt-` is prefixed to the id, so traversal either stays inside the
    // root or is refused; it must never land beside or above it.
    const created = await manager.create(repo, id).catch(() => null)
    if (created) {
      const rel = relative(root, created.worktreeDir)
      expect(rel.startsWith('..') || isAbsolute(rel)).toBe(false)
      await manager.remove(created)
    }
    expect(existsSync(join(tmpdir(), 'escape'))).toBe(false)
    expect(existsSync(join(repo, '..', 'escape'))).toBe(false)
  })

  it('refuses to remove a directory outside the managed worktree root', async () => {
    const repo = await newRepo(true)
    await expect(newManager().remove({ originalDir: repo, worktreeDir: repo })).rejects.toThrow(
      /fora da raiz/i
    )
    expect(existsSync(join(repo, 'tracked.txt'))).toBe(true)
  })

  it('never lists or deletes the original tree as an orphan', async () => {
    const repo = await newRepo(true)
    const manager = newManager()
    await manager.removeOrphans(repo)
    expect(existsSync(join(repo, 'tracked.txt'))).toBe(true)
  })

  it('rejects patch paths that traverse out of the checkout, even when allowed-looking', async () => {
    const repo = await newRepo(true)
    const manager = newManager()
    const isolated = await manager.create(repo, runId('traversal'))

    const scope = await validatePatchScope(
      isolated.worktreeDir,
      ['tracked.txt', '../outside.txt', 'sub/../../outside.txt', 'C:/Windows/x', '/etc/passwd'],
      ['tracked.txt', '../outside.txt']
    )
    expect(scope.allowed).toBe(false)
    expect(scope.rejectedPaths.sort()).toEqual(
      ['../outside.txt', 'C:/Windows/x', '/etc/passwd', 'sub/../../outside.txt'].sort()
    )
    await manager.remove(isolated)
  })

  it('refuses to apply a hand-forged patch that writes outside the repository', async () => {
    const repo = await newRepo(true)
    const outside = join(repo, '..', `sagyou-outside-${process.pid}-${Date.now()}.txt`)
    const forged = [
      `diff --git a/../${outside.split(/[\\/]/).pop()} b/../${outside.split(/[\\/]/).pop()}`,
      'new file mode 100644',
      'index 0000000..ce01362',
      '--- /dev/null',
      `+++ b/../${outside.split(/[\\/]/).pop()}`,
      '@@ -0,0 +1 @@',
      '+pwned',
      ''
    ].join('\n')

    await expect(
      deliverApprovedPatch({
        originalDir: repo,
        runId: runId('forged'),
        patch: forged,
        coordinator
      })
    ).rejects.toThrow()
    expect(existsSync(outside)).toBe(false)
    // The temporary patch file is removed even on failure.
    expect(existsSync(join(repo, '.sagyou-wt-patch-forged.diff'))).toBe(false)
  })
})

describe.each([
  ['a repository with a commit', true],
  ['a repository without any commit', false]
])('worktree delivery in %s', (_label, committed) => {
  it('delivers a rename and a binary file, and leaves the user HEAD untouched', async () => {
    const repo = await newRepo(committed)
    const manager = newManager()
    const isolated = await manager.create(repo, runId('rename-binary'))
    await git(isolated.worktreeDir, ['mv', 'tracked.txt', 'renamed.txt'])
    await writeFile(join(isolated.worktreeDir, 'blob.bin'), Buffer.from([0, 255, 1, 0, 2]))

    const changes = await collectAgentPatch(isolated.worktreeDir)
    expect(changes.changedPaths.sort()).toEqual(['blob.bin', 'renamed.txt', 'tracked.txt'])
    await deliverApprovedPatch({
      originalDir: repo,
      runId: runId('deliver'),
      patch: changes.patch,
      coordinator
    })

    expect(existsSync(join(repo, 'renamed.txt'))).toBe(true)
    expect(existsSync(join(repo, 'tracked.txt'))).toBe(false)
    expect(await readFile(join(repo, 'blob.bin'))).toEqual(Buffer.from([0, 255, 1, 0, 2]))
    if (!committed) {
      await expect(
        execFileAsync('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'])
      ).rejects.toThrow()
    }
    await manager.remove(isolated)
  })

  it('keeps the user edit and the original tree intact when the patch conflicts', async () => {
    const repo = await newRepo(committed)
    const manager = newManager()
    const isolated = await manager.create(repo, runId('conflict'))
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'agent version\n')
    await writeFile(join(isolated.worktreeDir, 'extra.txt'), 'agent extra\n')
    const changes = await collectAgentPatch(isolated.worktreeDir)

    await writeFile(join(repo, 'tracked.txt'), 'user version\n')
    await expect(
      deliverApprovedPatch({
        originalDir: repo,
        runId: runId('conflict-deliver'),
        patch: changes.patch,
        coordinator
      })
    ).rejects.toThrow()

    expect((await readFile(join(repo, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'user version\n'
    )
    // The whole patch is refused: the non-conflicting file is not half-applied.
    expect(existsSync(join(repo, 'extra.txt'))).toBe(false)
    await manager.remove(isolated)
  })

  it('removes the worktree on Stop without touching the original tree', async () => {
    const repo = await newRepo(committed)
    const manager = newManager()
    const isolated = await manager.create(repo, runId('stop'))
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'half-done\n')

    await manager.remove(isolated)
    expect(existsSync(isolated.worktreeDir)).toBe(false)
    expect((await readFile(join(repo, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'before\n'
    )
  })
})
