import { describe, expect, it } from 'vitest'
import type { PcStatus } from '../messages'
import { POWER_COMMAND_TTL_MS, pcState, type PcStateInput, type PowerView } from '../state'
import { CONTROL_TEXT, rcDownText, shuttingDownText, suspendedText } from '../texts'

const NOW = 1_800_000_000_000
const MIN = 60_000

const status = (over: Partial<PcStatus> = {}): PcStatus => ({
  v: 1,
  at: NOW - 10_000,
  locked: false,
  servers: [
    { name: 'Sagyou', up: true },
    { name: 'Murasaki', up: true }
  ],
  pendingCards: 0,
  shutdownAt: null,
  suspendedUntil: null,
  updateVersion: null,
  ...over
})

const power = (over: Partial<PowerView> = {}): PowerView => ({
  pcPing: true,
  at: NOW - 10_000,
  lastPoll: NOW - 10_000,
  verified: true,
  ...over
})

const base = { now: NOW, status: null, power: null, lastCommand: null }

describe('pcState', () => {
  it('Pronto: sinal de vida recente e todos os servidores rodando', () => {
    expect(pcState({ ...base, status: status(), power: power() })).toEqual({
      state: 'ready',
      esp32Offline: false,
      missing: [],
      esp32NoAnswer: false,
      forcedShutdownUntil: null
    })
  })

  it('sinal de vida de 1:59 vale; de 2:00 não', () => {
    expect(pcState({ ...base, status: status({ at: NOW - 2 * MIN + 1000 }) }).state).toBe('ready')
    expect(pcState({ ...base, status: status({ at: NOW - 2 * MIN }) }).state).toBe('off')
  })

  it('Remote Control fora do ar lista os que faltam na ordem da lista', () => {
    const s = status({
      servers: [
        { name: 'B', up: false },
        { name: 'A', up: true },
        { name: 'C', up: false }
      ]
    })
    const view = pcState({ ...base, status: s })
    expect(view.state).toBe('rc-down')
    expect(view.missing).toEqual(['B', 'C'])
    expect(rcDownText(view.missing)).toBe('PC ligado, Remote Control fora do ar: B, C.')
  })

  it('Desligando quando o PC agendou o desligamento', () => {
    const view = pcState({ ...base, status: status({ shutdownAt: NOW + 58_000 }) })
    expect(view.state).toBe('shutting-down')
    expect(shuttingDownText(58_000)).toBe('Desligando em 0:58')
  })

  it('ping sem sinal de vida: ligado, aguardando o Sagyou', () => {
    expect(pcState({ ...base, power: power() }).state).toBe('waiting-sagyou')
  })

  it('Ligando por até 5 min depois de um wake sem ping', () => {
    const noPing = power({ pcPing: false })
    const wake = (ago: number): PcStateInput['lastCommand'] => ({
      cmd: 'wake',
      at: NOW - ago,
      takenAt: NOW - ago + 1000
    })
    expect(pcState({ ...base, power: noPing, lastCommand: wake(5 * MIN - 1000) }).state).toBe(
      'booting'
    )
    expect(pcState({ ...base, power: noPing, lastCommand: wake(5 * MIN) }).state).toBe('off')
    const shutdown = { cmd: 'shutdown', at: NOW, takenAt: null }
    expect(pcState({ ...base, power: noPing, lastCommand: shutdown }).state).toBe('off')
  })

  it('Desligado sem ping e sem sinal de vida', () => {
    expect(pcState({ ...base, power: power({ pcPing: false }) }).state).toBe('off')
  })

  it('ESP32 sem contato: sem consulta há 2 min ou estado sem MAC válido', () => {
    expect(pcState({ ...base, power: power({ lastPoll: NOW - 2 * MIN }) }).esp32Offline).toBe(true)
    const forged = pcState({ ...base, power: power({ verified: false }) })
    expect(forged.esp32Offline).toBe(true)
    expect(forged.state).toBe('off')
    expect(pcState({ ...base }).esp32Offline).toBe(true)
  })

  it('ESP32 sem contato quando o relatório é antigo, mesmo com consulta recente', () => {
    const stale = power({ at: NOW - 2 * MIN, lastPoll: NOW - 1000 })
    const view = pcState({ ...base, power: stale })
    expect(view.esp32Offline).toBe(true)
    expect(view.state).toBe('off')
    expect(pcState({ ...base, power: power({ at: NOW - 2 * MIN + 1000 }) }).esp32Offline).toBe(
      false
    )
  })
})

describe('ESP32 não respondeu', () => {
  const noPing = power({ pcPing: false })
  const cmd = (ago: number, takenAt: number | null = null): PcStateInput['lastCommand'] => ({
    cmd: 'wake',
    at: NOW - ago,
    takenAt
  })

  it('comando não buscado há 2 min: esp32NoAnswer', () => {
    expect(POWER_COMMAND_TTL_MS).toBe(2 * MIN)
    expect(pcState({ ...base, power: noPing, lastCommand: cmd(2 * MIN) }).esp32NoAnswer).toBe(true)
    expect(
      pcState({ ...base, power: noPing, lastCommand: cmd(2 * MIN - 1000) }).esp32NoAnswer
    ).toBe(false)
    expect(CONTROL_TEXT.esp32NoAnswer).toBe('O ESP32 não respondeu.')
  })

  it('comando buscado pelo ESP32 não é falta de resposta', () => {
    const taken = cmd(3 * MIN, NOW - 3 * MIN + 2000)
    expect(pcState({ ...base, power: noPing, lastCommand: taken }).esp32NoAnswer).toBe(false)
  })

  it('PC pronto, com Remote Control fora ou desligando não mostra o aviso', () => {
    const old = cmd(10 * MIN)
    expect(pcState({ ...base, status: status(), lastCommand: old }).esp32NoAnswer).toBe(false)
    const down = status({ servers: [{ name: 'A', up: false }] })
    expect(pcState({ ...base, status: down, lastCommand: old }).esp32NoAnswer).toBe(false)
    const leaving = status({ shutdownAt: NOW + 30_000 })
    expect(pcState({ ...base, status: leaving, lastCommand: old }).esp32NoAnswer).toBe(false)
    expect(pcState({ ...base, power: power(), lastCommand: old }).esp32NoAnswer).toBe(true)
  })

  it('sem comando não há aviso', () => {
    expect(pcState({ ...base, power: noPing }).esp32NoAnswer).toBe(false)
  })
})

describe('desligamento forçado pelo ESP32', () => {
  const shutdown = (takenAt: number | null): PcStateInput['lastCommand'] => ({
    cmd: 'shutdown',
    at: NOW - 5000,
    takenAt
  })

  it('janela de 60 s depois que o ESP32 buscou o shutdown', () => {
    const takenAt = NOW - 2000
    expect(
      pcState({ ...base, power: power(), lastCommand: shutdown(takenAt) }).forcedShutdownUntil
    ).toBe(takenAt + 60_000)
  })

  it('termina aos 60 s', () => {
    const takenAt = NOW - 60_000
    expect(
      pcState({ ...base, power: power(), lastCommand: shutdown(takenAt) }).forcedShutdownUntil
    ).toBeNull()
    expect(
      pcState({ ...base, power: power(), lastCommand: shutdown(takenAt + 1) }).forcedShutdownUntil
    ).toBe(NOW + 1)
  })

  it('sem takenAt, com PC vivo ou outro comando: null', () => {
    expect(
      pcState({ ...base, power: power(), lastCommand: shutdown(null) }).forcedShutdownUntil
    ).toBeNull()
    expect(
      pcState({ ...base, status: status(), lastCommand: shutdown(NOW - 1000) }).forcedShutdownUntil
    ).toBeNull()
    expect(
      pcState({
        ...base,
        power: power(),
        lastCommand: { cmd: 'wake', at: NOW - 5000, takenAt: NOW - 1000 }
      }).forcedShutdownUntil
    ).toBeNull()
  })
})

describe('textos', () => {
  it('cancelar pedido e PC já desligando', () => {
    expect(CONTROL_TEXT.cancelRequest).toBe('Cancelar pedido')
    expect(CONTROL_TEXT.alreadyShuttingDown).toBe('O PC já está desligando.')
  })

  it('suspensão mostra a hora local', () => {
    const until = new Date(2026, 10, 3, 14, 32).getTime()
    expect(suspendedText(until)).toBe('Desbloqueio remoto suspenso até 14:32.')
  })
})
