import { describe, expect, it } from 'vitest'
import { powerCommandMac, powerStateMac } from '../../../packages/core/src/control/crypto'
// @ts-expect-error -- plain Node script, no type declarations
import { commandMac, decideCommand, parseKey, stateMac } from '../../scripts/esp32-sim.mjs'

const KEY_HEX = '0f'.repeat(32)
const KEY = Uint8Array.from({ length: 32 }, () => 0x0f)
const NOW = 1_800_000_000_000

function command(over: Record<string, unknown> = {}) {
  const at = (over.at as number) ?? NOW - 1_000
  const exp = (over.exp as number) ?? at + 120_000
  const cmd = (over.cmd as string) ?? 'wake'
  return { cmd, at, exp, mac: powerCommandMac(KEY, cmd, at, exp), ...over }
}

describe('ESP32 simulado', () => {
  it('calcula o MAC igual ao celular e ao PC', () => {
    const key = parseKey(KEY_HEX)
    expect(commandMac(key, 'wake', 10, 20)).toBe(powerCommandMac(KEY, 'wake', 10, 20))
    expect(stateMac(key, true, 'ok', 30)).toBe(powerStateMac(KEY, true, 'ok', 30))
    expect(stateMac(key, false, '', 30)).toBe(powerStateMac(KEY, false, '', 30))
  })

  it('a chave é exatamente 64 caracteres hexadecimais', () => {
    expect(() => parseKey('0f'.repeat(31))).toThrow()
    expect(() => parseKey('zz'.repeat(32))).toThrow()
    expect(parseKey(KEY_HEX.toUpperCase())).toHaveLength(32)
  })

  it('MAC certo e at novo: executa', () => {
    const c = command()
    expect(decideCommand(c, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW })).toEqual({
      run: true,
      result: 'ok',
      lastAt: c.at
    })
  })

  it('at igual ou menor que o último executado: ignora', () => {
    const c = command()
    for (const lastAt of [c.at, c.at + 1])
      expect(decideCommand(c, { key: parseKey(KEY_HEX), lastAt, now: NOW })).toEqual({
        run: false,
        result: 'old',
        lastAt
      })
  })

  it('MAC errado: ignora, inclusive com o comando trocado', () => {
    const forged = { ...command(), cmd: 'shutdown' }
    expect(decideCommand(forged, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW })).toEqual({
      run: false,
      result: 'mac',
      lastAt: 0
    })
    const wrongKey = command()
    expect(decideCommand(wrongKey, { key: parseKey('aa'.repeat(32)), lastAt: 0, now: NOW }).result).toBe(
      'mac'
    )
  })

  it('exp passado: ignora', () => {
    const c = command({ at: NOW - 130_000, exp: NOW - 10_000 })
    expect(decideCommand(c, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW })).toEqual({
      run: false,
      result: 'expired',
      lastAt: 0
    })
  })

  it('relógio do celular a mais de 5 min do NTP: ignora', () => {
    const ahead = command({ at: NOW + 6 * 60_000, exp: NOW + 7 * 60_000 })
    expect(decideCommand(ahead, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW }).result).toBe('clock')
    const behind = command({ at: NOW - 6 * 60_000, exp: NOW + 60_000 })
    expect(decideCommand(behind, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW }).result).toBe('clock')
  })

  it('comando desconhecido nunca executa', () => {
    const c = command({ cmd: 'format-disk' })
    expect(decideCommand(c, { key: parseKey(KEY_HEX), lastAt: 0, now: NOW }).run).toBe(false)
  })
})
