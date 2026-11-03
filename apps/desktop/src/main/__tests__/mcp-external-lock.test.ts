// @vitest-environment node
//
// "Funcionar com o Sagyou bloqueado": when the lock stops the external token,
// and the narrow store:save window its writes open (spec 2026-11-03-acesso-remoto).
import { describe, expect, it } from 'vitest'
import { createLockedSaveGate, externalBlockedByLock } from '../modules/agent/mcp-external-lock'

describe('externalBlockedByLock', () => {
  it('desbloqueado nunca bloqueia', () => {
    expect(externalBlockedByLock({ locked: false, locking: false, allowWhileLocked: false })).toBe(
      false
    )
  })

  it('bloqueado sem a opção bloqueia; com a opção, não', () => {
    expect(externalBlockedByLock({ locked: true, locking: false, allowWhileLocked: false })).toBe(
      true
    )
    expect(externalBlockedByLock({ locked: true, locking: false, allowWhileLocked: true })).toBe(
      false
    )
  })

  it('enquanto bloqueia (o renderer salvando), sempre bloqueia', () => {
    expect(externalBlockedByLock({ locked: false, locking: true, allowWhileLocked: true })).toBe(
      true
    )
    expect(externalBlockedByLock({ locked: false, locking: true, allowWhileLocked: false })).toBe(
      true
    )
  })
})

describe('createLockedSaveGate', () => {
  it('fechado, não deixa passar nem o store:save', () => {
    expect(createLockedSaveGate().allows('store:save')).toBe(false)
  })

  it('aberto, deixa passar só o store:save', () => {
    const gate = createLockedSaveGate()
    gate.begin()
    expect(gate.allows('store:save')).toBe(true)
    for (const channel of ['backup:export', 'store:load', 'ai:memory:list', 'files:delete'])
      expect([channel, gate.allows(channel)]).toEqual([channel, false])
  })

  it('conta cada escrita: com duas abertas e uma encerrada, continua aberto', () => {
    const gate = createLockedSaveGate()
    const first = gate.begin()
    const second = gate.begin()
    first()
    expect(gate.allows('store:save')).toBe(true)
    second()
    expect(gate.allows('store:save')).toBe(false)
  })

  it('encerrar duas vezes não deixa o contador negativo', () => {
    const gate = createLockedSaveGate()
    const end = gate.begin()
    end()
    end()
    const next = gate.begin()
    expect(gate.allows('store:save')).toBe(true)
    next()
    expect(gate.allows('store:save')).toBe(false)
  })
})
