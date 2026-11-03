import { describe, expect, it } from 'vitest'
import type { PcStatus } from '../messages'
import { pcState, type PowerView } from '../state'
import { rcDownText, shuttingDownText, suspendedText } from '../texts'

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
      missing: []
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
    const wake = (ago: number): { cmd: string; at: number } => ({ cmd: 'wake', at: NOW - ago })
    expect(pcState({ ...base, power: noPing, lastCommand: wake(5 * MIN - 1000) }).state).toBe(
      'booting'
    )
    expect(pcState({ ...base, power: noPing, lastCommand: wake(5 * MIN) }).state).toBe('off')
    expect(
      pcState({ ...base, power: noPing, lastCommand: { cmd: 'shutdown', at: NOW } }).state
    ).toBe('off')
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
})

describe('textos', () => {
  it('suspensão mostra a hora local', () => {
    const until = new Date(2026, 10, 3, 14, 32).getTime()
    expect(suspendedText(until)).toBe('Desbloqueio remoto suspenso até 14:32.')
  })
})
