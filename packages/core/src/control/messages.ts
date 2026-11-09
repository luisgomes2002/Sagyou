/**
 * Signed control envelopes. Every message between the PC and a phone is an
 * envelope signed by its sender's Ed25519 key, then sealed (`sealControl`) for
 * the trip through the Worker. The receiver checks the signature, the time
 * window and that the nonce was never accepted before.
 */
import { canonicalJson } from '../sync/records'
import { randomBytes, toBase64Url, utf8 } from '../sync/bytes'
import { signBytes, verifyBytes } from './crypto'

export type ControlKind =
  | 'authorize-request'
  | 'authorize-remote'
  | 'authorized'
  | 'revoked'
  | 'unlock'
  | 'lock'
  | 'shutdown'
  | 'abort-shutdown'
  | 'esp32-key'
  | 'approval-card'
  | 'approval-answer'
  | 'approval-closed'
  | 'result'
  | 'status'
  | 'pc-key'
  | 'install-update'
  | 'cut-access'
  | 'restore-access'
  // Spec docs/specs/2026-11-09-servidores-remote-control.md.
  | 'server-start'
  | 'server-stop'

const MINUTE = 60_000

/** Longest validity each kind may carry; a longer envelope is refused as malformed. */
export const MAX_TTL_MS: Record<ControlKind, number> = {
  'authorize-request': 10 * MINUTE,
  'authorize-remote': 60 * MINUTE,
  authorized: 10 * MINUTE,
  revoked: 10 * MINUTE,
  unlock: MINUTE,
  lock: MINUTE,
  shutdown: MINUTE,
  'abort-shutdown': MINUTE,
  'esp32-key': 10 * MINUTE,
  'approval-card': 6 * MINUTE,
  'approval-answer': MINUTE,
  'approval-closed': 10 * MINUTE,
  result: 10 * MINUTE,
  status: 2 * MINUTE,
  'pc-key': 10 * MINUTE,
  'install-update': MINUTE,
  'cut-access': MINUTE,
  'restore-access': MINUTE,
  'server-start': MINUTE,
  'server-stop': MINUTE
}

/** A request may come from a clock up to 30 s ahead, and may arrive 30 s after it expired. */
export const CLOCK_SKEW_MS = 30_000
export const REQUEST_TTL_MS = MINUTE

export interface SignedEnvelope {
  v: 1
  kind: ControlKind
  nonce: string
  issuedAt: number
  expiresAt: number
  body: Record<string, unknown>
  sig: string
}

export type EnvelopeCheck =
  | { ok: true }
  | { ok: false; reason: 'signature' | 'expired' | 'future' | 'replay' | 'shape' }

function signedBytes(env: Omit<SignedEnvelope, 'sig'>): Uint8Array {
  const { v, kind, nonce, issuedAt, expiresAt, body } = env
  return utf8(canonicalJson({ v, kind, nonce, issuedAt, expiresAt, body }))
}

export function signEnvelope(
  privateKey: Uint8Array,
  kind: ControlKind,
  body: Record<string, unknown>,
  now: number,
  ttlMs: number = Math.min(REQUEST_TTL_MS, MAX_TTL_MS[kind])
): SignedEnvelope {
  const unsigned = {
    v: 1 as const,
    kind,
    nonce: toBase64Url(randomBytes(16)),
    issuedAt: now,
    expiresAt: now + ttlMs,
    body
  }
  return { ...unsigned, sig: signBytes(privateKey, signedBytes(unsigned)) }
}

export function isEnvelope(value: unknown): value is SignedEnvelope {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return (
    e.v === 1 &&
    typeof e.kind === 'string' &&
    Object.prototype.hasOwnProperty.call(MAX_TTL_MS, e.kind) &&
    typeof e.nonce === 'string' &&
    /^[A-Za-z0-9_-]{16,64}$/.test(e.nonce) &&
    Number.isSafeInteger(e.issuedAt) &&
    Number.isSafeInteger(e.expiresAt) &&
    !!e.body &&
    typeof e.body === 'object' &&
    !Array.isArray(e.body) &&
    typeof e.sig === 'string'
  )
}

/**
 * Order matters: shape, then signature (a forged envelope never learns whether
 * its time was right), then time, then the nonce.
 */
export function checkEnvelope(
  env: unknown,
  publicKey: Uint8Array,
  now: number,
  seen: (nonce: string) => boolean
): EnvelopeCheck {
  if (!isEnvelope(env)) return { ok: false, reason: 'shape' }
  const ttl = env.expiresAt - env.issuedAt
  if (ttl <= 0 || ttl > MAX_TTL_MS[env.kind]) return { ok: false, reason: 'shape' }
  if (!verifyBytes(publicKey, signedBytes(env), env.sig)) return { ok: false, reason: 'signature' }
  if (env.issuedAt > now + CLOCK_SKEW_MS) return { ok: false, reason: 'future' }
  if (env.expiresAt + CLOCK_SKEW_MS <= now) return { ok: false, reason: 'expired' }
  if (seen(env.nonce)) return { ok: false, reason: 'replay' }
  return { ok: true }
}

// ── PC status (the heartbeat body) ───────────────────────────────────────────────

/** A Remote Control server the Sagyou manages (spec 2026-11-09). */
export type ServerState = 'running' | 'stopped' | 'starting' | 'needs-confirm' | 'external'
const SERVER_STATES: ServerState[] = ['running', 'stopped', 'starting', 'needs-confirm', 'external']

export interface PcServer {
  name: string
  up: boolean
  /** Absent from a PC built before the Sagyou managed the servers: only observed. */
  projectId?: string
  state?: ServerState
  /** "Iniciar com o Sagyou"; only these count for "PC pronto". Absent = counts. */
  autostart?: boolean
}

export interface PcStatus {
  v: 1
  at: number
  locked: boolean
  servers: PcServer[]
  pendingCards: number
  shutdownAt: number | null
  suspendedUntil: number | null
  /** A downloaded Sagyou version waiting to be installed (absent in older PCs: null). */
  updateVersion: string | null
  /**
   * When the phone's "Cortar acesso" took effect (ms), or null. Optional in the
   * type so callers built before it keep compiling; parsePcStatus always sets it.
   */
  accessCutAt?: number | null
}

const nullableTime = (v: unknown): v is number | null => v === null || Number.isSafeInteger(v)

export function parsePcStatus(body: unknown): PcStatus | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.v !== 1 || !Number.isSafeInteger(b.at) || typeof b.locked !== 'boolean') return null
  if (!Array.isArray(b.servers) || b.servers.length > 50) return null
  const servers: PcStatus['servers'] = []
  for (const s of b.servers) {
    const row = s as Record<string, unknown> | null
    if (!row || typeof row.name !== 'string' || typeof row.up !== 'boolean') return null
    const server: PcServer = { name: row.name, up: row.up }
    if (typeof row.projectId === 'string' && row.projectId.length > 0 && row.projectId.length <= 64)
      server.projectId = row.projectId
    if (SERVER_STATES.includes(row.state as ServerState)) server.state = row.state as ServerState
    if (typeof row.autostart === 'boolean') server.autostart = row.autostart
    servers.push(server)
  }
  if (!Number.isSafeInteger(b.pendingCards) || (b.pendingCards as number) < 0) return null
  if (!nullableTime(b.shutdownAt) || !nullableTime(b.suspendedUntil)) return null
  const updateVersion =
    typeof b.updateVersion === 'string' && b.updateVersion.length <= 40 ? b.updateVersion : null
  return {
    v: 1,
    at: b.at as number,
    locked: b.locked,
    servers,
    pendingCards: b.pendingCards as number,
    shutdownAt: b.shutdownAt,
    suspendedUntil: b.suspendedUntil,
    updateVersion,
    // Absent from a PC built before "Cortar acesso": not cut.
    accessCutAt: Number.isSafeInteger(b.accessCutAt) ? (b.accessCutAt as number) : null
  }
}
