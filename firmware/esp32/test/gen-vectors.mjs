// Gera test/vectors.h, os vetores que o firmware e o script do Windows conferem.
// Rodar uma vez (node firmware/esp32/test/gen-vectors.mjs) e versionar o resultado.
// A chave é a pública de teste 00 01 02 … 1f, nunca uma chave real; o teste
// sync-server/src/__tests__/esp32-vectors.test.ts confere no CI que os MACs de
// comando e de estado batem com os do @sagyou/core.
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const key = Uint8Array.from({ length: 32 }, (_, i) => i)
const keyHex = Buffer.from(key).toString('hex')
const hmac = (msg) => createHmac('sha256', key).update(msg, 'utf8').digest('hex')

const commands = [
  ['wake', 1800000000000, 1800000120000],
  ['shutdown', 1800000060000, 1800000180000],
  ['abort-shutdown', 1800000090000, 1800000210000]
].map(([cmd, at, exp]) => ({ cmd, at, exp, mac: hmac(`sagyou-power|1|${cmd}|${at}|${exp}`) }))

const states = [
  [true, 'ok', 1800000005000],
  [false, '', 1800000015000],
  [true, 'clock', 1800000025000]
].map(([pcPing, lastResult, at]) => ({
  pcPing,
  lastResult,
  at,
  mac: hmac(`sagyou-power-state|1|${pcPing ? 1 : 0}|${lastResult}|${at}`)
}))

// RFC 4231, cases 1, 2 and 6 (computed here; they equal the RFC's published values).
const rfc = (k, msg) => createHmac('sha256', k).update(msg, 'utf8').digest('hex')
const rfc1 = rfc(Buffer.alloc(20, 0x0b), 'Hi There')
const rfc2 = rfc(Buffer.from('Jefe'), 'what do ya want for nothing?')
const rfc6 = rfc(Buffer.alloc(131, 0xaa), 'Test Using Larger Than Block-Size Key - Hash Key First')

const lanBody = 'sagyou-lan|1|shutdown|1800000000000'
const lan = `${lanBody}|${hmac(lanBody)}`

const out = `// Gerado por test/gen-vectors.mjs. Não edite à mão.
// Chave PÚBLICA de teste (00 01 02 … 1f): nunca uma chave real. É o único arquivo do
// firmware com 64 hexadecimais no git (sync-server/src/__tests__/firmware-secrets.test.ts).
#pragma once
#include <stdint.h>

#define TEST_KEY_HEX "${keyHex}"

struct CommandVector {
  const char *cmd;
  int64_t at;
  int64_t exp;
  const char *mac;
};

static const CommandVector COMMAND_VECTORS[] = {
${commands.map((c) => `    {"${c.cmd}", ${c.at}LL, ${c.exp}LL, "${c.mac}"},`).join('\n')}
};

struct StateVector {
  bool pcPing;
  const char *lastResult;
  int64_t at;
  const char *mac;
};

static const StateVector STATE_VECTORS[] = {
${states.map((s) => `    {${s.pcPing}, "${s.lastResult}", ${s.at}LL, "${s.mac}"},`).join('\n')}
};

// Rede local: shutdown com at = 1800000000000.
#define LAN_VECTOR "${lan}"

// HMAC-SHA256 da RFC 4231, casos 1, 2 e 6.
#define RFC4231_CASE1 "${rfc1}"
#define RFC4231_CASE2 "${rfc2}"
#define RFC4231_CASE6 "${rfc6}"
`

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vectors.h'), out)
console.log('vectors.h gerado')
