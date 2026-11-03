// @vitest-environment node
//
// The external MCP token: shown once, only its hash on disk, no expiry and
// full access (spec docs/specs/2026-11-03-acesso-remoto.md). Generating a new
// one or revoking must take the old token away at once.
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpExternalStore, externalMcpCommand } from '../modules/agent/mcp-external'
import {
  EXTERNAL_RUN_ID,
  externalApproval,
  tracksRunState
} from '../modules/agent/mcp-external-policy'
import { MCP_APPROVAL_REQUIRED, MCP_NO_APPROVAL } from '../modules/agent/mcp-write-tools'

const DAY = 86400000
const HASH = 'a'.repeat(64)

let dir: string
let file: string
let now: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-'))
  file = join(dir, 'mcp-external.json')
  now = Date.UTC(2026, 10, 3, 12)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const store = (): ReturnType<typeof createMcpExternalStore> =>
  createMcpExternalStore({ file, now: () => now })

const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8'))

/** The 30-day file the 2026-11-02 build wrote, already expired. */
function writeLegacyFile(token?: string): void {
  // Same hashing as the store (SHA-256 hex of the token).
  const hash = token ? createHash('sha256').update(token, 'utf8').digest('hex') : HASH
  writeFileSync(
    file,
    JSON.stringify({
      hash,
      createdAt: now - 40 * DAY,
      expiresAt: now - 10 * DAY,
      lastUsedAt: now - 11 * DAY,
      lastNoticeDay: '2026-10-22',
      projectId: 'p1',
      financialProfileId: 'personal',
      mode: 'read'
    })
  )
}

describe('token MCP externo', () => {
  it('grava só o hash e nunca devolve o token no status', () => {
    const { token, status } = store().create()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(token)
    expect(JSON.stringify(status)).not.toContain(token)
    expect(JSON.stringify(store().status())).not.toContain(JSON.parse(raw).hash)
    expect(status).toEqual({
      state: 'active',
      createdAt: now,
      lastUsedAt: null,
      allowWhileLocked: false
    })
    expect(Object.keys(onDisk()).sort()).toEqual([
      'allowWhileLocked',
      'createdAt',
      'hash',
      'lastUsedAt'
    ])
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('confere o token certo e recusa o errado; não vence', () => {
    const { token } = store().create()
    expect(store().verify(token)).toEqual({ ok: true })
    expect(store().verify(token + 'x')).toEqual({ ok: false, reason: 'invalid' })
    expect(store().verify('')).toEqual({ ok: false, reason: 'invalid' })
    now += 3650 * DAY
    expect(store().verify(token)).toEqual({ ok: true })
    expect(store().status().state).toBe('active')
  })

  it('o arquivo antigo de 30 dias, mesmo vencido, vale como token total e sem prazo', () => {
    const token = 'token-antigo-do-claude-code'
    writeLegacyFile(token)
    expect(store().verify(token)).toEqual({ ok: true })
    expect(store().status()).toEqual({
      state: 'active',
      createdAt: now - 40 * DAY,
      lastUsedAt: now - 11 * DAY,
      allowWhileLocked: false
    })
  })

  it('o primeiro uso reescreve o arquivo antigo só com os campos novos', () => {
    writeLegacyFile()
    store().touch()
    expect(onDisk()).toEqual({
      hash: HASH,
      createdAt: now - 40 * DAY,
      lastUsedAt: now,
      allowWhileLocked: false
    })
  })

  it('gerar sobre o arquivo antigo grava o formato novo', () => {
    writeLegacyFile()
    store().create()
    expect(Object.keys(onDisk()).sort()).toEqual([
      'allowWhileLocked',
      'createdAt',
      'hash',
      'lastUsedAt'
    ])
  })

  it('gerar outro invalida o anterior na hora e mantém "funcionar bloqueado"', () => {
    const s = store()
    const first = s.create()
    s.setAllowWhileLocked(true)
    const second = s.create()
    expect(store().verify(first.token)).toEqual({ ok: false, reason: 'invalid' })
    expect(store().verify(second.token)).toEqual({ ok: true })
    expect(second.status.allowWhileLocked).toBe(true)
    expect(store().allowWhileLocked()).toBe(true)
  })

  it('"funcionar bloqueado" é gravado no arquivo e só existe com token', () => {
    expect(store().setAllowWhileLocked(true)).toEqual({ state: 'none' })
    expect(existsSync(file)).toBe(false)
    expect(store().allowWhileLocked()).toBe(false)
    store().create()
    expect(store().setAllowWhileLocked(true).allowWhileLocked).toBe(true)
    expect(onDisk().allowWhileLocked).toBe(true)
    expect(store().allowWhileLocked()).toBe(true)
    expect(store().setAllowWhileLocked(false).allowWhileLocked).toBe(false)
    expect(store().allowWhileLocked()).toBe(false)
  })

  it('revogar apaga o arquivo', () => {
    const { token } = store().create()
    store().setAllowWhileLocked(true)
    store().revoke()
    expect(existsSync(file)).toBe(false)
    expect(store().verify(token)).toEqual({ ok: false, reason: 'invalid' })
    expect(store().status()).toEqual({ state: 'none' })
    expect(store().allowWhileLocked()).toBe(false)
  })

  it('arquivo ilegível vale como nenhum token', () => {
    writeFileSync(file, '{ quebrado')
    expect(store().status()).toEqual({ state: 'none' })
    expect(store().verify('qualquer')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('último uso é gravado no máximo uma vez por minuto', () => {
    const s = store()
    s.create()
    s.touch()
    expect(s.status().lastUsedAt).toBe(now)
    const first = now
    now += 30000
    s.touch()
    expect(s.status().lastUsedAt).toBe(first)
    now += 30000
    s.touch()
    expect(s.status().lastUsedAt).toBe(now)
  })
})

describe('política do token externo', () => {
  it('o token externo nunca pede cartão', () => {
    for (const name of [...MCP_APPROVAL_REQUIRED, ...MCP_NO_APPROVAL, 'save_memory', 'criar_task'])
      expect([name, externalApproval(EXTERNAL_RUN_ID, name)]).toEqual([name, false])
  })

  it('uma run do Fleet continua com os cartões de antes', () => {
    expect(externalApproval('abc', 'delete_project')).toBe(true)
    expect(externalApproval('abc', 'create_transaction')).toBe(true)
    expect(externalApproval('abc', 'delete_memory')).toBe(true)
    expect(externalApproval('abc', 'save_memory')).toBe(true)
    expect(externalApproval('abc', 'criar_task')).toBe(true)
    expect(externalApproval('abc', 'update_task')).toBe(false)
    expect(externalApproval('abc', 'archive_memory')).toBe(false)
  })

  it('a run externa não guarda cronômetros nem atividade de sessão', () => {
    expect(tracksRunState(EXTERNAL_RUN_ID)).toBe(false)
    expect(tracksRunState('run-do-fleet')).toBe(true)
  })
})

describe('comando do Claude Code', () => {
  it('monta o claude mcp add com a ponte, a porta e o token', () => {
    expect(
      externalMcpCommand('TOKEN', 'C:\\Sagyou\\Sagyou.exe', 'C:\\ud\\bridge.cjs', 'C:\\ud\\port')
    ).toBe(
      'claude mcp add sagyou-externo --scope user -e ELECTRON_RUN_AS_NODE=1 ' +
        '-e SAGYOU_MCP_TOKEN=TOKEN -e SAGYOU_MCP_PORT_FILE="C:\\ud\\port" ' +
        '-- "C:\\Sagyou\\Sagyou.exe" "C:\\ud\\bridge.cjs"'
    )
  })
})
