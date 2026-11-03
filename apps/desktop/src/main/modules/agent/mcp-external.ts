import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'

/**
 * The external MCP token: one at a time, no expiry, full access (spec
 * docs/specs/2026-11-03-acesso-remoto.md). Only its SHA-256 lives on disk, in
 * its own file outside SQLite and every backup; the token itself is shown once
 * and never stored, returned by status() or logged. It lives until it is
 * revoked or replaced on this PC (or the PC is wiped remotely). A deliberate
 * exception to "an MCP capability lives as long as its terminal".
 */

export const MCP_EXTERNAL_FILE = 'mcp-external.json'
export const MCP_EXTERNAL_FILE_DEV = 'mcp-external-dev.json'
const TOUCH_EVERY_MS = 60000

export interface McpExternalStatus {
  state: 'none' | 'active'
  createdAt?: number
  lastUsedAt?: number | null
  /** The external token keeps working while the Sagyou is on its password screen. */
  allowWhileLocked?: boolean
}

interface StoredToken {
  hash: string
  createdAt: number
  lastUsedAt: number | null
  allowWhileLocked: boolean
}

export type McpExternalVerify = { ok: true } | { ok: false; reason: 'invalid' }

export interface McpExternalStore {
  status(): McpExternalStatus
  /** A new token; the previous one stops at once. Keeps "allowWhileLocked". */
  create(): { token: string; status: McpExternalStatus }
  revoke(): void
  verify(token: string): McpExternalVerify
  /** Records a use; written at most once a minute. */
  touch(): void
  allowWhileLocked(): boolean
  /** Without a token nothing is written: the option belongs to the token. */
  setAllowWhileLocked(value: boolean): McpExternalStatus
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * A file the 30-day build wrote (expiresAt, projectId, financialProfileId,
 * mode, lastNoticeDay) is read as is: those fields are ignored, so that token
 * keeps working with no expiry and full access, and they vanish on the next write.
 */
function parse(text: string): StoredToken | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (
      !value ||
      typeof value.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.hash) ||
      typeof value.createdAt !== 'number'
    )
      return null
    return {
      hash: value.hash,
      createdAt: value.createdAt,
      lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : null,
      allowWhileLocked: value.allowWhileLocked === true
    }
  } catch {
    return null
  }
}

export function createMcpExternalStore(deps: {
  file: string
  now: () => number
}): McpExternalStore {
  // This store is the file's only writer, so it is read once and then kept in
  // memory: a local process flooding the broker with bad tokens costs no disk I/O.
  // An unreadable or malformed file reads as "no token": access stays refused.
  let cache: { value: StoredToken | null } | null = null
  const read = (): StoredToken | null => {
    if (cache) return cache.value
    let value: StoredToken | null = null
    try {
      value = existsSync(deps.file) ? parse(readFileSync(deps.file, 'utf8')) : null
    } catch {
      value = null
    }
    cache = { value }
    return value
  }

  const write = (stored: StoredToken): void => {
    const tmp = `${deps.file}.tmp`
    const record: StoredToken = {
      hash: stored.hash,
      createdAt: stored.createdAt,
      lastUsedAt: stored.lastUsedAt,
      allowWhileLocked: stored.allowWhileLocked
    }
    // 0600 holds on POSIX; on Windows the file inherits userData's ACL (only a hash is in it).
    writeFileSync(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, deps.file)
    cache = { value: record }
  }

  const statusOf = (stored: StoredToken | null): McpExternalStatus => {
    if (!stored) return { state: 'none' }
    return {
      state: 'active',
      createdAt: stored.createdAt,
      lastUsedAt: stored.lastUsedAt,
      allowWhileLocked: stored.allowWhileLocked
    }
  }

  // Cached between touches so a busy agent does not rewrite the file per call.
  let lastWrittenUse = 0

  return {
    status: () => statusOf(read()),
    create: () => {
      const token = randomBytes(32).toString('base64url')
      const stored: StoredToken = {
        hash: hashToken(token),
        createdAt: deps.now(),
        lastUsedAt: null,
        allowWhileLocked: read()?.allowWhileLocked ?? false
      }
      write(stored)
      return { token, status: statusOf(stored) }
    },
    revoke: () => {
      rmSync(deps.file, { force: true })
      cache = { value: null }
    },
    verify: (token) => {
      const stored = read()
      if (!stored || typeof token !== 'string' || !token) return { ok: false, reason: 'invalid' }
      const given = Buffer.from(hashToken(token), 'hex')
      const expected = Buffer.from(stored.hash, 'hex')
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return { ok: false, reason: 'invalid' }
      return { ok: true }
    },
    touch: () => {
      const now = deps.now()
      if (now - lastWrittenUse < TOUCH_EVERY_MS) return
      const stored = read()
      if (!stored) return
      lastWrittenUse = now
      // Only informative: a locked file must never fail the MCP call that used the token.
      try {
        write({ ...stored, lastUsedAt: now })
      } catch {
        cache = { value: { ...stored, lastUsedAt: now } }
      }
    },
    allowWhileLocked: () => read()?.allowWhileLocked ?? false,
    setAllowWhileLocked: (value) => {
      const stored = read()
      if (!stored) return statusOf(null)
      write({ ...stored, allowWhileLocked: value })
      return statusOf(read())
    }
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
