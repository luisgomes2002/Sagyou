// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { buildHarnessLaunch, discoverHarnesses } from '../modules/agent/harness-adapter'

describe('harness adapter', () => {
  it('discovers only known binaries and reports unknown capabilities without inventing models', async () => {
    const command = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === '--version') return { code: 0, stdout: '1.2.3\n', stderr: '' }
      return { code: 0, stdout: 'logged in', stderr: '' }
    })
    const executable = (name: string): string | null =>
      name === 'codex' ? '/tools/codex' : name === 'opencode' ? '/tools/opencode' : null

    const statuses = await discoverHarnesses(command, executable)

    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          installed: true,
          authentication: 'authenticated',
          models: [],
          capabilities: expect.objectContaining({ mcp: 'available', modelStatus: 'unknown' })
        }),
        expect.objectContaining({
          id: 'claude-code',
          installed: false,
          path: null,
          capabilities: expect.objectContaining({ createSession: 'unavailable' })
        }),
        expect.objectContaining({ id: 'opencode', installed: true, authentication: 'unknown' })
      ])
    )
    expect(command).toHaveBeenCalledWith('/tools/codex', ['login', 'status'])
    expect(command).not.toHaveBeenCalledWith('/tools/opencode', expect.arrayContaining(['login']))
  })

  it('launches a blank session without a prompt argument', () => {
    expect(buildHarnessLaunch('codex', '', '/work').args.at(-1)).toBe('on-request')
    expect(buildHarnessLaunch('claude-code', '', '/work').args).toEqual(['--permission-mode', 'manual'])
    expect(buildHarnessLaunch('opencode', '', '/work').args).toEqual([])
  })

  it('keeps executable choice and permission arguments inside the adapter', () => {
    expect(buildHarnessLaunch('codex', 'fix it', '/work')).toMatchObject({
      label: 'Codex',
      args: expect.arrayContaining(['--cd', '/work', '--sandbox', 'workspace-write', 'fix it'])
    })
    expect(buildHarnessLaunch('claude-code', 'fix it', '/work')).toEqual({
      label: 'Claude Code',
      args: ['--permission-mode', 'manual', 'fix it']
    })
    expect(buildHarnessLaunch('opencode', 'fix it', '/work')).toEqual({
      label: 'OpenCode',
      args: ['--prompt', 'fix it']
    })
  })
})
