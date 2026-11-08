// @vitest-environment node
//
// What stops an external call (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md):
// a cut access first, then the lock. "Ler com o Sagyou bloqueado" lets reads
// through on the password screen; writes never pass a lock.
import { describe, expect, it } from 'vitest'
import { dataIpcAllowed, externalRefusal } from '../modules/agent/mcp-external-lock'
import {
  EXTERNAL_CUT_MESSAGE,
  EXTERNAL_LOCKED_WRITE_MESSAGE
} from '../modules/agent/mcp-external-policy'
import { MCP_LOCKED_MESSAGE } from '../modules/agent/sagyou-mcp'

const base = { cut: false, locked: false, locking: false, allowWhileLocked: false }

describe('externalRefusal', () => {
  it('os textos são os da spec', () => {
    expect(EXTERNAL_CUT_MESSAGE).toBe('Acesso externo cortado pelo celular.')
    expect(EXTERNAL_LOCKED_WRITE_MESSAGE).toBe(
      'O Sagyou está bloqueado: as escritas voltam depois de desbloquear (no PC ou pelo celular, aba PC). Leituras funcionam.'
    )
  })

  it('desbloqueado, nada recusa', () => {
    expect(externalRefusal({ ...base, kind: 'read' })).toBeNull()
    expect(externalRefusal({ ...base, kind: 'write' })).toBeNull()
  })

  it('o corte vence o bloqueio, nas leituras e nas escritas', () => {
    for (const kind of ['read', 'write'] as const) {
      expect(externalRefusal({ ...base, cut: true, kind })).toBe(EXTERNAL_CUT_MESSAGE)
      expect(
        externalRefusal({ ...base, cut: true, locked: true, allowWhileLocked: true, kind })
      ).toBe(EXTERNAL_CUT_MESSAGE)
    }
  })

  it('enquanto bloqueia, recusa tudo com a mensagem de bloqueio', () => {
    for (const kind of ['read', 'write'] as const)
      expect(externalRefusal({ ...base, locking: true, allowWhileLocked: true, kind })).toBe(
        MCP_LOCKED_MESSAGE
      )
  })

  it('bloqueado sem a opção recusa tudo', () => {
    for (const kind of ['read', 'write'] as const)
      expect(externalRefusal({ ...base, locked: true, kind })).toBe(MCP_LOCKED_MESSAGE)
  })

  it('bloqueado com a opção: lê, mas não escreve', () => {
    const locked = { ...base, locked: true, allowWhileLocked: true }
    expect(externalRefusal({ ...locked, kind: 'read' })).toBeNull()
    expect(externalRefusal({ ...locked, kind: 'write' })).toBe(EXTERNAL_LOCKED_WRITE_MESSAGE)
  })
})

describe('dataIpcAllowed', () => {
  it('bloqueado, nenhum canal de dados passa, nem o store:save', () => {
    for (const channel of ['store:save', 'backup:export', 'store:load', 'ai:memory:list'])
      expect([channel, dataIpcAllowed(false, channel)]).toEqual([channel, false])
  })

  it('desbloqueado, passa', () => {
    expect(dataIpcAllowed(true, 'store:save')).toBe(true)
  })
})
