#!/usr/bin/env node
// ESP32 simulado: faz no PC o papel do firmware, para testar o controle remoto
// sem o hardware. Segue o contrato de docs/esp32-api.md.
//
//   node sync-server/scripts/esp32-sim.mjs --url https://<worker> --token <token> --key <64 hex> [--ping on|off]
//
// Consulta /power/next a cada 10 s, confere o MAC, o prazo, o relógio e o
// contador (at), imprime o comando que executaria e informa o estado assinado
// em /power/state. Nunca liga nem desliga nada de verdade. O contador "flash"
// vive só na memória deste processo.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const POLL_MS = 10_000
/** |at − now| allowed between the phone's clock and NTP. */
export const CLOCK_SKEW_MS = 5 * 60_000
export const COMMANDS = ['wake', 'shutdown', 'abort-shutdown']

/** The ESP32 key as shown by the Sagyou (64 hex characters) → 32 bytes. */
export function parseKey(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex))
    throw new Error('A chave do ESP32 tem 64 caracteres hexadecimais.')
  return Buffer.from(hex, 'hex')
}

export function commandMac(key, cmd, at, exp) {
  return createHmac('sha256', key).update(`sagyou-power|1|${cmd}|${at}|${exp}`).digest('hex')
}

export function stateMac(key, pcPing, lastResult, at) {
  return createHmac('sha256', key)
    .update(`sagyou-power-state|1|${pcPing ? 1 : 0}|${lastResult}|${at}`)
    .digest('hex')
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * The firmware's decision for one command, in this order: MAC, counter,
 * clock, deadline. `lastAt` is the last executed `at` (kept in flash).
 * Returns { run, result, lastAt } with the new counter.
 */
export function decideCommand(c, { key, lastAt, now }) {
  const valid =
    c &&
    COMMANDS.includes(c.cmd) &&
    Number.isSafeInteger(c.at) &&
    Number.isSafeInteger(c.exp) &&
    sameHex(c.mac, commandMac(key, c.cmd, c.at, c.exp))
  if (!valid) return { run: false, result: 'mac', lastAt }
  if (c.at <= lastAt) return { run: false, result: 'old', lastAt }
  if (Math.abs(c.at - now) > CLOCK_SKEW_MS) return { run: false, result: 'clock', lastAt }
  if (c.exp <= now) return { run: false, result: 'expired', lastAt }
  return { run: true, result: 'ok', lastAt: c.at }
}

function args(argv) {
  const out = { ping: 'on' }
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '')
    if (!['url', 'token', 'key', 'ping'].includes(name) || argv[i + 1] === undefined)
      throw new Error(`Argumento inválido: ${argv[i]}`)
    out[name] = argv[i + 1]
  }
  if (!out.url || !out.token || !out.key) throw new Error('Use --url, --token e --key.')
  if (!['on', 'off'].includes(out.ping)) throw new Error('--ping é on ou off.')
  return out
}

async function main() {
  const opts = args(process.argv.slice(2))
  const key = parseKey(opts.key)
  const base = opts.url.replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' }
  let lastAt = 0
  let lastResult = ''
  let pcPing = opts.ping === 'on'
  const tick = async () => {
    try {
      const res = await fetch(`${base}/power/next`, { headers })
      if (!res.ok) throw new Error(`/power/next respondeu ${res.status}`)
      const { command } = await res.json()
      if (command) {
        const d = decideCommand(command, { key, lastAt, now: Date.now() })
        lastAt = d.lastAt
        lastResult = d.result
        if (d.run) {
          console.log(`[esp32] executaria: ${command.cmd}`)
          if (command.cmd === 'wake') pcPing = true
        } else console.log(`[esp32] recusado (${d.result}): ${command.cmd}`)
      }
      const at = Date.now()
      const body = { pcPing, lastResult, at, mac: stateMac(key, pcPing, lastResult, at) }
      const sent = await fetch(`${base}/power/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
      if (!sent.ok) throw new Error(`/power/state respondeu ${sent.status}`)
    } catch (e) {
      console.error(`[esp32] ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`[esp32] consultando ${base} a cada ${POLL_MS / 1000} s (ping ${opts.ping}).`)
  await tick()
  setInterval(tick, POLL_MS)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
