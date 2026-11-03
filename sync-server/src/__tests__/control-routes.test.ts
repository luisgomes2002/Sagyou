// @vitest-environment node
//
// Remote-control routes: who may talk to whom, the ESP32 token's narrow reach,
// and that a D1 without the new tables answers 501 while sync keeps working.
import { describe, expect, it } from 'vitest'
import { MemoryControlDb } from '../control-db'
import type { NotifyCode } from '../control-routes'
import { handle, type RouteDeps } from '../routes'
import {
  DEV_A,
  DEV_B,
  DEV_C,
  PROOF,
  codeFromUri,
  enroll,
  json,
  pairSecond,
  registerFirst,
  req,
  setup
} from './helpers'

const CIPHER = 'Y2lmcmFkbw=='
const MAC = 'f'.repeat(64)

interface World {
  deps: RouteDeps
  control: MemoryControlDb
  clock: { now: number }
  a: string
  b: string
  c: string
  uri: string
  notified: { ids: string[]; code: NotifyCode }[]
  totp: () => string
}

async function world(): Promise<World> {
  const { deps, clock } = setup()
  const control = new MemoryControlDb()
  const notified: { ids: string[]; code: NotifyCode }[] = []
  deps.control = control
  deps.notify = async (ids, code) => {
    notified.push({ ids, code })
  }
  const a = await registerFirst(deps, DEV_A)
  const { uri } = await enroll(deps, a)
  const b = await pairSecond(deps, a, DEV_B)
  const c = await pairSecond(deps, a, DEV_C)
  return { deps, control, clock, a, b, c, uri, notified, totp: () => codeFromUri(uri, clock.now) }
}

const proof = { 'x-key-proof': PROOF }

async function call(
  w: World,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  return handle(req(method, path, opts), w.deps)
}

async function makePc(w: World): Promise<void> {
  const res = await call(w, 'POST', '/roles/pc', {
    token: w.a,
    headers: { ...proof, 'x-totp-code': w.totp() }
  })
  expect(res.status).toBe(200)
}

async function makeController(w: World, id: string): Promise<void> {
  const res = await call(w, 'POST', '/roles/controllers', { token: w.a, headers: proof, body: { id } })
  expect(res.status).toBe(200)
}

const message = (to: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  to,
  msgId: `msg-${Math.random().toString(36).slice(2, 10)}`,
  ciphertext: CIPHER,
  ttlMs: 60_000,
  ...extra
})

describe('papéis', () => {
  it('virar PC pede prova da chave e o segundo fator', async () => {
    const w = await world()
    expect((await call(w, 'POST', '/roles/pc', { token: w.a, headers: proof })).status).toBe(401)
    expect((await w.control.getRoles()).pc).toBeNull()
    await makePc(w)
    expect(await json(await call(w, 'GET', '/roles/pc', { token: w.b }))).toEqual({ pc: DEV_A })
  })

  it('só o PC adiciona, lista e remove controles', async () => {
    const w = await world()
    await makePc(w)
    const byB = await call(w, 'POST', '/roles/controllers', {
      token: w.b,
      headers: proof,
      body: { id: DEV_C }
    })
    expect(byB.status).toBe(403)
    expect(
      (await call(w, 'POST', '/roles/controllers', { token: w.a, body: { id: DEV_B } })).status
    ).toBe(401)
    await makeController(w, DEV_B)
    expect((await call(w, 'GET', '/roles/controllers', { token: w.b })).status).toBe(403)
    expect(await json(await call(w, 'GET', '/roles/controllers', { token: w.a }))).toEqual({
      controllers: [DEV_B]
    })
    expect(
      (await call(w, 'DELETE', `/roles/controllers/${DEV_B}`, { token: w.a, headers: proof })).status
    ).toBe(200)
    expect((await w.control.getRoles()).controllers).toEqual([])
  })

  it('aparelho revogado no sync perde o papel e recebe 401', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const revoked = await call(w, 'POST', `/devices/${DEV_B}/revoke`, {
      token: w.a,
      headers: proof,
      body: { wipe: false }
    })
    expect(revoked.status).toBe(200)
    expect((await w.control.getRoles()).controllers).toEqual([])
    expect((await call(w, 'GET', '/control/inbox', { token: w.b })).status).toBe(401)
  })
})

describe('autorização à distância', () => {
  it('fator errado conta no bloqueio e não mexe nos papéis', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const res = await call(w, 'POST', '/roles/remote', {
      token: w.c,
      headers: { ...proof, 'x-totp-code': '000000' },
      body: { msgId: 'pedido-remoto-1', ciphertext: CIPHER }
    })
    expect(res.status).toBe(401)
    expect((await json(res)).error).toBe('invalid factor')
    expect((await w.control.getRoles()).controllers).toEqual([DEV_B])
    expect(w.control.messages).toEqual([])
  })

  it('fator certo deixa só o celular novo e guarda o pedido por 24 h', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const res = await call(w, 'POST', '/roles/remote', {
      token: w.c,
      headers: { ...proof, 'x-totp-code': w.totp() },
      body: { msgId: 'pedido-remoto-1', ciphertext: CIPHER }
    })
    expect(res.status).toBe(200)
    expect((await w.control.getRoles()).controllers).toEqual([DEV_C])
    expect(w.control.messages).toHaveLength(1)
    expect(w.control.messages[0]).toMatchObject({ to: DEV_A, from: DEV_C })
    expect(w.control.messages[0].expiresAt - w.clock.now).toBe(24 * 3_600_000)
  })

  it('sem PC configurado responde 409 sem gastar o fator', async () => {
    const w = await world()
    const res = await call(w, 'POST', '/roles/remote', {
      token: w.c,
      headers: { ...proof, 'x-totp-code': '000000' },
      body: { msgId: 'pedido-remoto-1', ciphertext: CIPHER }
    })
    expect(res.status).toBe(409)
  })
})

describe('mensagens', () => {
  it('qualquer aparelho fala com o PC; o PC fala com todos; o resto é 403', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    expect((await call(w, 'POST', '/control/send', { token: w.b, body: message(DEV_A) })).status).toBe(200)
    expect((await call(w, 'POST', '/control/send', { token: w.c, body: message(DEV_A) })).status).toBe(200)
    expect((await call(w, 'POST', '/control/send', { token: w.b, body: message(DEV_C) })).status).toBe(403)
    expect((await call(w, 'POST', '/control/send', { token: w.a, body: message(DEV_B) })).status).toBe(200)
  })

  it('só o PC pode pedir notificação, e com um dos códigos fixos', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const ok = await call(w, 'POST', '/control/send', {
      token: w.a,
      body: message(DEV_B, { notify: 'approval' })
    })
    expect(ok.status).toBe(200)
    expect(w.notified).toEqual([{ ids: [DEV_B], code: 'approval' }])
    const fromPhone = await call(w, 'POST', '/control/send', {
      token: w.b,
      body: message(DEV_A, { notify: 'ready' })
    })
    expect(fromPhone.status).toBe(403)
    const unknown = await call(w, 'POST', '/control/send', {
      token: w.a,
      body: message(DEV_B, { notify: 'qualquer texto' })
    })
    expect(unknown.status).toBe(400)
  })

  it('a caixa entrega uma vez', async () => {
    const w = await world()
    await makePc(w)
    await call(w, 'POST', '/control/send', { token: w.b, body: message(DEV_A) })
    const first = await json(await call(w, 'GET', '/control/inbox', { token: w.a }))
    expect((first.messages as unknown[]).length).toBe(1)
    const second = await json(await call(w, 'GET', '/control/inbox', { token: w.a }))
    expect(second.messages).toEqual([])
  })

  it('ttl acima de 10 min é recusado', async () => {
    const w = await world()
    await makePc(w)
    const res = await call(w, 'POST', '/control/send', {
      token: w.b,
      body: message(DEV_A, { ttlMs: 600_001 })
    })
    expect(res.status).toBe(400)
  })

  it('status: só o PC grava; só PC e controles leem', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const body = { msgId: 'status-0001', ciphertext: CIPHER }
    expect((await call(w, 'PUT', '/control/status', { token: w.b, body })).status).toBe(403)
    expect((await call(w, 'PUT', '/control/status', { token: w.a, body })).status).toBe(200)
    expect((await call(w, 'GET', '/control/status', { token: w.c })).status).toBe(403)
    const got = await json(await call(w, 'GET', '/control/status', { token: w.b }))
    expect(got).toMatchObject({ from: DEV_A, msgId: 'status-0001', ciphertext: CIPHER })
  })
})

describe('energia e ESP32', () => {
  async function powerToken(w: World): Promise<string> {
    const res = await call(w, 'POST', '/power-token', {
      token: w.a,
      headers: { ...proof, 'x-totp-code': w.totp() }
    })
    expect(res.status).toBe(200)
    return (await json(res)).token as string
  }

  it('o token do ESP32 só alcança /power/next e /power/state', async () => {
    const w = await world()
    await makePc(w)
    const esp = await powerToken(w)
    expect((await call(w, 'GET', '/pull', { token: esp })).status).toBe(401)
    expect((await call(w, 'GET', '/control/inbox', { token: esp })).status).toBe(401)
    expect((await call(w, 'GET', '/power/next', { token: w.a })).status).toBe(401)
    expect((await call(w, 'GET', '/power/next', { token: esp })).status).toBe(200)
  })

  it('só controles mandam comando, com prazo de até 2 min', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const esp = await powerToken(w)
    const at = w.clock.now
    const cmd = { cmd: 'wake', at, exp: at + 120_000, mac: MAC }
    expect((await call(w, 'POST', '/power/command', { token: w.c, body: cmd })).status).toBe(403)
    expect((await call(w, 'POST', '/power/command', { token: w.a, body: cmd })).status).toBe(403)
    expect(
      (await call(w, 'POST', '/power/command', { token: w.b, body: { ...cmd, exp: at + 120_001 } }))
        .status
    ).toBe(400)
    expect(
      (await call(w, 'POST', '/power/command', { token: w.b, body: { ...cmd, cmd: 'format' } })).status
    ).toBe(400)
    expect((await call(w, 'POST', '/power/command', { token: w.b, body: cmd })).status).toBe(200)

    const next = await json(await call(w, 'GET', '/power/next', { token: esp }))
    expect(next.command).toEqual({ cmd: 'wake', at, exp: at + 120_000, mac: MAC })
    expect((await json(await call(w, 'GET', '/power/next', { token: esp }))).command).toBeNull()

    const report = { pcPing: true, lastResult: 'ok', at: at + 5000, mac: MAC }
    expect((await call(w, 'POST', '/power/state', { token: esp, body: report })).status).toBe(200)
    const state = await json(await call(w, 'GET', '/power/state', { token: w.b }))
    expect(state.state).toMatchObject({ pcPing: true, lastResult: 'ok', mac: MAC })
    expect(state.lastCommand).toEqual({ cmd: 'wake', at })
  })

  it('comando vencido não sai para o ESP32', async () => {
    const w = await world()
    await makePc(w)
    await makeController(w, DEV_B)
    const esp = await powerToken(w)
    const at = w.clock.now
    await call(w, 'POST', '/power/command', {
      token: w.b,
      body: { cmd: 'shutdown', at, exp: at + 120_000, mac: MAC }
    })
    w.clock.now += 120_000
    expect((await json(await call(w, 'GET', '/power/next', { token: esp }))).command).toBeNull()
  })
})

describe('Worker sem as tabelas novas', () => {
  it('sem ControlDb responde 501 e o sync continua', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps, DEV_A)
    const res = await handle(req('GET', '/control/inbox', { token: a }), deps)
    expect(res.status).toBe(501)
    expect(await json(res)).toEqual({ error: 'control not deployed' })
    expect((await handle(req('GET', '/pull', { token: a }), deps)).status).toBe(200)
  })

  it('tabela ausente no D1 vira 501, não 500', async () => {
    const w = await world()
    w.control.getRoles = async () => {
      throw new Error('D1_ERROR: no such table: device_roles')
    }
    expect((await call(w, 'GET', '/roles/pc', { token: w.a })).status).toBe(501)
  })
})
