// @vitest-environment node
//
// mcp-external:* — the token leaves main only in the answer to create/renew,
// once; status, the log and the file never carry it.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { registerMcpExternalHandlers, type McpExternalIssued } from '../handlers/mcp-external'
import { createMcpExternalStore } from '../modules/agent/mcp-external'

let dir: string
let handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
let info: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.fn>
let bridgeWrites: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-ipc-'))
  handlers = new Map()
  info = vi.fn()
  warn = vi.fn()
  bridgeWrites = 0
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, fn)
  } as unknown as IpcMain
  registerMcpExternalHandlers(ipcMain, {
    store: createMcpExternalStore({ file: join(dir, 'mcp-external.json'), now: Date.now }),
    execPath: 'C:\\Sagyou\\Sagyou.exe',
    bridgePath: join(dir, 'mcp-external-bridge.cjs'),
    portFile: join(dir, 'mcp-external-port'),
    writeBridge: () => {
      bridgeWrites += 1
    },
    log: { info, warn }
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const invoke = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!({}, ...args)

describe('mcp-external:*', () => {
  it('registra os quatro canais', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'mcp-external:create',
      'mcp-external:renew',
      'mcp-external:revoke',
      'mcp-external:status'
    ])
  })

  it('gerar devolve o token e o comando uma vez; status, log e arquivo nunca o têm', () => {
    const issued = invoke('mcp-external:create', {
      projectId: null,
      financialProfileId: 'personal',
      mode: 'read-write'
    }) as Extract<McpExternalIssued, { ok: true }>
    expect(issued.ok).toBe(true)
    expect(issued.command).toContain(`SAGYOU_MCP_TOKEN=${issued.token}`)
    expect(issued.command).toContain('claude mcp add sagyou-externo')
    expect(bridgeWrites).toBe(1)
    const status = invoke('mcp-external:status')
    const raw = readFileSync(join(dir, 'mcp-external.json'), 'utf8')
    expect(JSON.stringify(status)).not.toContain(issued.token)
    expect(JSON.stringify(status)).not.toContain(JSON.parse(raw).hash)
    expect(JSON.stringify(status)).not.toMatch(/"hash"|"token"/)
    expect(raw).not.toContain(issued.token)
    expect(JSON.stringify(info.mock.calls)).not.toContain(issued.token)
    expect(info).toHaveBeenCalledWith('mcp', 'external_token_created', { mode: 'read-write' })
  })

  it('recusa escopo inválido', () => {
    expect(invoke('mcp-external:create', { financialProfileId: '', mode: 'read' })).toEqual({
      ok: false,
      error: 'Escolha o perfil financeiro e o tipo de acesso.'
    })
    expect(invoke('mcp-external:create', { financialProfileId: 'p', mode: 'admin' })).toEqual({
      ok: false,
      error: 'Escolha o perfil financeiro e o tipo de acesso.'
    })
  })

  it('renovar sem token avisa; com token, troca e mostra de novo', () => {
    expect(invoke('mcp-external:renew')).toEqual({
      ok: false,
      error: 'Nenhum acesso externo para renovar.'
    })
    const first = invoke('mcp-external:create', {
      projectId: 'p1',
      financialProfileId: 'personal',
      mode: 'read'
    }) as Extract<McpExternalIssued, { ok: true }>
    const renewed = invoke('mcp-external:renew') as Extract<McpExternalIssued, { ok: true }>
    expect(renewed.ok).toBe(true)
    expect(renewed.token).not.toBe(first.token)
    expect(renewed.status.scope).toEqual({
      projectId: 'p1',
      financialProfileId: 'personal',
      mode: 'read'
    })
  })

  it('revogar apaga e registra no log', () => {
    invoke('mcp-external:create', { projectId: null, financialProfileId: 'p', mode: 'read' })
    expect(invoke('mcp-external:revoke')).toEqual({ state: 'none' })
    expect(existsSync(join(dir, 'mcp-external.json'))).toBe(false)
    expect(info).toHaveBeenCalledWith('mcp', 'external_token_revoked')
  })
})
