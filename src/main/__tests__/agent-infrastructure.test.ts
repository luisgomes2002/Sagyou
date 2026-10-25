// @vitest-environment node

import { execFile, spawn } from 'child_process'
import { once } from 'events'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { isAbsolute, join, relative } from 'path'
import { promisify } from 'util'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AgentSessionRegistry } from '../modules/agent/agent-session'
import {
  isAgentTerminalInput,
  isAgentTerminalSize,
  startAgentPty,
  type AgentPtySpawner
} from '../modules/agent/agent-pty'
import { AgentWorktreeManager } from '../modules/agent/agent-worktree'
import { collectAgentPatch, patchWithinScope, validatePatchScope } from '../modules/agent/agent-diff'
import { deliverApprovedPatch, type DeliveryCoordinator } from '../modules/agent/agent-delivery'
import { prepareAgentMcpSession } from '../modules/agent/agent-mcp-session'
import { MCP_PERMISSIONS, type McpSession } from '../modules/agent/sagyou-mcp'

const execFileAsync = promisify(execFile)
const made: string[] = []
let worktreeSequence = 0

function worktreeRunId(prefix: string): string {
  worktreeSequence += 1
  return `${prefix}-${process.pid}-${Date.now()}-${worktreeSequence}`
}

async function git(dir: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', dir, ...args], { windowsHide: true })
}

async function newRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sagyou-agent-infra-'))
  made.push(dir)
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await writeFile(join(dir, 'tracked.txt'), 'before\n')
  await git(dir, ['add', 'tracked.txt'])
  await git(dir, ['commit', '-qm', 'base'])
  return dir
}

async function newUnbornRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sagyou-agent-unborn-'))
  made.push(dir)
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await writeFile(join(dir, 'draft.txt'), 'local and unstaged\n')
  return dir
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true })
})

describe('agent infrastructure', () => {
  it('owns run and reserved-worktree lifetime independently of an executor', () => {
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    sessions.reserveWorktree('/tmp/project/.sagyou-wt-one')
    expect(sessions.protectedWorktrees().size).toBe(1)

    sessions.register({ id: 'one', worktreeDir: '/tmp/project/.sagyou-wt-one' })
    expect(sessions.runs.has('one')).toBe(true)
    expect(sessions.reservedWorktrees.size).toBe(0)
    expect(sessions.protectedWorktrees().size).toBe(1)

    expect(sessions.remove('one')?.id).toBe('one')
    expect(sessions.protectedWorktrees().size).toBe(0)
  })

  it('keeps concurrent terminal session state until each session is explicitly closed', () => {
    const sessions = new AgentSessionRegistry<{
      id: string
      worktreeDir: string | null
      pid: number
      log: string
      cols: number
      rows: number
    }>()
    sessions.register({
      id: 'one',
      worktreeDir: '/wt/one',
      pid: 101,
      log: 'first',
      cols: 120,
      rows: 40
    })
    sessions.register({
      id: 'two',
      worktreeDir: '/wt/two',
      pid: 202,
      log: 'second',
      cols: 100,
      rows: 30
    })

    expect(sessions.runs.get('one')).toMatchObject({ pid: 101, log: 'first', cols: 120, rows: 40 })
    expect(sessions.runs.get('two')).toMatchObject({ pid: 202, log: 'second' })
    expect(sessions.remove('one')?.pid).toBe(101)
    expect(sessions.runs.has('one')).toBe(false)
    expect(sessions.runs.get('two')?.pid).toBe(202)
  })

  it('keeps project, code root, conversation and financial scopes independent per run', () => {
    const sessions = new AgentSessionRegistry<{
      id: string
      worktreeDir: string | null
      projectId: string
      conversationId: string
      codeRoot: string
      financialProfileId: string
    }>()
    sessions.register({
      id: 'a',
      worktreeDir: '/wt/a',
      projectId: 'project-a',
      conversationId: 'conversation-a',
      codeRoot: '/projects/a',
      financialProfileId: 'personal'
    })
    sessions.register({
      id: 'b',
      worktreeDir: '/wt/b',
      projectId: 'project-b',
      conversationId: 'conversation-b',
      codeRoot: '/projects/b',
      financialProfileId: 'business'
    })

    expect(sessions.runs.get('a')).toMatchObject({
      projectId: 'project-a',
      codeRoot: '/projects/a'
    })
    expect(sessions.runs.get('b')).toMatchObject({
      projectId: 'project-b',
      conversationId: 'conversation-b',
      financialProfileId: 'business'
    })
  })

  it('wires interactive PTY events through the extracted terminal contract', () => {
    let onData!: (value: string) => void
    let onExit!: (event: { exitCode: number; signal?: number }) => void
    const write = vi.fn()
    const resize = vi.fn()
    const kill = vi.fn()
    const spawner: AgentPtySpawner = vi.fn(
      () =>
        ({
          write,
          resize,
          kill,
          onData: (listener: (value: string) => void) => {
            onData = listener
            return { dispose: () => {} }
          },
          onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
            onExit = listener
            return { dispose: () => {} }
          }
        }) as unknown as ReturnType<AgentPtySpawner>
    )
    const data = vi.fn()
    const exit = vi.fn()

    const terminal = startAgentPty(
      { command: 'codex', args: ['task'], cwd: '/project', env: {}, onData: data, onExit: exit },
      spawner
    )
    onData('\u001b[2Jcursor\r\n')
    onExit({ exitCode: 7 })
    terminal.write('\u0003\u001b[200~paste\r\n\u001b[201~')
    terminal.resize(120, 40)

    expect(spawner).toHaveBeenCalledWith(
      'codex',
      ['task'],
      expect.objectContaining({ name: 'xterm-256color', cols: 100, rows: 30, cwd: '/project' })
    )
    expect(data).toHaveBeenCalledWith('\u001b[2Jcursor\r\n')
    expect(exit).toHaveBeenCalledWith(7)
    expect(write).toHaveBeenCalledWith('\u0003\u001b[200~paste\r\n\u001b[201~')
    expect(resize).toHaveBeenCalledWith(120, 40)
  })

  it('accepts raw terminal control input but bounds the restricted IPC payload', () => {
    expect(isAgentTerminalInput('\u0003')).toBe(true)
    expect(isAgentTerminalInput('\u001b[A')).toBe(true)
    expect(isAgentTerminalInput('\u001b[200~multi\r\nline\u001b[201~')).toBe(true)
    expect(isAgentTerminalInput('')).toBe(false)
    expect(isAgentTerminalInput('x'.repeat(8_001))).toBe(false)
    expect(isAgentTerminalInput({ write: 'shell command' })).toBe(false)

    expect(isAgentTerminalSize(120, 40)).toBe(true)
    expect(isAgentTerminalSize(19, 40)).toBe(false)
    expect(isAgentTerminalSize(120, 4)).toBe(false)
    expect(isAgentTerminalSize(120.5, 40)).toBe(false)
  })

  it('creates a worktree, captures its complete patch and delivers it serially', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const runId = worktreeRunId('run-one')
    const isolated = await worktrees.create(originalDir, runId)
    expect(isAbsolute(isolated.worktreeDir)).toBe(true)
    expect(relative(originalDir, isolated.worktreeDir).startsWith('..')).toBe(true)
    expect(existsSync(join(originalDir, `.sagyou-wt-${runId}`))).toBe(false)
    sessions.register({ id: runId, worktreeDir: isolated.worktreeDir })
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'after\n')
    await writeFile(join(isolated.worktreeDir, 'new.txt'), 'new\n')

    const changes = await collectAgentPatch(isolated.worktreeDir)
    expect(changes.changedPaths.sort()).toEqual(['new.txt', 'tracked.txt'])
    expect(changes.patch).toContain('after')
    expect(changes.patch).toContain('new.txt')
    expect(patchWithinScope(changes.changedPaths, ['tracked.txt'])).toBe(false)
    expect(patchWithinScope(changes.changedPaths, ['tracked.txt', 'new.txt'])).toBe(true)
    // A completed diff is still review material: no original file changes until
    // the explicit delivery operation below is called.
    expect((await readFile(join(originalDir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'before\n'
    )
    expect(existsSync(isolated.worktreeDir)).toBe(true)

    const coordinator: DeliveryCoordinator = {
      hasDirectRun: () => false,
      waitForDirectRun: async () => false,
      deliver: async (_dir, action) => action()
    }
    await deliverApprovedPatch({
      originalDir,
      runId,
      patch: changes.patch,
      coordinator
    })
    expect((await readFile(join(originalDir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'after\n'
    )
    expect((await readFile(join(originalDir, 'new.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'new\n'
    )

    // Delivery preserves the review artifact; lifecycle cleanup happens only
    // after the caller records the finished run.
    expect(existsSync(isolated.worktreeDir)).toBe(true)
    sessions.remove(runId)
    await worktrees.remove(isolated)
    expect(existsSync(isolated.worktreeDir)).toBe(false)
  })

  it('delivers binary patches and rejects a patch after a local conflicting edit', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const runId = worktreeRunId('binary-conflict')
    const isolated = await worktrees.create(originalDir, runId)
    await writeFile(join(isolated.worktreeDir, 'image.bin'), Buffer.from([0, 1, 2, 0, 255]))
    const binaryChanges = await collectAgentPatch(isolated.worktreeDir)
    const coordinator: DeliveryCoordinator = {
      hasDirectRun: () => false,
      waitForDirectRun: async () => false,
      deliver: async (_dir, action) => action()
    }
    await deliverApprovedPatch({
      originalDir,
      runId,
      patch: binaryChanges.patch,
      coordinator
    })
    expect(await readFile(join(originalDir, 'image.bin'))).toEqual(Buffer.from([0, 1, 2, 0, 255]))

    await rm(join(isolated.worktreeDir, 'image.bin'))
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'agent version\n')
    const conflictingChanges = await collectAgentPatch(isolated.worktreeDir)
    await writeFile(join(originalDir, 'tracked.txt'), 'user version\n')
    await expect(
      deliverApprovedPatch({
        originalDir,
        runId,
        patch: conflictingChanges.patch,
        coordinator
      })
    ).rejects.toThrow()
    expect((await readFile(join(originalDir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'user version\n'
    )

    await worktrees.remove(isolated)
  })

  it('builds the final patch from the run base even when the executor committed', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const isolated = await worktrees.create(originalDir, worktreeRunId('committed-change'))
    const { stdout: base } = await execFileAsync('git', [
      '-C',
      isolated.worktreeDir,
      'rev-parse',
      'HEAD'
    ])
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'committed by executor\n')
    await git(isolated.worktreeDir, ['add', 'tracked.txt'])
    await git(isolated.worktreeDir, ['commit', '-qm', 'executor change'])

    expect((await collectAgentPatch(isolated.worktreeDir)).patch).toBe('')
    expect((await collectAgentPatch(isolated.worktreeDir, { base: base.trim() })).patch).toContain(
      'committed by executor'
    )

    await worktrees.remove(isolated)
  })

  it('reports both source and destination when a worktree rename crosses scope', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const isolated = await worktrees.create(originalDir, worktreeRunId('rename-scope'))
    await git(isolated.worktreeDir, ['mv', 'tracked.txt', 'renamed.txt'])

    const changes = await collectAgentPatch(isolated.worktreeDir)
    expect(changes.changedPaths.sort()).toEqual(['renamed.txt', 'tracked.txt'])
    expect(patchWithinScope(changes.changedPaths, ['renamed.txt'])).toBe(false)

    await worktrees.remove(isolated)
  })

  it('blocks an entire mixed-scope review batch before it can reach the original repository', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const isolated = await worktrees.create(originalDir, worktreeRunId('mixed-scope'))
    await writeFile(join(isolated.worktreeDir, 'tracked.txt'), 'allowed change\n')
    await writeFile(join(isolated.worktreeDir, 'private.txt'), 'outside scope\n')

    const changes = await collectAgentPatch(isolated.worktreeDir)
    const scope = await validatePatchScope(isolated.worktreeDir, changes.changedPaths, [
      'tracked.txt'
    ])
    expect(scope).toEqual({ allowed: false, rejectedPaths: ['private.txt'] })
    // Validation happens before final approval/delivery. Refusing one path must
    // refuse the whole patch, including the otherwise permitted tracked change.
    expect((await readFile(join(originalDir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'before\n'
    )
    expect(existsSync(join(originalDir, 'private.txt'))).toBe(false)
    expect(existsSync(isolated.worktreeDir)).toBe(true)

    await worktrees.remove(isolated)
    expect(existsSync(isolated.worktreeDir)).toBe(false)
  })

  it('creates an isolated snapshot for an unborn repository without changing its index or HEAD', async () => {
    const originalDir = await newUnbornRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const runId = worktreeRunId('unborn')
    const isolated = await worktrees.create(originalDir, runId)
    sessions.register({ id: runId, worktreeDir: isolated.worktreeDir })

    expect(
      (await readFile(join(isolated.worktreeDir, 'draft.txt'), 'utf8')).replace(/\r\n/g, '\n')
    ).toBe('local and unstaged\n')
    expect((await readFile(join(originalDir, 'draft.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'local and unstaged\n'
    )
    await writeFile(join(isolated.worktreeDir, 'only-in-worktree.txt'), 'isolated\n')
    expect(existsSync(join(originalDir, 'only-in-worktree.txt'))).toBe(false)

    sessions.remove(runId)
    await worktrees.remove(isolated)
  })

  it('initializes a code folder without Git so it can run concurrent isolated sessions', async () => {
    const originalDir = await mkdtemp(join(tmpdir(), 'sagyou-agent-no-git-'))
    made.push(originalDir)
    await writeFile(join(originalDir, 'draft.txt'), 'keep this file\n')
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)

    const [first, second] = await Promise.all([
      worktrees.create(originalDir, worktreeRunId('plain-one')),
      worktrees.create(originalDir, worktreeRunId('plain-two'))
    ])

    expect(existsSync(join(originalDir, '.git'))).toBe(true)
    expect(await readFile(join(originalDir, 'draft.txt'), 'utf8')).toBe('keep this file\n')
    expect(first.worktreeDir).not.toBe(second.worktreeDir)
    expect((await readFile(join(first.worktreeDir, 'draft.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'keep this file\n'
    )
    expect((await readFile(join(second.worktreeDir, 'draft.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'keep this file\n'
    )

    await worktrees.remove(first)
    await worktrees.remove(second)
  })

  it('gives concurrent runs distinct detached worktrees and cleans an orphan after interruption', async () => {
    const originalDir = await newRepo()
    const sessions = new AgentSessionRegistry<{ id: string; worktreeDir: string | null }>()
    const worktrees = new AgentWorktreeManager(sessions)
    const [first, second] = await Promise.all([
      worktrees.create(originalDir, worktreeRunId('parallel-one')),
      worktrees.create(originalDir, worktreeRunId('parallel-two'))
    ])
    expect(first.worktreeDir).not.toBe(second.worktreeDir)
    expect(existsSync(first.worktreeDir)).toBe(true)
    expect(existsSync(second.worktreeDir)).toBe(true)

    sessions.register({ id: 'parallel-one', worktreeDir: first.worktreeDir })
    sessions.register({ id: 'parallel-two', worktreeDir: second.worktreeDir })
    // Simulate a crashed process: it released neither worktree through normal finish.
    sessions.remove('parallel-one')
    sessions.remove('parallel-two')
    await worktrees.removeOrphans(originalDir)
    expect(existsSync(first.worktreeDir)).toBe(false)
    expect(existsSync(second.worktreeDir)).toBe(false)
  })

  it('grants and revokes a scoped MCP bridge with executor-specific arguments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-agent-mcp-'))
    made.push(dir)
    const granted: McpSession[] = []
    const revoked: string[] = []
    const prepared = await prepareAgentMcpSession({
      broker: {
        port: () => 4567,
        grant: (session) => granted.push(session),
        revoke: (token) => revoked.push(token)
      },
      token: 'secret',
      runId: 'run-mcp',
      projectId: 'project-one',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      worktreeDir: dir,
      executor: 'codex',
      executable: process.execPath,
      args: ['task'],
      env: {},
      expiresAt: 12345
    })

    expect(granted).toEqual([
      {
        token: 'secret',
        runId: 'run-mcp',
        projectId: 'project-one',
        financialProfileId: 'personal',
        permissions: MCP_PERMISSIONS,
        expiresAt: 12345
      }
    ])
    expect(prepared.env).toMatchObject({ SAGYOU_MCP_PORT: '4567', SAGYOU_MCP_TOKEN: 'secret' })
    expect(prepared.args.join(' ')).toContain('mcp_servers.sagyou.command')
    expect(prepared.args).toContain(
      'mcp_servers.sagyou.env_vars=["SAGYOU_MCP_PORT","SAGYOU_MCP_TOKEN"]'
    )
    expect(prepared.args).toContain('mcp_servers.sagyou.required=true')
    expect(prepared.args).toContain('mcp_servers.sagyou.enabled=true')
    expect(prepared.args.join(' ')).not.toContain('secret')
    expect(existsSync(join(dir, '.sagyou-mcp-bridge.cjs'))).toBe(true)

    await prepared.cleanup()
    await prepared.cleanup()
    expect(revoked).toEqual(['secret'])
    expect(existsSync(join(dir, '.sagyou-mcp-bridge.cjs'))).toBe(false)
    expect(existsSync(join(dir, '.sagyou-mcp.json'))).toBe(false)
  })

  it('connects the disposable stdio bridge to loopback without exposing its token', async () => {
    const token = 'test-capability'
    let authorized = false
    const server = createServer((socket) => {
      socket.on('error', () => {})
      let input = ''
      socket.on('data', (chunk) => {
        input += chunk.toString('utf8')
        const lines = input.split('\n')
        input = lines.pop() ?? ''
        for (const line of lines) {
          const request = JSON.parse(line) as {
            id: number
            params: { token?: string }
          }
          authorized = request.params.token === token
          socket.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'Sagyou', version: '1' }
              }
            }) + '\n'
          )
        }
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-mcp-bridge-'))
    made.push(dir)
    const prepared = await prepareAgentMcpSession({
      broker: {
        port: () => (server.address() as { port: number }).port,
        grant: () => {},
        revoke: () => {}
      },
      token,
      runId: 'run-bridge',
      projectId: 'project-one',
      financialProfileId: 'personal',
      permissions: MCP_PERMISSIONS,
      worktreeDir: dir,
      executor: 'codex',
      executable: process.execPath,
      args: [],
      env: process.env,
      expiresAt: Date.now() + 60_000
    })
    const bridge = spawn(process.execPath, [join(dir, '.sagyou-mcp-bridge.cjs')], {
      env: prepared.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    try {
      const response = new Promise<string>((resolve, reject) => {
        let output = ''
        bridge.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8')
          if (output.includes('\n')) resolve(output.split('\n')[0])
        })
        bridge.once('exit', () => reject(new Error('MCP bridge exited before initialize')))
      })
      bridge.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
        }) + '\n'
      )
      const line = await Promise.race([
        response,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('MCP bridge did not answer')), 3_000)
        )
      ])
      expect(authorized).toBe(true)
      expect(JSON.parse(line).result.serverInfo.name).toBe('Sagyou')
      expect(line).not.toContain(token)
    } finally {
      bridge.kill()
      await prepared.cleanup()
      server.close()
    }
  })
})
