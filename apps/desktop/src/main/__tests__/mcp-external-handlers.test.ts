// @vitest-environment node
//
// mcp-external:* — the token leaves main only in the answer to create, once;
// status, the log and the file never carry it. There is no scope to choose and
// no renew: generating again replaces the token (spec 2026-11-03-acesso-remoto).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { IpcMain } from 'electron'
import { registerMcpExternalHandlers, type McpExternalIssued } from '../handlers/mcp-external'
import { createMcpExternalStore } from '../modules/agent/mcp-external'

let dir: string
let handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
type LogSpy = (...args: unknown[]) => void
let info: Mock<LogSpy>
let warn: Mock<LogSpy>
let bridgeWrites: number
let changes: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sagyou-mcp-ext-ipc-'))
  handlers = new Map()
  info = vi.fn<LogSpy>()
  warn = vi.fn<LogSpy>()
  bridgeWrites = 0
  changes = 0
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
    onTokenChanged: () => {
      changes += 1
    },
    log: { info, warn }
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const invoke = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!({}, ...args)

describe('mcp-external:*', () => {
  it('registra os quatro canais, sem renew', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'mcp-external:create',
      'mcp-external:revoke',
      'mcp-external:set-allow-locked',
      'mcp-external:status'
    ])
  })

  it('gerar devolve o token e o comando uma vez; status, log e arquivo nunca o têm', () => {
    const issued = invoke('mcp-external:create') as Extract<McpExternalIssued, { ok: true }>
    expect(issued.ok).toBe(true)
    expect(issued.command).toContain(`SAGYOU_MCP_TOKEN=${issued.token}`)
    expect(issued.command).toContain('claude mcp add sagyou-externo')
    expect(bridgeWrites).toBe(1)
    expect(issued.status).toMatchObject({ state: 'active', allowWhileLocked: false })
    const status = invoke('mcp-external:status')
    const raw = readFileSync(join(dir, 'mcp-external.json'), 'utf8')
    expect(JSON.stringify(status)).not.toContain(issued.token)
    expect(JSON.stringify(status)).not.toContain(JSON.parse(raw).hash)
    expect(JSON.stringify(status)).not.toMatch(/"hash"|"token"/)
    expect(raw).not.toContain(issued.token)
    expect(JSON.stringify(info.mock.calls)).not.toContain(issued.token)
    expect(info).toHaveBeenCalledWith('mcp', 'external_token_created')
  })

  it('gerar de novo troca o token e ignora qualquer escopo vindo do renderer', () => {
    const first = invoke('mcp-external:create') as Extract<McpExternalIssued, { ok: true }>
    const second = invoke('mcp-external:create', {
      projectId: 'p1',
      financialProfileId: 'personal',
      mode: 'read'
    }) as Extract<McpExternalIssued, { ok: true }>
    expect(second.ok).toBe(true)
    expect(second.token).not.toBe(first.token)
    expect(JSON.parse(readFileSync(join(dir, 'mcp-external.json'), 'utf8'))).not.toHaveProperty(
      'projectId'
    )
  })

  it('"funcionar bloqueado" aceita só booleano e é registrado no log', () => {
    invoke('mcp-external:create')
    expect(invoke('mcp-external:set-allow-locked', 'sim')).toMatchObject({
      allowWhileLocked: false
    })
    expect(info).not.toHaveBeenCalledWith('mcp', 'external_allow_locked', expect.anything())
    expect(invoke('mcp-external:set-allow-locked', true)).toMatchObject({
      state: 'active',
      allowWhileLocked: true
    })
    expect(info).toHaveBeenCalledWith('mcp', 'external_allow_locked', { value: true })
    expect(
      JSON.parse(readFileSync(join(dir, 'mcp-external.json'), 'utf8')).allowWhileLocked
    ).toBe(true)
  })

  it('"funcionar bloqueado" sem token não cria nada', () => {
    expect(invoke('mcp-external:set-allow-locked', true)).toEqual({ state: 'none' })
    expect(existsSync(join(dir, 'mcp-external.json'))).toBe(false)
  })

  it('revogar apaga e registra no log', () => {
    invoke('mcp-external:create')
    expect(invoke('mcp-external:revoke')).toEqual({ state: 'none' })
    expect(existsSync(join(dir, 'mcp-external.json'))).toBe(false)
    expect(info).toHaveBeenCalledWith('mcp', 'external_token_revoked')
  })

  it('avisa a troca do token (fila do token antigo) ao gerar, gerar de novo e revogar', () => {
    invoke('mcp-external:create')
    invoke('mcp-external:create')
    invoke('mcp-external:revoke')
    expect(changes).toBe(3)
  })

  it('falha ao gravar a ponte não troca o token', () => {
    handlers.clear()
    const ipcMain = {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn)
    } as unknown as IpcMain
    registerMcpExternalHandlers(ipcMain, {
      store: createMcpExternalStore({ file: join(dir, 'mcp-external.json'), now: Date.now }),
      execPath: 'x',
      bridgePath: 'y',
      portFile: 'z',
      writeBridge: () => {
        throw new Error('disco cheio')
      },
      onTokenChanged: () => {
        changes += 1
      },
      log: { info, warn }
    })
    expect(invoke('mcp-external:create')).toEqual({
      ok: false,
      error: 'Não foi possível gerar o acesso MCP externo.'
    })
    expect(existsSync(join(dir, 'mcp-external.json'))).toBe(false)
    expect(changes).toBe(0)
    expect(warn).toHaveBeenCalledWith('mcp', 'external_token_failed')
  })
})
