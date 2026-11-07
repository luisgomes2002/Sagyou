// @vitest-environment node
//
// The Worker routes run against an in-memory SyncDb. The server only ever sees
// opaque device ids, ciphertext and numbers; device tokens are stored as
// SHA-256 hex, and a revoked token answers 401 saying whether to wipe.
import { describe, expect, it } from 'vitest'
import { handle, MAX_BODY_BYTES, MAX_PULL_LIMIT, type RouteDeps } from '../routes'
import type { ChangeRow, PullResult } from '../db'
import {
  BASE,
  SETUP,
  DEV_A,
  DEV_B,
  DEV_C,
  PROOF,
  setup,
  req,
  json,
  sha256Hex,
  registerFirst,
  codeFromUri,
  enroll,
  pairSecond
} from './helpers'

describe('prova da chave e segundo fator', () => {
  it('o primeiro setup exige prova, e outro setup exige prova igual', async () => {
    const { db, deps } = setup()
    const body = { deviceId: DEV_A, nameCipher: 'eA==' }
    expect(
      (await handle(req('POST', '/setup', { headers: { 'x-setup-token': SETUP }, body }), deps))
        .status
    ).toBe(401)
    expect(db.devices.size).toBe(0)
    await registerFirst(deps)
    const second = { deviceId: DEV_B, nameCipher: 'eQ==' }
    expect(
      (
        await handle(
          req('POST', '/setup', { headers: { 'x-setup-token': SETUP }, body: second }),
          deps
        )
      ).status
    ).toBe(401)
    expect(
      (
        await handle(
          req('POST', '/setup', {
            headers: { 'x-setup-token': SETUP, 'x-key-proof': '2'.repeat(64) },
            body: second
          }),
          deps
        )
      ).status
    ).toBe(401)
    expect(db.devices.size).toBe(1)
  })

  it('revogar exige prova e apagar exige TOTP confirmado', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const path = `/devices/${DEV_B}/revoke`
    expect(
      (await handle(req('POST', path, { token: a, body: { wipe: false } }), deps)).status
    ).toBe(401)
    expect(
      (
        await handle(
          req('POST', path, {
            token: a,
            headers: { 'x-key-proof': '1'.repeat(64) },
            body: { wipe: true }
          }),
          deps
        )
      ).status
    ).toBe(401)
    expect(db.devices.get(DEV_B)?.revokedAt).toBeNull()
  })

  it('TOTP libera wipe e setup de recuperação, mas reserva funciona uma vez', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const { uri, code, backupCodes } = await enroll(deps, a)
    expect(db.auth?.totpCipher).not.toContain(new URL(uri).searchParams.get('secret'))
    const setupHeaders = { 'x-setup-token': SETUP, 'x-key-proof': PROOF }
    expect(
      (
        await handle(
          req('POST', '/setup', {
            headers: setupHeaders,
            body: { deviceId: DEV_C, nameCipher: 'eA==' }
          }),
          deps
        )
      ).status
    ).toBe(401)
    const recovered = await handle(
      req('POST', '/setup', {
        headers: { ...setupHeaders, 'x-totp-code': code },
        body: { deviceId: DEV_C, nameCipher: 'eA==' }
      }),
      deps
    )
    expect(recovered.status).toBe(200)
    const revoke = (factor: string): Promise<Response> =>
      handle(
        req('POST', `/devices/${DEV_B}/revoke`, {
          token: a,
          headers: { 'x-key-proof': PROOF, 'x-totp-code': factor },
          body: { wipe: true }
        }),
        deps
      )
    expect((await revoke(backupCodes[0])).status).toBe(200)
    expect((await revoke(backupCodes[0])).status).toBe(401)
    expect(db.devices.get(DEV_B)?.wipe).toBe(true)
  })

  it('duas revogações simultâneas não consomem o mesmo código reserva duas vezes', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const { backupCodes } = await enroll(deps, a)
    // Recovery setup always checks the factor, with a fresh device id per request.
    const recover = (id: string): Promise<Response> =>
      handle(
        req('POST', '/setup', {
          headers: { 'x-setup-token': SETUP, 'x-key-proof': PROOF, 'x-totp-code': backupCodes[0] },
          body: { deviceId: id, nameCipher: 'eA==' }
        }),
        deps
      )
    const results = await Promise.all([recover(DEV_C), recover('d'.repeat(32))])
    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
  })

  it('cinco códigos errados bloqueiam por 15 minutos', async () => {
    const { deps, clock } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const { uri, code } = await enroll(deps, a)
    const revoke = (factor: string): Promise<Response> =>
      handle(
        req('POST', `/devices/${DEV_B}/revoke`, {
          token: a,
          headers: { 'x-key-proof': PROOF, 'x-totp-code': factor },
          body: { wipe: true }
        }),
        deps
      )
    const wrong = code === '000000' ? '999999' : '000000'
    for (let i = 0; i < 4; i++) expect((await revoke(wrong)).status).toBe(401)
    expect((await revoke(wrong)).status).toBe(429)
    expect((await revoke(code)).status).toBe(429)
    clock.now += 15 * 60_000 + 1
    expect((await revoke(codeFromUri(uri, clock.now))).status).toBe(200)
  })
})

function push(deps: RouteDeps, token: string, ids: string[]): Promise<Response> {
  return handle(
    req('POST', '/push', {
      token,
      body: { batches: ids.map((batchId) => ({ batchId, ciphertext: btoa(`cifra-${batchId}`) })) }
    }),
    deps
  )
}

describe('autenticação', () => {
  it('sem token dá 401', async () => {
    const { deps } = setup()
    expect((await handle(req('GET', '/pull?since=0'), deps)).status).toBe(401)
    expect((await handle(req('GET', '/devices'), deps)).status).toBe(401)
    expect((await handle(req('GET', '/pull?since=0', { token: 'nao-existe' }), deps)).status).toBe(
      401
    )
  })

  it('token revogado dá 401 com revoked e wipe', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    const { code } = await enroll(deps, a)
    const rev = await handle(
      req('POST', `/devices/${DEV_B}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF, 'x-totp-code': code },
        body: { wipe: true }
      }),
      deps
    )
    expect(rev.status).toBe(200)
    const res = await handle(req('GET', '/pull?since=0', { token: b }), deps)
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ revoked: true, wipe: true })
  })

  it('revogar sem wipe responde wipe false', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await handle(
      req('POST', `/devices/${DEV_B}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: false }
      }),
      deps
    )
    const res = await handle(req('POST', '/push', { token: b, body: { batches: [] } }), deps)
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ revoked: true, wipe: false })
  })

  it('revogar um aparelho desconhecido dá 404 e exige wipe booleano', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const unknown = await handle(
      req('POST', `/devices/${DEV_C}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: false }
      }),
      deps
    )
    expect(unknown.status).toBe(404)
    const bad = await handle(
      req('POST', `/devices/${DEV_A}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: 'sim' }
      }),
      deps
    )
    expect(bad.status).toBe(400)
  })
})

describe('/setup', () => {
  it('SETUP_TOKEN errado dá 401 e não registra; o certo registra', async () => {
    const { db, deps } = setup()
    for (const headers of [{}, { 'x-setup-token': 'errado' }, { 'x-setup-token': SETUP + 'x' }]) {
      const res = await handle(
        req('POST', '/setup', { headers, body: { deviceId: DEV_A, nameCipher: 'eA==' } }),
        deps
      )
      expect(res.status).toBe(401)
    }
    expect(db.devices.size).toBe(0)
    await registerFirst(deps)
    expect([...db.devices.keys()]).toEqual([DEV_A])
  })

  it('sem SETUP_TOKEN configurado ninguém registra', async () => {
    const { db, deps } = setup()
    const res = await handle(
      req('POST', '/setup', {
        headers: { 'x-setup-token': '' },
        body: { deviceId: DEV_A, nameCipher: 'eA==' }
      }),
      { ...deps, setupToken: undefined }
    )
    expect(res.status).toBe(401)
    expect(db.devices.size).toBe(0)
  })

  it('recusa um deviceId que não é o id opaco (32 hex)', async () => {
    const { deps } = setup()
    const res = await handle(
      req('POST', '/setup', {
        headers: { 'x-setup-token': SETUP, 'x-key-proof': PROOF },
        body: { deviceId: 'device-da-etapa-1', nameCipher: 'eA==' }
      }),
      deps
    )
    expect(res.status).toBe(400)
  })

  it('o token tem 32 bytes em base64url', async () => {
    const { deps } = setup()
    const token = await registerFirst(deps)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('convites e /pair', () => {
  it('um convite funciona uma vez; a segunda vez dá 410', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a, DEV_B)
    const again = await handle(
      req('POST', '/pair', {
        body: { invite: `convite-${DEV_B}`, deviceId: DEV_C, nameCipher: 'eA==' }
      }),
      deps
    )
    expect(again.status).toBe(410)
  })

  it('um convite vencido dá 410', async () => {
    const { deps, clock } = setup()
    const a = await registerFirst(deps)
    const invite = 'convite-velho'
    await handle(
      req('POST', '/invites', { token: a, body: { inviteHash: await sha256Hex(invite) } }),
      deps
    )
    clock.now += 10 * 60 * 1000 + 1
    const res = await handle(
      req('POST', '/pair', { body: { invite, deviceId: DEV_B, nameCipher: 'eA==' } }),
      deps
    )
    expect(res.status).toBe(410)
  })

  it('um convite desconhecido dá 410', async () => {
    const { deps } = setup()
    await registerFirst(deps)
    const res = await handle(
      req('POST', '/pair', {
        body: { invite: 'nunca-criado', deviceId: DEV_B, nameCipher: 'eA==' }
      }),
      deps
    )
    expect(res.status).toBe(410)
  })

  it('criar convite exige token e um hash SHA-256 hex', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    expect(
      (await handle(req('POST', '/invites', { body: { inviteHash: 'f'.repeat(64) } }), deps)).status
    ).toBe(401)
    expect(
      (await handle(req('POST', '/invites', { token: a, body: { inviteHash: 'curto' } }), deps))
        .status
    ).toBe(400)
  })
})

describe('/push e /pull', () => {
  it('push seguido de pull devolve na ordem de seq, e since filtra', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    const pushed = await push(deps, a, ['l1', 'l2', 'l3'])
    expect(pushed.status).toBe(200)
    const { seqs } = (await json(pushed)) as { seqs: number[] }
    expect(seqs).toHaveLength(3)
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs)

    const all = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect(all.more).toBe(false)
    expect(all.changes).toEqual([
      { seq: seqs[0], device: DEV_A, batchId: 'l1', ciphertext: btoa('cifra-l1') },
      { seq: seqs[1], device: DEV_A, batchId: 'l2', ciphertext: btoa('cifra-l2') },
      { seq: seqs[2], device: DEV_A, batchId: 'l3', ciphertext: btoa('cifra-l3') }
    ])

    const tail = await json(await handle(req('GET', `/pull?since=${seqs[1]}`, { token: b }), deps))
    expect((tail.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['l3'])
  })

  it('limit é respeitado e põe more: true', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['1', '2', '3', '4', '5'])
    const first = await json(await handle(req('GET', '/pull?since=0&limit=2', { token: b }), deps))
    expect((first.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['1', '2'])
    expect(first.more).toBe(true)
    const last = (first.changes as ChangeRow[])[1].seq
    const rest = await json(
      await handle(req('GET', `/pull?since=${last}&limit=10`, { token: b }), deps)
    )
    expect((rest.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['3', '4', '5'])
    expect(rest.more).toBe(false)
  })

  it('o limit do pull é no máximo 20 (respostas de até ~7 MB)', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(
      deps,
      a,
      Array.from({ length: 25 }, (_, i) => `l${i}`)
    )
    expect(MAX_PULL_LIMIT).toBe(20)
    const over = await handle(req('GET', '/pull?since=0&limit=21', { token: b }), deps)
    expect(over.status).toBe(400)
    const max = await json(await handle(req('GET', '/pull?since=0&limit=20', { token: b }), deps))
    expect((max.changes as ChangeRow[]).length).toBe(20)
    expect(max.more).toBe(true)
    // Without limit, the default is the same 20.
    const plain = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect((plain.changes as ChangeRow[]).length).toBe(20)
  })

  it('o pull não devolve os lotes do próprio aparelho e o pedido seguinte confirma o cursor', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['de-a'])
    await push(deps, b, ['de-b'])
    const forA = await json(await handle(req('GET', '/pull?since=0', { token: a }), deps))
    expect((forA.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['de-b'])
    const forB = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect((forB.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['de-a'])
    // Both saw everything up to the last seq, own batches included...
    expect(forA.cursor).toBe(2)
    expect(forB.cursor).toBe(2)
    // ...but the server only records it once they ask from there.
    expect(db.devices.get(DEV_A)?.cursor).toBe(0)
    await handle(req('GET', '/pull?since=2', { token: a }), deps)
    await handle(req('GET', '/pull?since=2', { token: b }), deps)
    expect(db.devices.get(DEV_A)?.cursor).toBe(2)
    expect(db.devices.get(DEV_B)?.cursor).toBe(2)
  })

  it('com more, o cursor para no último lote devolvido', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['1', '2', '3'])
    const page = await json(await handle(req('GET', '/pull?since=0&limit=1', { token: b }), deps))
    expect(page.more).toBe(true)
    expect(page.cursor).toBe(1)
    await handle(req('GET', '/pull?since=1&limit=1', { token: b }), deps)
    expect(db.devices.get(DEV_B)?.cursor).toBe(1)
  })

  it('o device gravado vem do token, nunca do corpo', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await handle(
      req('POST', '/push', {
        token: a,
        body: { device: DEV_C, batches: [{ batchId: 'x', ciphertext: 'eA==', device: DEV_C }] }
      }),
      deps
    )
    expect(db.changes.map((c) => c.device)).toEqual([DEV_A])
  })

  it('reenviar o mesmo batchId devolve o mesmo seq sem duplicar', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const first = (await json(await push(deps, a, ['mesmo']))).seqs
    const second = (await json(await push(deps, a, ['mesmo']))).seqs
    expect(second).toEqual(first)
    expect(db.changes).toHaveLength(1)
  })

  it('recusa lote malformado com 400', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    for (const body of [
      {},
      { batches: 'x' },
      { batches: [{ batchId: '', ciphertext: 'eA==' }] },
      { batches: [{ batchId: 'ok', ciphertext: 'não é base64!' }] }
    ]) {
      expect((await handle(req('POST', '/push', { token: a, body }), deps)).status).toBe(400)
    }
    expect((await handle(req('POST', '/push', { token: a, raw: '{quebrado' }), deps)).status).toBe(
      400
    )
    expect((await handle(req('GET', '/pull?since=-1', { token: a }), deps)).status).toBe(400)
  })

  it('o corpo de 2 MB + 1 dá 413', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const raw = 'x'.repeat(MAX_BODY_BYTES + 1)
    const res = await handle(req('POST', '/push', { token: a, raw }), deps)
    expect(res.status).toBe(413)
    // Without a Content-Length header too (a streamed body).
    const enc = new TextEncoder().encode(raw)
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (let i = 0; i < enc.length; i += 65536) controller.enqueue(enc.slice(i, i + 65536))
        controller.close()
      }
    })
    const streamed = new Request(BASE + '/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${a}` },
      body: stream,
      duplex: 'half'
    } as RequestInit)
    expect((await handle(streamed, deps)).status).toBe(413)
    expect(db.changes).toHaveLength(0)
  })

  it('um corpo de exatamente 2 MB passa do limite de tamanho', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const prefix = '{"batches":[{"batchId":"g","ciphertext":"'
    const suffix = '"}]}'
    const fill = 'A'.repeat(MAX_BODY_BYTES - prefix.length - suffix.length)
    const res = await handle(req('POST', '/push', { token: a, raw: prefix + fill + suffix }), deps)
    expect(res.status).toBe(200)
  })
})

describe('/devices', () => {
  it('lista os aparelhos com nome cifrado, cursor e qual é este', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const body = await json(await handle(req('GET', '/devices', { token: a }), deps))
    const list = body.devices as Record<string, unknown>[]
    expect(list.map((d) => d.id).sort()).toEqual([DEV_A, DEV_B])
    const me = list.find((d) => d.id === DEV_A)
    expect(me).toMatchObject({
      current: true,
      nameCipher: 'bm9tZQ==',
      revokedAt: null,
      wipe: false
    })
    expect(list.find((d) => d.id === DEV_B)).toMatchObject({ current: false, cursor: 0 })
  })
})

describe('limpeza do histórico depois do retrato', () => {
  it('recusa substituir o retrato por outro que cobre menos mudanças', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await push(deps, a, ['um', 'dois'])
    const commit = async (snapshotId: string, seqUntil: number): Promise<Response> => {
      await handle(
        req('POST', '/snapshot/parts', {
          token: a,
          body: { snapshotId, index: 0, ciphertext: 'eA==' }
        }),
        deps
      )
      return handle(
        req('POST', '/snapshot/commit', { token: a, body: { snapshotId, seqUntil, parts: 1 } }),
        deps
      )
    }
    expect((await commit('retrato-1001', 2)).status).toBe(200)
    expect((await commit('retrato-1002', 1)).status).toBe(409)
    expect(db.snapshots[0].id).toBe('retrato-1001')
  })

  it('recusa retrato que diz cobrir mudanças que o servidor ainda não recebeu', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    await push(deps, a, ['um'])
    const snapshotId = 'retrato-futuro'
    await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: { snapshotId, index: 0, ciphertext: 'eA==' }
      }),
      deps
    )
    const res = await handle(
      req('POST', '/snapshot/commit', { token: a, body: { snapshotId, seqUntil: 99, parts: 1 } }),
      deps
    )
    expect(res.status).toBe(409)
  })

  it('mantém mudanças até todos os aparelhos ativos passarem do retrato', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['um', 'dois'])
    const id = 'retrato-1234'
    await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: { snapshotId: id, index: 0, ciphertext: 'eA==' }
      }),
      deps
    )
    await handle(
      req('POST', '/snapshot/commit', {
        token: a,
        body: { snapshotId: id, seqUntil: 2, parts: 1 }
      }),
      deps
    )
    expect(db.changes).toHaveLength(2)
    await handle(req('GET', '/pull?since=2', { token: a }), deps)
    expect(db.changes).toHaveLength(2)
    await handle(req('GET', '/pull?since=0', { token: b }), deps)
    expect(db.changes).toHaveLength(2)
    const after = await json(await handle(req('GET', '/pull?since=2', { token: b }), deps))
    expect(after.cursor).toBe(2)
    expect(db.changes).toHaveLength(0)
  })

  it('um aparelho revogado deixa de segurar a limpeza', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    await push(deps, a, ['um'])
    const id = 'retrato-5678'
    await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: { snapshotId: id, index: 0, ciphertext: 'eA==' }
      }),
      deps
    )
    await handle(
      req('POST', '/snapshot/commit', {
        token: a,
        body: { snapshotId: id, seqUntil: 1, parts: 1 }
      }),
      deps
    )
    await handle(req('GET', '/pull?since=1', { token: a }), deps)
    expect(db.changes).toHaveLength(1)
    await handle(
      req('POST', `/devices/${DEV_B}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: false }
      }),
      deps
    )
    expect(db.changes).toHaveLength(0)
  })
})

describe('segredos', () => {
  it('nenhuma resposta além da que entrega o token, nem o banco, contém o token em claro', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    const bodies: string[] = []
    const capture = async (r: Request): Promise<void> => {
      bodies.push(await (await handle(r, deps)).text())
    }
    await capture(
      req('POST', '/push', { token: a, body: { batches: [{ batchId: 'z', ciphertext: 'eA==' }] } })
    )
    await capture(req('GET', '/pull?since=0', { token: b }))
    await capture(req('GET', '/devices', { token: a }))
    await capture(req('POST', '/invites', { token: a, body: { inviteHash: 'e'.repeat(64) } }))
    await capture(
      req('POST', `/devices/${DEV_B}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: false }
      })
    )
    await capture(req('GET', '/pull?since=0', { token: b }))
    const dbDump = JSON.stringify({
      devices: [...db.devices.values()],
      changes: db.changes,
      invites: [...db.invites.entries()]
    })
    for (const token of [a, b]) {
      for (const text of bodies) {
        expect(text).not.toContain(token)
        expect(text).not.toContain(await sha256Hex(token))
      }
      expect(dbDump).not.toContain(token)
      expect(dbDump).toContain(await sha256Hex(token))
    }
  })
})

describe('retrato (item 7)', () => {
  it('recusa uma parte cifrada maior que 1,5 MB', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const res = await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: {
          snapshotId: 'retrato-grande',
          index: 0,
          ciphertext: 'A'.repeat(1_500_001)
        }
      }),
      deps
    )
    expect(res.status).toBe(400)
  })

  it('sobe partes, confirma, e outro aparelho baixa', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['1', '2', '3', '4', '5', '6', '7'])
    const id = '6f1c2a4e-1b2c-4d3e-8f9a-0123456789ab'
    expect((await handle(req('GET', '/snapshot', { token: b }), deps)).status).toBe(404)
    for (const index of [0, 1]) {
      const res = await handle(
        req('POST', '/snapshot/parts', {
          token: a,
          body: { snapshotId: id, index, ciphertext: btoa(`parte-${index}`) }
        }),
        deps
      )
      expect(res.status).toBe(200)
    }
    const commit = await handle(
      req('POST', '/snapshot/commit', {
        token: a,
        body: { snapshotId: id, seqUntil: 7, parts: 2 }
      }),
      deps
    )
    expect(commit.status).toBe(200)
    const meta = await json(await handle(req('GET', '/snapshot', { token: b }), deps))
    expect(meta).toEqual({ snapshotId: id, seqUntil: 7, parts: 2, device: DEV_A })
    const part = await json(await handle(req('GET', '/snapshot/parts/1', { token: b }), deps))
    expect(part).toEqual({ ciphertext: btoa('parte-1') })
    expect((await handle(req('GET', '/snapshot/parts/2', { token: b }), deps)).status).toBe(404)
  })

  it('confirmar com parte faltando dá 409', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const id = '00000000-0000-4000-8000-000000000001'
    await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: { snapshotId: id, index: 0, ciphertext: 'eA==' }
      }),
      deps
    )
    const res = await handle(
      req('POST', '/snapshot/commit', {
        token: a,
        body: { snapshotId: id, seqUntil: 0, parts: 2 }
      }),
      deps
    )
    expect(res.status).toBe(409)
    expect((await handle(req('GET', '/snapshot', { token: a }), deps)).status).toBe(404)
  })

  it('um retrato novo confirmado substitui o anterior', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await push(deps, a, ['um'])
    const ids = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']
    for (const [n, id] of ids.entries()) {
      await handle(
        req('POST', '/snapshot/parts', {
          token: a,
          body: { snapshotId: id, index: 0, ciphertext: 'eA==' }
        }),
        deps
      )
      await handle(
        req('POST', '/snapshot/commit', {
          token: a,
          body: { snapshotId: id, seqUntil: n, parts: 1 }
        }),
        deps
      )
    }
    const meta = await json(await handle(req('GET', '/snapshot', { token: a }), deps))
    expect(meta.snapshotId).toBe(ids[1])
    expect(db.parts.map((p) => p.snapshotId)).toEqual([ids[1]])
    // A part asked for a replaced snapshot is refused rather than mixed in.
    const stale = await handle(
      req('GET', `/snapshot/parts/0?snapshotId=${ids[0]}`, { token: a }),
      deps
    )
    expect(stale.status).toBe(409)
  })
})

describe('rotas', () => {
  it('rota desconhecida dá 404 e método errado dá 405', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    expect((await handle(req('GET', '/nada', { token: a }), deps)).status).toBe(404)
    expect((await handle(req('GET', '/push', { token: a }), deps)).status).toBe(405)
  })

  it('um erro do banco vira 500 sem detalhe', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    db.pullChanges = async (): Promise<PullResult> => {
      throw new Error('D1_ERROR: segredo interno')
    }
    const res = await handle(req('GET', '/pull?since=0', { token: a }), deps)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('segredo interno')
  })
})

describe('achados de revisão', () => {
  it('trocar o autenticador exige o fator atual; o primeiro cadastro não', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    // First enrollment: no TOTP yet, so token + key proof are enough.
    const { uri, backupCodes } = await enroll(deps, a)
    const before = db.auth?.totpCipher
    const reenroll = (headers: Record<string, string>): Promise<Response> =>
      handle(
        req('POST', '/totp/enroll', { token: b, headers: { 'x-key-proof': PROOF, ...headers } }),
        deps
      )
    expect((await reenroll({})).status).toBe(401)
    expect(db.auth?.pendingTotpCipher).toBeNull()
    // Nothing pending, so confirm cannot promote anything.
    expect(
      (
        await handle(
          req('POST', '/totp/confirm', {
            token: b,
            headers: { 'x-key-proof': PROOF },
            body: { code: '123456' }
          }),
          deps
        )
      ).status
    ).toBe(409)
    expect((await reenroll({ 'x-totp-code': '000000' })).status).toBe(401)
    expect(db.auth?.pendingTotpCipher).toBeNull()
    // With the current code it works, and confirm promotes the new secret.
    const ok = await reenroll({ 'x-totp-code': codeFromUri(uri, deps.now()) })
    expect(ok.status).toBe(200)
    const newUri = (await json(ok)).uri as string
    const confirmed = await handle(
      req('POST', '/totp/confirm', {
        token: b,
        headers: { 'x-key-proof': PROOF },
        body: { code: codeFromUri(newUri, deps.now()) }
      }),
      deps
    )
    expect(confirmed.status).toBe(200)
    expect(db.auth?.totpCipher).not.toBe(before)
    // A backup code is also a valid current factor, once.
    const fresh = (await json(confirmed)).backupCodes as string[]
    expect(fresh).not.toEqual(backupCodes)
    expect((await reenroll({ 'x-totp-code': fresh[0] })).status).toBe(200)
    expect((await reenroll({ 'x-totp-code': fresh[0] })).status).toBe(401)
  })

  // The desktop sent no factor when replacing the authenticator, and every click
  // counted toward the lock. An absent factor is refused without counting.
  it('pedir troca sem mandar fator nenhum não conta como erro', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const { code } = await enroll(deps, a)
    const reenroll = (headers: Record<string, string>): Promise<Response> =>
      handle(
        req('POST', '/totp/enroll', { token: a, headers: { 'x-key-proof': PROOF, ...headers } }),
        deps
      )
    for (let i = 0; i < 6; i++) {
      const res = await reenroll({})
      expect(res.status).toBe(401)
      expect((await json(res)).error).toBe('factor required')
    }
    expect((await reenroll({ 'x-totp-code': code })).status).toBe(200)
  })

  it('reenrolar errando cinco vezes bloqueia', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const { code } = await enroll(deps, a)
    const wrong = code === '000000' ? '999999' : '000000'
    const reenroll = (factor: string): Promise<Response> =>
      handle(
        req('POST', '/totp/enroll', {
          token: a,
          headers: { 'x-key-proof': PROOF, 'x-totp-code': factor }
        }),
        deps
      )
    for (let i = 0; i < 4; i++) expect((await reenroll(wrong)).status).toBe(401)
    expect((await reenroll(wrong)).status).toBe(429)
    expect((await reenroll(code)).status).toBe(429)
  })

  async function invite(deps: RouteDeps, token: string, value: string): Promise<void> {
    const res = await handle(
      req('POST', '/invites', { token, body: { inviteHash: await sha256Hex(value) } }),
      deps
    )
    expect(res.status).toBe(200)
  }

  function pair(deps: RouteDeps, value: string, deviceId: string): Promise<Response> {
    return handle(
      req('POST', '/pair', { body: { invite: value, deviceId, nameCipher: 'eA==' } }),
      deps
    )
  }

  it('/pair com o id de um aparelho ativo dá 409 e não derruba o token dele', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    const tokenHash = db.devices.get(DEV_B)?.tokenHash
    await invite(deps, a, 'convite-de-novo')
    expect((await pair(deps, 'convite-de-novo', DEV_B)).status).toBe(409)
    expect(db.devices.get(DEV_B)?.tokenHash).toBe(tokenHash)
    expect((await handle(req('GET', '/devices', { token: b }), deps)).status).toBe(200)
    // The refused id did not burn the invite.
    expect((await pair(deps, 'convite-de-novo', DEV_C)).status).toBe(200)
  })

  it('/setup com o id de um aparelho ativo dá 409', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const { code } = await enroll(deps, a)
    const tokenHash = db.devices.get(DEV_B)?.tokenHash
    const res = await handle(
      req('POST', '/setup', {
        headers: { 'x-setup-token': SETUP, 'x-key-proof': PROOF, 'x-totp-code': code },
        body: { deviceId: DEV_B, nameCipher: 'eA==' }
      }),
      deps
    )
    expect(res.status).toBe(409)
    expect(db.devices.get(DEV_B)?.tokenHash).toBe(tokenHash)
  })

  it('/pair não desfaz a revogação com apagamento pendente', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    const { code } = await enroll(deps, a)
    expect(
      (
        await handle(
          req('POST', `/devices/${DEV_B}/revoke`, {
            token: a,
            headers: { 'x-key-proof': PROOF, 'x-totp-code': code },
            body: { wipe: true }
          }),
          deps
        )
      ).status
    ).toBe(200)
    await invite(deps, a, 'convite-volta')
    expect((await pair(deps, 'convite-volta', DEV_B)).status).toBe(409)
    expect(db.devices.get(DEV_B)?.revokedAt).not.toBeNull()
    expect(db.devices.get(DEV_B)?.wipe).toBe(true)
  })

  it('/pair reativa um aparelho revogado sem apagamento', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    await pairSecond(deps, a)
    await handle(
      req('POST', `/devices/${DEV_B}/revoke`, {
        token: a,
        headers: { 'x-key-proof': PROOF },
        body: { wipe: false }
      }),
      deps
    )
    await invite(deps, a, 'convite-volta')
    const res = await pair(deps, 'convite-volta', DEV_B)
    expect(res.status).toBe(200)
    expect(db.devices.get(DEV_B)?.revokedAt).toBeNull()
    expect(db.devices.get(DEV_B)?.cursor).toBe(0)
  })

  it('o pull só confirma a página anterior: um retrato novo não poda o que o aparelho não aplicou', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['um', 'dois'])
    // B reads the page but never asks again (it fails before applying).
    const page = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect(page.cursor).toBe(2)
    expect(db.devices.get(DEV_B)?.cursor).toBe(0)
    await handle(req('GET', '/pull?since=0', { token: a }), deps)
    await handle(req('GET', '/pull?since=2', { token: a }), deps)
    const id = 'retrato-9999'
    await handle(
      req('POST', '/snapshot/parts', {
        token: a,
        body: { snapshotId: id, index: 0, ciphertext: 'eA==' }
      }),
      deps
    )
    expect(
      (
        await handle(
          req('POST', '/snapshot/commit', {
            token: a,
            body: { snapshotId: id, seqUntil: 2, parts: 1 }
          }),
          deps
        )
      ).status
    ).toBe(200)
    expect(db.changes).toHaveLength(2)
    // B retries from where it stood and still gets both changes.
    const retry = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect((retry.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['um', 'dois'])
    // The next request confirms it, and only then the log is compacted.
    await handle(req('GET', '/pull?since=2', { token: b }), deps)
    expect(db.devices.get(DEV_B)?.cursor).toBe(2)
    expect(db.changes).toHaveLength(0)
  })
})
