import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'

/**
 * The external MCP token: one at a time, 30 days, renewed by hand. Only its
 * SHA-256 lives on disk, in its own file outside SQLite and every backup;
 * the token itself is shown once and never stored, returned by status() or
 * logged. A deliberate exception to "an MCP capability lives as long as its
 * terminal" (spec docs/specs/2026-11-02-mcp-externo.md).
 */

export const MCP_EXTERNAL_FILE = 'mcp-external.json'
export const MCP_EXTERNAL_FILE_DEV = 'mcp-external-dev.json'
export const EXTERNAL_TOKEN_TTL_MS = 30 * 86400000
const TOUCH_EVERY_MS = 60000
const DAY_MS = 86400000
export const EXPIRY_NOTICE_DAYS = 3

export type McpExternalMode = 'read' | 'read-write'

export interface McpExternalScope {
  projectId: string | null
  financialProfileId: string
  mode: McpExternalMode
}

export interface McpExternalStatus {
  state: 'none' | 'active' | 'expired'
  createdAt?: number
  expiresAt?: number
  lastUsedAt?: number | null
  scope?: McpExternalScope
}

interface StoredToken extends McpExternalScope {
  hash: string
  createdAt: number
  expiresAt: number
  lastUsedAt: number | null
  lastNoticeDay: string | null
}

export type McpExternalVerify =
  | { ok: true; scope: McpExternalScope }
  | { ok: false; reason: 'invalid' | 'expired' }

export interface McpExternalStore {
  status(): McpExternalStatus
  create(scope: McpExternalScope): { token: string; status: McpExternalStatus }
  renew(): { token: string; status: McpExternalStatus } | null
  revoke(): void
  verify(token: string): McpExternalVerify
  /** Records a use; written at most once a minute. */
  touch(): void
  expiresAt(): number | null
  lastNoticeDay(): string | null
  markNoticed(day: string): void
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function isScope(value: Record<string, unknown>): boolean {
  return (
    (value.projectId === null || typeof value.projectId === 'string') &&
    typeof value.financialProfileId === 'string' &&
    (value.mode === 'read' || value.mode === 'read-write')
  )
}

function parse(text: string): StoredToken | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (
      !value ||
      typeof value.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.hash) ||
      typeof value.createdAt !== 'number' ||
      typeof value.expiresAt !== 'number' ||
      !isScope(value)
    )
      return null
    return {
      hash: value.hash,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : null,
      lastNoticeDay: typeof value.lastNoticeDay === 'string' ? value.lastNoticeDay : null,
      projectId: (value.projectId as string | null) ?? null,
      financialProfileId: value.financialProfileId as string,
      mode: value.mode as McpExternalMode
    }
  } catch {
    return null
  }
}

export function createMcpExternalStore(deps: {
  file: string
  now: () => number
}): McpExternalStore {
  // An unreadable or malformed file reads as "no token": access stays refused.
  const read = (): StoredToken | null => {
    try {
      return existsSync(deps.file) ? parse(readFileSync(deps.file, 'utf8')) : null
    } catch {
      return null
    }
  }

  const write = (stored: StoredToken): void => {
    const tmp = `${deps.file}.tmp`
    writeFileSync(tmp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, deps.file)
  }

  const statusOf = (stored: StoredToken | null): McpExternalStatus => {
    if (!stored) return { state: 'none' }
    return {
      state: stored.expiresAt > deps.now() ? 'active' : 'expired',
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
      lastUsedAt: stored.lastUsedAt,
      scope: {
        projectId: stored.projectId,
        financialProfileId: stored.financialProfileId,
        mode: stored.mode
      }
    }
  }

  const issue = (scope: McpExternalScope): { token: string; status: McpExternalStatus } => {
    const token = randomBytes(32).toString('base64url')
    const now = deps.now()
    const stored: StoredToken = {
      hash: hashToken(token),
      createdAt: now,
      expiresAt: now + EXTERNAL_TOKEN_TTL_MS,
      lastUsedAt: null,
      lastNoticeDay: null,
      projectId: scope.projectId,
      financialProfileId: scope.financialProfileId,
      mode: scope.mode
    }
    write(stored)
    return { token, status: statusOf(stored) }
  }

  // Cached between touches so a busy agent does not rewrite the file per call.
  let lastWrittenUse = 0

  return {
    status: () => statusOf(read()),
    create: (scope) => issue(scope),
    renew: () => {
      const stored = read()
      if (!stored) return null
      return issue({
        projectId: stored.projectId,
        financialProfileId: stored.financialProfileId,
        mode: stored.mode
      })
    },
    revoke: () => {
      rmSync(deps.file, { force: true })
    },
    verify: (token) => {
      const stored = read()
      if (!stored || typeof token !== 'string' || !token) return { ok: false, reason: 'invalid' }
      const given = Buffer.from(hashToken(token), 'hex')
      const expected = Buffer.from(stored.hash, 'hex')
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return { ok: false, reason: 'invalid' }
      if (stored.expiresAt <= deps.now()) return { ok: false, reason: 'expired' }
      return {
        ok: true,
        scope: {
          projectId: stored.projectId,
          financialProfileId: stored.financialProfileId,
          mode: stored.mode
        }
      }
    },
    touch: () => {
      const now = deps.now()
      if (now - lastWrittenUse < TOUCH_EVERY_MS) return
      const stored = read()
      if (!stored) return
      lastWrittenUse = now
      write({ ...stored, lastUsedAt: now })
    },
    expiresAt: () => read()?.expiresAt ?? null,
    lastNoticeDay: () => read()?.lastNoticeDay ?? null,
    markNoticed: (day) => {
      const stored = read()
      if (stored) write({ ...stored, lastNoticeDay: day })
    }
  }
}

function localDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The tray/system notice when the token is about to expire; at most once a day. */
export function expiryNotice(
  now: number,
  expiresAt: number,
  lastNoticeDay: string | null
): { text: string; day: string } | null {
  const left = expiresAt - now
  if (left <= 0 || left > EXPIRY_NOTICE_DAYS * DAY_MS) return null
  const day = localDay(now)
  if (lastNoticeDay === day) return null
  const days = Math.floor(left / DAY_MS)
  const when = days === 0 ? 'vence hoje' : days === 1 ? 'vence em 1 dia' : `vence em ${days} dias`
  return {
    text: `O acesso MCP externo ${when}. Renove em Configurações → Acesso MCP externo.`,
    day
  }
}

const quote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`

/** The command shown once, with the token, for Claude Code's user scope. */
export function externalMcpCommand(
  token: string,
  execPath: string,
  bridgePath: string,
  portFile: string
): string {
  return (
    `claude mcp add sagyou-externo --scope user -e ELECTRON_RUN_AS_NODE=1 ` +
    `-e SAGYOU_MCP_TOKEN=${token} -e SAGYOU_MCP_PORT_FILE=${quote(portFile)} ` +
    `-- ${quote(execPath)} ${quote(bridgePath)}`
  )
}
