// @vitest-environment node
//
// The Worker routes run against an in-memory SyncDb. The server only ever sees
// opaque device ids, ciphertext and numbers; device tokens are stored as
// SHA-256 hex, and a revoked token answers 401 saying whether to wipe.
import { describe, expect, it } from 'vitest'
import { handle, MAX_BODY_BYTES, type RouteDeps } from '../routes'
import type {
  ChangeInput,
  ChangeRow,
  DeviceRow,
  PullResult,
  SnapshotPartInput,
  SnapshotRow,
  SyncDb
} from '../db'

const BASE = 'https://sync.example.workers.dev'
const SETUP = 'setup-secret-de-teste'
const DEV_A = 'a'.repeat(32)
const DEV_B = 'b'.repeat(32)
const DEV_C = 'c'.repeat(32)

interface PartRow {
  snapshotId: string
  index: number
  device: string
  ciphertext: string
  createdAt: number
}

class MemoryDb implements SyncDb {
  devices = new Map<string, DeviceRow>()
  changes: (ChangeRow & { size: number; createdAt: number })[] = []
  invites = new Map<string, { expiresAt: number; usedAt: number | null }>()
  snapshots: SnapshotRow[] = []
  parts: PartRow[] = []
  private nextSeq = 1

  async deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    for (const d of this.devices.values()) if (d.tokenHash === tokenHash) return { ...d }
    return null
  }

  async registerDevice(d: {
    id: string
    tokenHash: string
    nameCipher: string
    now: number
  }): Promise<void> {
    this.devices.set(d.id, {
      id: d.id,
      tokenHash: d.tokenHash,
      nameCipher: d.nameCipher,
      lastSeen: d.now,
      revokedAt: null,
      wipe: false,
      cursor: 0
    })
  }

  async touchDevice(id: string, now: number): Promise<void> {
    const d = this.devices.get(id)
    if (d) d.lastSeen = now
  }

  async listDevices(): Promise<DeviceRow[]> {
    return [...this.devices.values()].map((d) => ({ ...d }))
  }

  async revokeDevice(id: string, wipe: boolean, now: number): Promise<boolean> {
    const d = this.devices.get(id)
    if (!d) return false
    d.revokedAt = d.revokedAt ?? now
    d.wipe = wipe
    return true
  }

  async insertInvite(hash: string, expiresAt: number, now: number): Promise<void> {
    for (const [h, inv] of this.invites) if (inv.expiresAt <= now) this.invites.delete(h)
    this.invites.set(hash, { expiresAt, usedAt: null })
  }

  async consumeInvite(hash: string, now: number): Promise<boolean> {
    const inv = this.invites.get(hash)
    if (!inv || inv.usedAt !== null || inv.expiresAt <= now) return false
    inv.usedAt = now
    return true
  }

  async insertChanges(device: string, items: ChangeInput[], now: number): Promise<number[]> {
    return items.map((it) => {
      const dup = this.changes.find((c) => c.device === device && c.batchId === it.batchId)
      if (dup) return dup.seq
      const seq = this.nextSeq++
      this.changes.push({
        seq,
        device,
        batchId: it.batchId,
        ciphertext: it.ciphertext,
        size: it.size,
        createdAt: now
      })
      return seq
    })
  }

  async pullChanges(device: string, since: number, limit: number): Promise<PullResult> {
    const maxSeq = this.changes.reduce((m, c) => Math.max(m, c.seq), 0)
    const rows = this.changes
      .filter((c) => c.seq > since && c.seq <= maxSeq && c.device !== device)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map(({ seq, device: dev, batchId, ciphertext }) => ({
        seq,
        device: dev,
        batchId,
        ciphertext
      }))
    return { rows, maxSeq }
  }

  async setCursor(id: string, cursor: number): Promise<void> {
    const d = this.devices.get(id)
    if (d) d.cursor = cursor
  }

  async putSnapshotPart(p: SnapshotPartInput): Promise<boolean> {
    if (this.snapshots.some((s) => s.id === p.snapshotId)) return false
    const owner = this.parts.find((x) => x.snapshotId === p.snapshotId)
    if (owner && owner.device !== p.device) return false
    this.parts = this.parts.filter((x) => !(x.snapshotId === p.snapshotId && x.index === p.index))
    this.parts.push({
      snapshotId: p.snapshotId,
      index: p.index,
      device: p.device,
      ciphertext: p.ciphertext,
      createdAt: p.now
    })
    return true
  }

  async commitSnapshot(s: {
    snapshotId: string
    seqUntil: number
    parts: number
    device: string
    now: number
  }): Promise<boolean> {
    const mine = this.parts.filter(
      (x) => x.snapshotId === s.snapshotId && x.device === s.device && x.index < s.parts
    )
    if (mine.length !== s.parts) return false
    if (this.snapshots.some((x) => x.id === s.snapshotId)) return false
    this.parts = this.parts.filter((x) => x.snapshotId === s.snapshotId && x.index < s.parts)
    this.snapshots = [
      { id: s.snapshotId, seqUntil: s.seqUntil, parts: s.parts, device: s.device, createdAt: s.now }
    ]
    return true
  }

  async currentSnapshot(): Promise<SnapshotRow | null> {
    return this.snapshots[0] ? { ...this.snapshots[0] } : null
  }

  async snapshotPart(snapshotId: string, index: number): Promise<string | null> {
    return (
      this.parts.find((x) => x.snapshotId === snapshotId && x.index === index)?.ciphertext ?? null
    )
  }
}

function setup(start = 1_700_000_000_000): {
  db: MemoryDb
  deps: RouteDeps
  clock: { now: number }
} {
  const db = new MemoryDb()
  const clock = { now: start }
  const deps: RouteDeps = { db, setupToken: SETUP, now: () => clock.now }
  return { db, deps, clock }
}

function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}
): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: string | undefined
  if (opts.raw !== undefined) body = opts.raw
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  return new Request(BASE + path, { method, headers, body })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function registerFirst(deps: RouteDeps, deviceId = DEV_A): Promise<string> {
  const res = await handle(
    req('POST', '/setup', {
      headers: { 'x-setup-token': SETUP },
      body: { deviceId, nameCipher: 'bm9tZQ==' }
    }),
    deps
  )
  expect(res.status).toBe(200)
  const { token } = await json(res)
  expect(typeof token).toBe('string')
  return token as string
}

async function pairSecond(deps: RouteDeps, tokenA: string, deviceId = DEV_B): Promise<string> {
  const invite = `convite-${deviceId}`
  const inv = await handle(
    req('POST', '/invites', { token: tokenA, body: { inviteHash: await sha256Hex(invite) } }),
    deps
  )
  expect(inv.status).toBe(200)
  const res = await handle(
    req('POST', '/pair', { body: { invite, deviceId, nameCipher: 'b3V0cm8=' } }),
    deps
  )
  expect(res.status).toBe(200)
  return (await json(res)).token as string
}

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
    const rev = await handle(
      req('POST', `/devices/${DEV_B}/revoke`, { token: a, body: { wipe: true } }),
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
    await handle(req('POST', `/devices/${DEV_B}/revoke`, { token: a, body: { wipe: false } }), deps)
    const res = await handle(req('POST', '/push', { token: b, body: { batches: [] } }), deps)
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ revoked: true, wipe: false })
  })

  it('revogar um aparelho desconhecido dá 404 e exige wipe booleano', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const unknown = await handle(
      req('POST', `/devices/${DEV_C}/revoke`, { token: a, body: { wipe: false } }),
      deps
    )
    expect(unknown.status).toBe(404)
    const bad = await handle(
      req('POST', `/devices/${DEV_A}/revoke`, { token: a, body: { wipe: 'sim' } }),
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
        headers: { 'x-setup-token': SETUP },
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

  it('o pull não devolve os lotes do próprio aparelho e atualiza o cursor', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
    await push(deps, a, ['de-a'])
    await push(deps, b, ['de-b'])
    const forA = await json(await handle(req('GET', '/pull?since=0', { token: a }), deps))
    expect((forA.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['de-b'])
    const forB = await json(await handle(req('GET', '/pull?since=0', { token: b }), deps))
    expect((forB.changes as ChangeRow[]).map((c) => c.batchId)).toEqual(['de-a'])
    // Both saw everything up to the last seq, own batches included.
    expect(forA.cursor).toBe(2)
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
    await capture(req('POST', `/devices/${DEV_B}/revoke`, { token: a, body: { wipe: true } }))
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
  it('sobe partes, confirma, e outro aparelho baixa', async () => {
    const { deps } = setup()
    const a = await registerFirst(deps)
    const b = await pairSecond(deps, a)
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
        body: { snapshotId: id, seqUntil: 1, parts: 2 }
      }),
      deps
    )
    expect(res.status).toBe(409)
    expect((await handle(req('GET', '/snapshot', { token: a }), deps)).status).toBe(404)
  })

  it('um retrato novo confirmado substitui o anterior', async () => {
    const { db, deps } = setup()
    const a = await registerFirst(deps)
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
