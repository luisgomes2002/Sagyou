import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { MCP_STDIO_BRIDGE_SOURCE, type McpSession } from './sagyou-mcp'

export type McpExecutorId = 'codex' | 'opencode' | 'claude-code'

export interface McpCapabilityBroker {
  port(): number
  grant(session: McpSession): void
  revoke(token: string): void
}

export interface PrepareMcpSessionOptions {
  broker: McpCapabilityBroker
  token: string
  runId: string
  projectId: string | null
  financialProfileId: string
  worktreeDir: string
  executor: McpExecutorId
  executable: string
  args: string[]
  env: NodeJS.ProcessEnv
  expiresAt: number
}

export interface PreparedMcpSession {
  args: string[]
  env: NodeJS.ProcessEnv
  cleanup(): Promise<void>
}

/** Grants one scoped capability and injects only its disposable stdio bridge. */
export async function prepareAgentMcpSession(
  options: PrepareMcpSessionOptions
): Promise<PreparedMcpSession> {
  const bridgePath = join(options.worktreeDir, '.sagyou-mcp-bridge.cjs')
  const claudeConfigPath = join(options.worktreeDir, '.sagyou-mcp.json')
  options.broker.grant({
    token: options.token,
    runId: options.runId,
    projectId: options.projectId,
    financialProfileId: options.financialProfileId,
    expiresAt: options.expiresAt
  })
  try {
    await writeFile(bridgePath, MCP_STDIO_BRIDGE_SOURCE, 'utf8')
    await writeFile(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          sagyou: {
            command: options.executable,
            args: [bridgePath],
            env: { ELECTRON_RUN_AS_NODE: '1' }
          }
        }
      }),
      'utf8'
    )
  } catch (error) {
    options.broker.revoke(options.token)
    await Promise.all([bridgePath, claudeConfigPath].map((path) => unlink(path).catch(() => {})))
    throw error
  }

  const args = [...options.args]
  let env: NodeJS.ProcessEnv = {
    ...options.env,
    SAGYOU_MCP_PORT: String(options.broker.port()),
    SAGYOU_MCP_TOKEN: options.token
  }
  if (options.executor === 'claude-code') args.unshift('--mcp-config', claudeConfigPath)
  if (options.executor === 'codex') {
    args.unshift(
      '--config',
      `mcp_servers.sagyou.env={ELECTRON_RUN_AS_NODE="1"}`,
      '--config',
      `mcp_servers.sagyou.args=["${bridgePath.replace(/\\/g, '\\\\')}"]`,
      '--config',
      `mcp_servers.sagyou.command="${options.executable.replace(/\\/g, '\\\\')}"`
    )
  }
  if (options.executor === 'opencode') {
    env = {
      ...env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: {
          servers: {
            sagyou: {
              type: 'local',
              command: [options.executable, bridgePath],
              environment: { ELECTRON_RUN_AS_NODE: '1' },
              codemode: false
            }
          }
        }
      })
    }
  }

  let cleaned = false
  return {
    args,
    env,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      options.broker.revoke(options.token)
      await Promise.all([bridgePath, claudeConfigPath].map((path) => unlink(path).catch(() => {})))
    }
  }
}
