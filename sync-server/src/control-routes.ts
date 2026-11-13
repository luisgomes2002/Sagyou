// Remote-control routes of the Worker (spec docs/specs/2026-11-03-controle-remoto-app.md).
//
// The Worker relays sealed envelopes and enforces who may talk to whom:
//   - one device is the controlled PC ('pc'), set with key proof + second factor;
//   - authorized phones are 'controller's, added by the PC (key proof) or, from
//     afar, by the phone itself with key proof + second factor (/roles/remote);
//   - only controllers may queue a power command; only the ESP32 token may take it.
// It never opens a message: the PC checks every request's Ed25519 signature,
// and the ESP32 checks every command's HMAC.
//
// The helpers come from routes.ts by injection, so both files share one
// HttpError and one authentication without a circular import.
import type { DeviceRow } from './db'
import type { ControlDb } from './control-db'

// A copy of NOTIFY_CODES of @sagyou/core/control/notify (the Worker does not depend on the
// core); push.test.ts keeps both equal.
export const NOTIFY_CODES = [
  'ready',
  'shutdown-failed',
  'server-ready',
  'server-failed',
  'pc-silent',
  'approval',
  'session-done',
  'suspended',
  'access-cut',
  'device-paired',
  'device-revoked'
] as const
export type NotifyCode = (typeof NOTIFY_CODES)[number]
const POWER_COMMANDS = ['wake', 'shutdown', 'abort-shutdown']
const POWER_RESULTS = ['ok', 'mac', 'old', 'clock', 'expired', '']

export const CONTROL_MAX_BODY_BYTES = 64 * 1024
export const MESSAGE_MAX_TTL_MS = 10 * 60_000
// Spec 2026-11-07, item 9 (was 24 h).
export const REMOTE_REQUEST_TTL_MS = 60 * 60_000
export const POWER_COMMAND_MAX_MS = 2 * 60_000

const OPAQUE_ID = /^[0-9a-f]{32}$/
const MSG_ID = /^[A-Za-z0-9-]{8,64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HEX_SHA256 = /^[0-9a-f]{64}$/
/** base64 of exactly 32 bytes (an Ed25519 public key). */
const KEY_32_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/
const FCM_TOKEN = /^[A-Za-z0-9:_-]{1,4096}$/

export interface ControlHelpers {
  fail(status: number, body: Record<string, unknown>): Error
  reply(status: number, body: unknown): Response
  readJson(request: Request, max: number): Promise<Record<string, unknown>>
  authenticate(request: Request): Promise<DeviceRow>
  listDevices(): Promise<DeviceRow[]>
  /** Key proof only. */
  requireProof(request: Request): Promise<void>
  /** Key proof and the second factor (spent on success, counted on failure). */
  requireProofAndFactor(request: Request): Promise<void>
  sha256Hex(text: string): Promise<string>
  newToken(): string
}

export interface ControlDeps {
  control?: ControlDb
  now: () => number
  /** Sends a fixed push text to the given devices; failures are its own business. */
  notify?: (deviceIds: string[], code: NotifyCode) => Promise<void>
  /** Keeps a promise alive after the response (ctx.waitUntil on Workers). */
  defer?: (p: Promise<unknown>) => void
}

type ControlHandler = (
  request: Request,
  params: string[],
  db: ControlDb,
  deps: ControlDeps,
  h: ControlHelpers
) => Promise<Response>

function field(
  h: ControlHelpers,
  body: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  max: number
): string {
  const v = body[key]
  if (typeof v !== 'string' || v.length === 0 || v.length > max || !pattern.test(v)) {
    throw h.fail(400, { error: `invalid ${key}` })
  }
  return v
}

function time(h: ControlHelpers, body: Record<string, unknown>, key: string): number {
  const v = body[key]
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw h.fail(400, { error: `invalid ${key}` })
  }
  return v
}

async function roleOf(db: ControlDb, id: string): Promise<'pc' | 'controller' | null> {
  const roles = await db.getRoles()
  if (roles.pc === id) return 'pc'
  return roles.controllers.includes(id) ? 'controller' : null
}

async function requireRole(
  db: ControlDb,
  h: ControlHelpers,
  id: string,
  allowed: ('pc' | 'controller')[]
): Promise<void> {
  const role = await roleOf(db, id)
  if (!role || !allowed.includes(role)) throw h.fail(403, { error: 'forbidden' })
}

async function activeDevice(h: ControlHelpers, id: string): Promise<boolean> {
  return (await h.listDevices()).some((d) => d.id === id && d.revokedAt === null)
}

async function espAuth(request: Request, db: ControlDb, h: ControlHelpers): Promise<void> {
  const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.get('authorization') ?? '')
  if (!match || !(await db.powerTokenMatches(await h.sha256Hex(match[1])))) {
    throw h.fail(401, { error: 'unauthorized' })
  }
}

function sealedSlot(
  h: ControlHelpers,
  body: Record<string, unknown>
): { msgId: string; ciphertext: string } {
  return {
    msgId: field(h, body, 'msgId', MSG_ID, 64),
    ciphertext: field(h, body, 'ciphertext', BASE64, CONTROL_MAX_BODY_BYTES)
  }
}

// ── Roles ─────────────────────────────────────────────────────────────────────────

const getPc: ControlHandler = async (request, _p, db, _d, h) => {
  await h.authenticate(request)
  const { pc } = await db.getRoles()
  // A D1 without pc_key still answers who the PC is (spec 2026-11-09).
  let publicKey: string | null = null
  try {
    publicKey = pc ? await db.getPcKey(pc) : null
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }
  return h.reply(200, { pc, publicKey })
}

/** Only the current PC publishes its key; a phone far from home seals the password to it. */
const setPcKey: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const key = field(h, body, 'publicKey', KEY_32_B64, 44)
  await db.setPcKey(me.id, key, deps.now())
  return h.reply(200, { ok: true })
}

const setPc: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await h.requireProofAndFactor(request)
  await db.setPc(me.id, deps.now())
  await db.removeController(me.id)
  return h.reply(200, { ok: true })
}

const listControllers: ControlHandler = async (request, _p, db, _d, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  return h.reply(200, { controllers: (await db.getRoles()).controllers })
}

const addController: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  await h.requireProof(request)
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const id = field(h, body, 'id', OPAQUE_ID, 32)
  if (id === me.id || !(await activeDevice(h, id))) throw h.fail(404, { error: 'not found' })
  await db.addController(id, deps.now())
  return h.reply(200, { ok: true })
}

const removeController: ControlHandler = async (request, params, db, _d, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  await h.requireProof(request)
  await db.removeController(params[0])
  return h.reply(200, { ok: true })
}

/**
 * A new phone, far from the PC, becomes the only controller: every former one
 * loses the role at once (the old phone is presumably lost). Its request waits
 * up to 1 h for the PC, which still checks the Sagyou password before granting
 * unlock, shutdown and approvals.
 */
const remoteRole: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const sealed = sealedSlot(h, body)
  const { pc } = await db.getRoles()
  if (!pc) throw h.fail(409, { error: 'no pc' })
  if (pc === me.id) throw h.fail(409, { error: 'is pc' })
  await h.requireProofAndFactor(request)
  const now = deps.now()
  // The request goes into the PC's inbox first: with the inbox full, the roles
  // stay as they were (otherwise the old phones lose control for nothing).
  const stored = await db.putMessage({
    to: pc,
    from: me.id,
    msgId: sealed.msgId,
    ciphertext: sealed.ciphertext,
    expiresAt: now + REMOTE_REQUEST_TTL_MS,
    now
  })
  if (!stored) throw h.fail(409, { error: 'inbox full' })
  await db.addController(me.id, now)
  await db.clearControllers(me.id)
  return h.reply(200, { ok: true })
}

// ── Messages and status ──────────────────────────────────────────────────────────

const send: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const to = field(h, body, 'to', OPAQUE_ID, 32)
  const sealed = sealedSlot(h, body)
  const ttl = body.ttlMs
  if (
    typeof ttl !== 'number' ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    ttl > MESSAGE_MAX_TTL_MS
  ) {
    throw h.fail(400, { error: 'invalid ttlMs' })
  }
  const notify = body.notify
  if (notify !== undefined && !(NOTIFY_CODES as readonly unknown[]).includes(notify)) {
    throw h.fail(400, { error: 'invalid notify' })
  }
  const { pc } = await db.getRoles()
  if (me.id === pc) {
    if (to === me.id || !(await activeDevice(h, to))) throw h.fail(404, { error: 'not found' })
  } else {
    // Anyone in the group may ask the PC (an authorization request comes from a
    // phone that is not a controller yet); nobody else may be messaged.
    if (!pc || to !== pc) throw h.fail(403, { error: 'forbidden' })
    if (notify !== undefined) throw h.fail(403, { error: 'forbidden' })
  }
  const now = deps.now()
  const stored = await db.putMessage({
    to,
    from: me.id,
    msgId: sealed.msgId,
    ciphertext: sealed.ciphertext,
    expiresAt: now + ttl,
    now
  })
  if (!stored) throw h.fail(409, { error: 'inbox full' })
  if (notify !== undefined && deps.notify) {
    const pushed = deps.notify([to], notify as NotifyCode).catch(() => undefined)
    if (deps.defer) deps.defer(pushed)
    else await pushed
  }
  return h.reply(200, { ok: true })
}

/** "Restaurar acesso" lives at most this long in the PC's inbox (its envelope: 1 min). */
export const RESTORE_MAX_TTL_MS = 60_000

/**
 * "Restaurar acesso" (spec docs/specs/2026-11-07-endurecer-acesso-remoto.md):
 * only a controller, only with the key proof and the second factor. The PC
 * lifts a cut only for a message marked here, and only if the phone also signed it.
 */
const restore: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['controller'])
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const sealed = sealedSlot(h, body)
  const ttl = body.ttlMs
  if (
    typeof ttl !== 'number' ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    ttl > RESTORE_MAX_TTL_MS
  ) {
    throw h.fail(400, { error: 'invalid ttlMs' })
  }
  const { pc } = await db.getRoles()
  if (!pc) throw h.fail(409, { error: 'no pc' })
  await h.requireProofAndFactor(request)
  const now = deps.now()
  const stored = await db.putMessage({
    to: pc,
    from: me.id,
    msgId: sealed.msgId,
    ciphertext: sealed.ciphertext,
    expiresAt: now + ttl,
    factor: true,
    now
  })
  if (!stored) throw h.fail(409, { error: 'inbox full' })
  return h.reply(200, { ok: true })
}

const inbox: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  const rows = await db.takeMessages(me.id, deps.now())
  return h.reply(200, {
    messages: rows.map((r) => ({
      from: r.from,
      msgId: r.msgId,
      ciphertext: r.ciphertext,
      factor: r.factor === true
    }))
  })
}

const putStatus: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const sealed = sealedSlot(h, body)
  // Spec 2026-11-13: `watch` says whether this PC is expected to keep answering. Absent
  // (a PC before this version) counts as false, so it never raises "PC sem sinal".
  if (body.watch !== undefined && typeof body.watch !== 'boolean') {
    throw h.fail(400, { error: 'invalid watch' })
  }
  const now = deps.now()
  await db.putStatus({ from: me.id, ...sealed, at: now })
  await db.putWatch(body.watch === true, now)
  return h.reply(200, { ok: true })
}

const getStatus: ControlHandler = async (request, _p, db, _d, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc', 'controller'])
  return h.reply(200, (await db.getStatus()) ?? {})
}

const putEsp32Key: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  const sealed = sealedSlot(h, await h.readJson(request, CONTROL_MAX_BODY_BYTES))
  await db.putEsp32Key({ from: me.id, ...sealed, at: deps.now() })
  return h.reply(200, { ok: true })
}

const getEsp32Key: ControlHandler = async (request, _p, db, _d, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc', 'controller'])
  return h.reply(200, (await db.getEsp32Key()) ?? {})
}

const putPushToken: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['controller'])
  const token = field(
    h,
    await h.readJson(request, CONTROL_MAX_BODY_BYTES),
    'token',
    FCM_TOKEN,
    4096
  )
  await db.putPushToken(me.id, token, deps.now())
  return h.reply(200, { ok: true })
}

// ── Power (ESP32) ────────────────────────────────────────────────────────────────

const createPowerToken: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc'])
  await h.requireProofAndFactor(request)
  const token = h.newToken()
  await db.setPowerToken(await h.sha256Hex(token), deps.now())
  return h.reply(200, { token })
}

const powerCommand: ControlHandler = async (request, _p, db, deps, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['controller'])
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  const cmd = body.cmd
  if (typeof cmd !== 'string' || !POWER_COMMANDS.includes(cmd))
    throw h.fail(400, { error: 'invalid cmd' })
  const at = time(h, body, 'at')
  const exp = time(h, body, 'exp')
  if (exp <= at || exp > at + POWER_COMMAND_MAX_MS) throw h.fail(400, { error: 'invalid exp' })
  if (exp <= deps.now()) throw h.fail(400, { error: 'expired' })
  const mac = field(h, body, 'mac', HEX_SHA256, 64)
  await db.putPowerCommand({ cmd, at, exp, mac })
  return h.reply(200, { ok: true })
}

const getPowerState: ControlHandler = async (request, _p, db, _d, h) => {
  const me = await h.authenticate(request)
  await requireRole(db, h, me.id, ['pc', 'controller'])
  const state = await db.getPowerState()
  const last = await db.lastPowerCommand()
  return h.reply(200, {
    state,
    lastCommand: last ? { cmd: last.cmd, at: last.at, takenAt: last.takenAt } : null
  })
}

const powerNext: ControlHandler = async (request, _p, db, deps, h) => {
  await espAuth(request, db, h)
  const now = deps.now()
  await db.touchPowerPoll(now)
  const c = await db.takePowerCommand(now)
  return h.reply(200, { command: c ? { cmd: c.cmd, at: c.at, exp: c.exp, mac: c.mac } : null })
}

const powerReport: ControlHandler = async (request, _p, db, deps, h) => {
  await espAuth(request, db, h)
  const body = await h.readJson(request, CONTROL_MAX_BODY_BYTES)
  if (typeof body.pcPing !== 'boolean') throw h.fail(400, { error: 'invalid pcPing' })
  const lastResult = body.lastResult ?? ''
  if (typeof lastResult !== 'string' || !POWER_RESULTS.includes(lastResult)) {
    throw h.fail(400, { error: 'invalid lastResult' })
  }
  const at = time(h, body, 'at')
  const mac = field(h, body, 'mac', HEX_SHA256, 64)
  await db.putPowerState({ pcPing: body.pcPing, lastResult, at, mac }, deps.now())
  return h.reply(200, { ok: true })
}

// ── Table ────────────────────────────────────────────────────────────────────────

export const CONTROL_ROUTES: { pattern: RegExp; methods: Record<string, ControlHandler> }[] = [
  { pattern: /^\/roles\/pc$/, methods: { GET: getPc, POST: setPc } },
  { pattern: /^\/roles\/pc\/key$/, methods: { PUT: setPcKey } },
  { pattern: /^\/roles\/controllers$/, methods: { GET: listControllers, POST: addController } },
  { pattern: /^\/roles\/controllers\/([0-9a-f]{32})$/, methods: { DELETE: removeController } },
  { pattern: /^\/roles\/remote$/, methods: { POST: remoteRole } },
  { pattern: /^\/control\/send$/, methods: { POST: send } },
  { pattern: /^\/control\/restore$/, methods: { POST: restore } },
  { pattern: /^\/control\/inbox$/, methods: { GET: inbox } },
  { pattern: /^\/control\/status$/, methods: { GET: getStatus, PUT: putStatus } },
  { pattern: /^\/esp32-key$/, methods: { GET: getEsp32Key, PUT: putEsp32Key } },
  { pattern: /^\/push\/token$/, methods: { PUT: putPushToken } },
  { pattern: /^\/power-token$/, methods: { POST: createPowerToken } },
  { pattern: /^\/power\/command$/, methods: { POST: powerCommand } },
  { pattern: /^\/power\/state$/, methods: { GET: getPowerState, POST: powerReport } },
  { pattern: /^\/power\/next$/, methods: { GET: powerNext } }
]

/** A D1 without the new tables: the control answers 501, the sync keeps working. */
export function isMissingTable(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message)
}

/**
 * Runs the matching control route, or returns null when the path is not one.
 * Missing storage (no ControlDb, or the tables were never created) is 501.
 */
export async function handleControl(
  request: Request,
  url: URL,
  deps: ControlDeps,
  h: ControlHelpers
): Promise<Response | null> {
  for (const route of CONTROL_ROUTES) {
    const match = route.pattern.exec(url.pathname)
    if (!match) continue
    const handler = route.methods[request.method]
    if (!handler) return h.reply(405, { error: 'method not allowed' })
    if (!deps.control) return h.reply(501, { error: 'control not deployed' })
    try {
      return await handler(request, match.slice(1), deps.control, deps, h)
    } catch (err) {
      if (isMissingTable(err)) return h.reply(501, { error: 'control not deployed' })
      throw err
    }
  }
  return null
}
