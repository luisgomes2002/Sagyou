// @vitest-environment node
//
// The external MCP token: shown once, only its hash on disk, 30 days, renewed
// by hand. Renewing or revoking must take the old token away at once.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXTERNAL_TOKEN_TTL_MS,
  createMcpExternalStore,
  expiryNotice,
  externalMcpCommand,
  type McpExternalScope
} from '../modules/agent/mcp-external'
import {
  EXTERNAL_RUN_ID,
  externalSkipsCard,
  isExternalRisky,
  tracksRunState
} from '../modules/agent/mcp-external-policy'
import { MCP_APPROVAL_REQUIRED } from '../modules/agent/mcp-write-tools'

const DAY = 86400000
const SCOPE: McpExternalScope = { projectId: 'p1', financialProfileId: 'personal', mode: 'read' }

let dir: string
let file: string
let now: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-'))
  file = join(dir, 'mcp-external.json')
  now = Date.UTC(2026, 10, 2, 12)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const store = (): ReturnType<typeof createMcpExternalStore> =>
  createMcpExternalStore({ file, now: () => now })

describe('token MCP externo', () => {
  it('grava só o hash e nunca devolve o token no status', () => {
    const { token, status } = store().create(SCOPE)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(token)
    expect(JSON.stringify(status)).not.toContain(token)
    expect(JSON.stringify(store().status())).not.toContain(JSON.parse(raw).hash)
    expect(status).toMatchObject({
      state: 'active',
      expiresAt: now + EXTERNAL_TOKEN_TTL_MS,
      lastUsedAt: null,
      scope: SCOPE
    })
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('confere o token certo, recusa o errado e o vencido', () => {
    const { token } = store().create(SCOPE)
    expect(store().verify(token)).toEqual({ ok: true, scope: SCOPE })
    expect(store().verify(token + 'x')).toEqual({ ok: false, reason: 'invalid' })
    expect(store().verify('')).toEqual({ ok: false, reason: 'invalid' })
    now += 30 * DAY
    expect(store().verify(token)).toEqual({ ok: false, reason: 'expired' })
    expect(store().status().state).toBe('expired')
  })

  it('renovar invalida o anterior na hora e mantém o escopo', () => {
    const first = store().create(SCOPE)
    now += 29 * DAY
    const renewed = store().renew()!
    expect(store().verify(first.token)).toEqual({ ok: false, reason: 'invalid' })
    expect(store().verify(renewed.token)).toEqual({ ok: true, scope: SCOPE })
    expect(renewed.status.expiresAt).toBe(now + EXTERNAL_TOKEN_TTL_MS)
  })

  it('renovar sem token não cria nada', () => {
    expect(store().renew()).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('revogar apaga o arquivo', () => {
    const { token } = store().create(SCOPE)
    store().revoke()
    expect(existsSync(file)).toBe(false)
    expect(store().verify(token)).toEqual({ ok: false, reason: 'invalid' })
    expect(store().status()).toEqual({ state: 'none' })
  })

  it('arquivo ilegível vale como nenhum token', () => {
    writeFileSync(file, '{ quebrado')
    expect(store().status()).toEqual({ state: 'none' })
    expect(store().verify('qualquer')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('último uso é gravado no máximo uma vez por minuto', () => {
    const s = store()
    s.create(SCOPE)
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

  it('lembra o dia do último aviso', () => {
    const s = store()
    s.create(SCOPE)
    expect(s.lastNoticeDay()).toBeNull()
    s.markNoticed('2026-11-02')
    expect(s.lastNoticeDay()).toBe('2026-11-02')
  })
})

describe('política do token externo', () => {
  it('toda escrita com cartão é arriscada; o resto não', () => {
    for (const name of MCP_APPROVAL_REQUIRED)
      expect([name, isExternalRisky(name)]).toEqual([name, true])
    expect(isExternalRisky('save_memory')).toBe(true)
    // Decided 2026-11-02: creating tasks is the external token's main use.
    expect(isExternalRisky('criar_task')).toBe(false)
    expect(externalSkipsCard(EXTERNAL_RUN_ID, 'criar_task')).toBe(true)
    expect(externalSkipsCard('run-do-fleet', 'criar_task')).toBe(false)
    expect(externalSkipsCard(EXTERNAL_RUN_ID, 'update_task')).toBe(false)
    expect(isExternalRisky('update_task')).toBe(false)
    expect(isExternalRisky('read_tasks')).toBe(false)
  })

  it('a run externa não guarda cronômetros nem atividade de sessão', () => {
    expect(tracksRunState(EXTERNAL_RUN_ID)).toBe(false)
    expect(tracksRunState('run-do-fleet')).toBe(true)
  })
})

describe('aviso de vencimento', () => {
  const at = Date.UTC(2026, 10, 2, 12)
  it('só avisa com 3 dias ou menos, uma vez por dia', () => {
    expect(expiryNotice(at, at + 4 * DAY, null)).toBeNull()
    const notice = expiryNotice(at, at + 3 * DAY, null)
    expect(notice?.text).toBe(
      'O acesso MCP externo vence em 3 dias. Renove em Configurações → Acesso MCP externo.'
    )
    expect(expiryNotice(at, at + 3 * DAY, notice!.day)).toBeNull()
    expect(expiryNotice(at, at + DAY / 2, null)?.text).toBe(
      'O acesso MCP externo vence hoje. Renove em Configurações → Acesso MCP externo.'
    )
    expect(expiryNotice(at, at - 1, null)).toBeNull()
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
