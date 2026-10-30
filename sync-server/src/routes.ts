// HTTP routes of the sync Worker, as one pure function over a `SyncDb`.
//
// The server is a dumb relay: it stores opaque device ids, ciphertext and
// numbers, never a record id, payload, device name in clear or a token. Every
// route but /setup and /pair takes `Authorization: Bearer <device token>`; a
// revoked token gets 401 `{revoked: true, wipe}`. Only Web APIs are used
// (crypto.subtle, Request/Response), so this runs both on Workers and Node.
import type { DeviceRow, SyncDb } from './db'

export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const INVITE_TTL_MS = 10 * 60 * 1000
export const DEFAULT_PULL_LIMIT = 50
export const MAX_PULL_LIMIT = 200
/** Upper bound on snapshot parts (1.5 MB each: ~15 GB, far above any real store). */
export const MAX_SNAPSHOT_PARTS = 10000
/** `last_seen` is rewritten at most once a minute per device. */
const TOUCH_EVERY_MS = 60 * 1000

export interface RouteDeps {
  db: SyncDb
  /** `env.SETUP_TOKEN`; when absent or empty, /setup refuses everyone. */
  setupToken: string | undefined
  now: () => number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(`http ${status}`)
  }
}

const OPAQUE_ID = /^[0-9a-f]{32}$/
const HEX_SHA256 = /^[0-9a-f]{64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const BATCH_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const SNAPSHOT_ID = /^[0-9A-Za-z-]{8,64}$/

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function bad(message: string): HttpError {
  return new HttpError(400, { error: message })
}

// ---- Bytes and hashing ----------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return new Uint8Array(digest)
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await sha256(text))
}

/**
 * Constant-time comparison: both sides are hashed first, so the loop always runs
 * over 32 bytes whatever the input lengths, and it never exits early.
 */
export async function timingSafeEqualText(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i]
  return diff === 0
}

/** 32 random bytes in base64url (43 characters). */
export function newDeviceToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

// ---- Body reading -------------------------------------------------------------

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new HttpError(413, { error: 'body too large' })
  }
  const chunks: Uint8Array[] = []
  let total = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new HttpError(413, { error: 'body too large' })
      }
      chunks.push(value)
    }
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(all))
  } catch {
    throw bad('invalid json')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw bad('body must be an object')
  }
  return parsed as Record<string, unknown>
}

function str(body: Record<string, unknown>, key: string, pattern: RegExp, max: number): string {
  const v = body[key]
  if (typeof v !== 'string' || v.length === 0 || v.length > max || !pattern.test(v)) {
    throw bad(`invalid ${key}`)
  }
  return v
}

function int(value: unknown, key: string, min: number, max: number): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) {
    throw bad(`invalid ${key}`)
  }
  return n
}

// ---- Auth -----------------------------------------------------------------------

async function authenticate(request: Request, deps: RouteDeps): Promise<DeviceRow> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(header)
  if (!match) throw new HttpError(401, { error: 'unauthorized' })
  const device = await deps.db.deviceByTokenHash(await sha256Hex(match[1]))
  if (!device) throw new HttpError(401, { error: 'unauthorized' })
  if (device.revokedAt !== null) throw new HttpError(401, { revoked: true, wipe: device.wipe })
  const now = deps.now()
  if (now - device.lastSeen >= TOUCH_EVERY_MS) await deps.db.touchDevice(device.id, now)
  return device
}

/** /setup and /pair always carry the opaque id, never the app's own device id. */
function parseDevice(body: Record<string, unknown>): { id: string; nameCipher: string } {
  return {
    id: str(body, 'deviceId', OPAQUE_ID, 32),
    nameCipher: str(body, 'nameCipher', BASE64, 4096)
  }
}

async function issueToken(
  deps: RouteDeps,
  d: { id: string; nameCipher: string }
): Promise<Response> {
  const token = newDeviceToken()
  await deps.db.registerDevice({
    id: d.id,
    tokenHash: await sha256Hex(token),
    nameCipher: d.nameCipher,
    now: deps.now()
  })
  return reply(200, { token })
}

// ---- Routes ---------------------------------------------------------------------

async function setupRoute(request: Request, deps: RouteDeps): Promise<Response> {
  const given = request.headers.get('x-setup-token') ?? ''
  const expected = deps.setupToken ?? ''
  // Compare even when unconfigured, so timing does not reveal that state.
  const same = await timingSafeEqualText(given, expected)
  if (!same || expected.length === 0) throw new HttpError(401, { error: 'unauthorized' })
  const body = await readJson(request)
  return issueToken(deps, parseDevice(body))
}

async function pairRoute(request: Request, deps: RouteDeps): Promise<Response> {
  const body = await readJson(request)
  const invite = body.invite
  if (typeof invite !== 'string' || invite.length === 0 || invite.length > 512) {
    throw bad('invalid invite')
  }
  const device = parseDevice(body)
  if (!(await deps.db.consumeInvite(await sha256Hex(invite), deps.now()))) {
    throw new HttpError(410, { error: 'invite expired or used' })
  }
  return issueToken(deps, device)
}

async function invitesRoute(request: Request, deps: RouteDeps): Promise<Response> {
  await authenticate(request, deps)
  const body = await readJson(request)
  const hash = str(body, 'inviteHash', HEX_SHA256, 64)
  const now = deps.now()
  const expiresAt = now + INVITE_TTL_MS
  await deps.db.insertInvite(hash, expiresAt, now)
  return reply(200, { expiresAt })
}

async function pushRoute(request: Request, deps: RouteDeps): Promise<Response> {
  const device = await authenticate(request, deps)
  const body = await readJson(request)
  if (!Array.isArray(body.batches)) throw bad('invalid batches')
  const items = body.batches.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) throw bad('invalid batch')
    const b = raw as Record<string, unknown>
    const ciphertext = str(b, 'ciphertext', BASE64, MAX_BODY_BYTES)
    return { batchId: str(b, 'batchId', BATCH_ID, 128), ciphertext, size: ciphertext.length }
  })
  // The device comes from the token, never from the body.
  const seqs = await deps.db.insertChanges(device.id, items, deps.now())
  return reply(200, { seqs })
}

async function pullRoute(request: Request, url: URL, deps: RouteDeps): Promise<Response> {
  const device = await authenticate(request, deps)
  const since = int(url.searchParams.get('since') ?? '0', 'since', 0, Number.MAX_SAFE_INTEGER)
  const limit = int(
    url.searchParams.get('limit') ?? String(DEFAULT_PULL_LIMIT),
    'limit',
    1,
    MAX_PULL_LIMIT
  )
  const { rows, maxSeq } = await deps.db.pullChanges(device.id, since, limit + 1)
  const more = rows.length > limit
  const changes = more ? rows.slice(0, limit) : rows
  // The device holds everything up to the last page row, or, on the final page,
  // up to the whole log (its own batches it never needs to pull).
  const cursor = more ? changes[changes.length - 1].seq : maxSeq
  if (cursor !== device.cursor) await deps.db.setCursor(device.id, cursor)
  return reply(200, { changes, more, cursor })
}

async function devicesRoute(request: Request, deps: RouteDeps): Promise<Response> {
  const me = await authenticate(request, deps)
  const list = await deps.db.listDevices()
  return reply(200, {
    devices: list.map((d) => ({
      id: d.id,
      nameCipher: d.nameCipher,
      lastSeen: d.lastSeen,
      revokedAt: d.revokedAt,
      wipe: d.wipe,
      cursor: d.cursor,
      current: d.id === me.id
    }))
  })
}

async function revokeRoute(request: Request, id: string, deps: RouteDeps): Promise<Response> {
  await authenticate(request, deps)
  const body = await readJson(request)
  if (typeof body.wipe !== 'boolean') throw bad('invalid wipe')
  if (!(await deps.db.revokeDevice(id, body.wipe, deps.now()))) {
    throw new HttpError(404, { error: 'not found' })
  }
  return reply(200, { ok: true })
}

async function snapshotPartPut(request: Request, deps: RouteDeps): Promise<Response> {
  const device = await authenticate(request, deps)
  const body = await readJson(request)
  const ok = await deps.db.putSnapshotPart({
    snapshotId: str(body, 'snapshotId', SNAPSHOT_ID, 64),
    index: int(body.index, 'index', 0, MAX_SNAPSHOT_PARTS - 1),
    ciphertext: str(body, 'ciphertext', BASE64, MAX_BODY_BYTES),
    device: device.id,
    now: deps.now()
  })
  if (!ok) throw new HttpError(409, { error: 'snapshot closed' })
  return reply(200, { ok: true })
}

async function snapshotCommit(request: Request, deps: RouteDeps): Promise<Response> {
  const device = await authenticate(request, deps)
  const body = await readJson(request)
  const ok = await deps.db.commitSnapshot({
    snapshotId: str(body, 'snapshotId', SNAPSHOT_ID, 64),
    seqUntil: int(body.seqUntil, 'seqUntil', 0, Number.MAX_SAFE_INTEGER),
    parts: int(body.parts, 'parts', 1, MAX_SNAPSHOT_PARTS),
    device: device.id,
    now: deps.now()
  })
  if (!ok) throw new HttpError(409, { error: 'snapshot incomplete' })
  return reply(200, { ok: true })
}

async function snapshotGet(request: Request, deps: RouteDeps): Promise<Response> {
  await authenticate(request, deps)
  const snap = await deps.db.currentSnapshot()
  if (!snap) throw new HttpError(404, { error: 'no snapshot' })
  return reply(200, {
    snapshotId: snap.id,
    seqUntil: snap.seqUntil,
    parts: snap.parts,
    device: snap.device
  })
}

async function snapshotPartGet(
  request: Request,
  url: URL,
  rawIndex: string,
  deps: RouteDeps
): Promise<Response> {
  await authenticate(request, deps)
  const index = int(rawIndex, 'index', 0, MAX_SNAPSHOT_PARTS - 1)
  const snap = await deps.db.currentSnapshot()
  if (!snap) throw new HttpError(404, { error: 'no snapshot' })
  const wanted = url.searchParams.get('snapshotId')
  if (wanted !== null && wanted !== snap.id) {
    throw new HttpError(409, { error: 'snapshot replaced' })
  }
  if (index >= snap.parts) throw new HttpError(404, { error: 'not found' })
  const ciphertext = await deps.db.snapshotPart(snap.id, index)
  if (ciphertext === null) throw new HttpError(404, { error: 'not found' })
  return reply(200, { ciphertext })
}

type Handler = (request: Request, url: URL, deps: RouteDeps, params: string[]) => Promise<Response>

const ROUTES: { pattern: RegExp; methods: Record<string, Handler> }[] = [
  { pattern: /^\/setup$/, methods: { POST: (r, _u, d) => setupRoute(r, d) } },
  { pattern: /^\/pair$/, methods: { POST: (r, _u, d) => pairRoute(r, d) } },
  { pattern: /^\/invites$/, methods: { POST: (r, _u, d) => invitesRoute(r, d) } },
  { pattern: /^\/push$/, methods: { POST: (r, _u, d) => pushRoute(r, d) } },
  { pattern: /^\/pull$/, methods: { GET: (r, u, d) => pullRoute(r, u, d) } },
  { pattern: /^\/devices$/, methods: { GET: (r, _u, d) => devicesRoute(r, d) } },
  {
    pattern: /^\/devices\/([0-9a-f]{32})\/revoke$/,
    methods: { POST: (r, _u, d, p) => revokeRoute(r, p[0], d) }
  },
  { pattern: /^\/snapshot$/, methods: { GET: (r, _u, d) => snapshotGet(r, d) } },
  { pattern: /^\/snapshot\/parts$/, methods: { POST: (r, _u, d) => snapshotPartPut(r, d) } },
  {
    pattern: /^\/snapshot\/parts\/(\d{1,5})$/,
    methods: { GET: (r, u, d, p) => snapshotPartGet(r, u, p[0], d) }
  },
  { pattern: /^\/snapshot\/commit$/, methods: { POST: (r, _u, d) => snapshotCommit(r, d) } }
]

export async function handle(request: Request, deps: RouteDeps): Promise<Response> {
  try {
    const url = new URL(request.url)
    for (const route of ROUTES) {
      const match = route.pattern.exec(url.pathname)
      if (!match) continue
      const handler = route.methods[request.method]
      if (!handler) return reply(405, { error: 'method not allowed' })
      return await handler(request, url, deps, match.slice(1))
    }
    return reply(404, { error: 'not found' })
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, err.body)
    // Never echo the cause: a D1 message can carry SQL or values.
    return reply(500, { error: 'internal error' })
  }
}
