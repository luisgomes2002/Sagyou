// @vitest-environment node
//
// The firmware checks its HMAC against firmware/esp32/test/vectors.h (spec
// docs/specs/2026-11-07-esp32-firmware.md). Here, in CI, those same vectors are
// checked against the phone/PC code in @sagyou/core: if the core ever changes
// the message, this fails before the board disagrees with the phone.
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { powerCommandMac, powerStateMac } from '../../../packages/core/src/control/crypto'

const text = readFileSync(
  join(__dirname, '..', '..', '..', 'firmware', 'esp32', 'test', 'vectors.h'),
  'utf8'
)
const keyHex = /#define TEST_KEY_HEX "([0-9a-f]{64})"/.exec(text)?.[1] ?? ''
const key = Uint8Array.from(Buffer.from(keyHex, 'hex'))

describe('vetores do firmware do ESP32', () => {
  it('a chave é a pública de teste 00 01 02 … 1f', () => {
    expect([...key]).toEqual(Array.from({ length: 32 }, (_, i) => i))
  })

  it('cada MAC de comando é o do core', () => {
    const rows = [
      ...text.matchAll(/\{"([a-z-]+)", (\d+)LL, (\d+)LL, "([0-9a-f]{64})"\}/g)
    ]
    expect(rows.length).toBe(3)
    for (const [, cmd, at, exp, mac] of rows)
      expect(powerCommandMac(key, cmd, Number(at), Number(exp))).toBe(mac)
  })

  it('cada MAC de estado é o do core', () => {
    const rows = [...text.matchAll(/\{(true|false), "([a-z]*)", (\d+)LL, "([0-9a-f]{64})"\}/g)]
    expect(rows.length).toBe(3)
    for (const [, ping, lastResult, at, mac] of rows)
      expect(powerStateMac(key, ping === 'true', lastResult, Number(at))).toBe(mac)
  })
})
