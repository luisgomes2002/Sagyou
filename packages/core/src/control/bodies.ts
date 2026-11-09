/**
 * Bodies of the signed control envelopes, shared by the PC and the phone so
 * both sides parse the same shapes. Every parser returns null for anything
 * malformed: a message from the Worker is never trusted to be well formed.
 */
import { fromBase64 } from '../sync/bytes'

const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max

/** A base64 32-byte key (Ed25519 public key or ESP32 key). */
function key32(v: unknown): Uint8Array | null {
  if (typeof v !== 'string' || v.length > 64) return null
  try {
    const bytes = fromBase64(v)
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

const obj = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null

/** Phone → PC, signed by the key it carries (proof of possession). */
export interface AuthorizeRequestBody {
  name: string
  /** base64 Ed25519 public key of the phone. */
  publicKey: string
}

/**
 * Phone → PC through `/roles/remote`; the PC checks the Sagyou password, sealed
 * to its own key (`sealPasswordToPc`), never sent under the control key alone.
 */
export interface AuthorizeRemoteBody extends AuthorizeRequestBody {
  sealedPassword: string
}

/** base64 of ephemeral (32) + nonce (24) + up to 1024 bytes + tag (16). */
const SEALED_PASSWORD_MAX = 2048

export type ParsedAuthorizeRemote = AuthorizeRequestBody & { key: Uint8Array } & (
    | { sealedPassword: string; outdated?: undefined }
    /** A phone from before the seal: still signed, so it is checked, then refused. */
    | { outdated: true; sealedPassword?: undefined }
  )

export function parseAuthorizeRequest(
  body: unknown
): (AuthorizeRequestBody & { key: Uint8Array }) | null {
  const b = obj(body)
  if (!b || !str(b.name, 80)) return null
  const key = key32(b.publicKey)
  return key ? { name: b.name, publicKey: b.publicKey as string, key } : null
}

export function parseAuthorizeRemote(body: unknown): ParsedAuthorizeRemote | null {
  const base = parseAuthorizeRequest(body)
  const b = obj(body)
  if (!base || !b) return null
  if (str(b.sealedPassword, SEALED_PASSWORD_MAX))
    return { ...base, sealedPassword: b.sealedPassword }
  if (b.sealedPassword === undefined && str(b.password, 1024)) return { ...base, outdated: true }
  return null
}

/** PC → phone: the PC's public key, which signs everything the PC sends. */
export interface AuthorizedBody {
  pcPublicKey: string
}

export function parseAuthorized(body: unknown): { key: Uint8Array } | null {
  const key = key32(obj(body)?.pcPublicKey)
  return key ? { key } : null
}

/**
 * PC → phone, in answer to `authorize-request`: the PC's public key, signed by it,
 * so the phone can show the pairing code before the PC authorizes it.
 */
export const parsePcKey = parseAuthorized

/** Phone → PC: start or stop the Remote Control server of one project. */
export interface ServerRequestBody {
  projectId: string
}

export function parseServerRequest(body: unknown): ServerRequestBody | null {
  const b = obj(body)
  return b && str(b.projectId, 64) ? { projectId: b.projectId } : null
}

/** PC → phone: the ESP32 key (base64), to sign power commands. */
export interface Esp32KeyBody {
  key: string
}

export function parseEsp32Key(body: unknown): Uint8Array | null {
  return key32(obj(body)?.key)
}

export type ResultReason =
  | 'unknown-controller'
  | 'signature'
  | 'expired'
  | 'future'
  | 'replay'
  | 'shape'
  | 'suspended'
  | 'wrong-password'
  | 'flush-failed'
  | 'gone'
  | 'refused'
  | 'no-update'
  | 'install-failed'
  /** restore-access that did not pass the Worker's second-factor check. */
  | 'factor'
  /** authorize-remote from a phone that sends the password without the PC seal. */
  | 'outdated'
  // server-start / server-stop (spec 2026-11-09); none of them is counted.
  | 'not-confirmed'
  | 'cut'
  | 'unknown-server'
  | 'start-failed'

/** PC → phone: the answer to one request, by its nonce. */
export interface ResultBody {
  replyTo: string
  ok: boolean
  reason?: ResultReason
  /** With `suspended`: until when (ms). */
  until?: number
}

export function parseResult(body: unknown): ResultBody | null {
  const b = obj(body)
  if (!b || !str(b.replyTo, 64) || typeof b.ok !== 'boolean') return null
  return {
    replyTo: b.replyTo,
    ok: b.ok,
    ...(typeof b.reason === 'string' ? { reason: b.reason as ResultReason } : {}),
    ...(Number.isSafeInteger(b.until) ? { until: b.until as number } : {})
  }
}

/** PC → phone: a Fleet card waiting for an answer. */
export interface ApprovalCardBody {
  id: string
  session: string
  tool: string
  resumo: string
  /** ms */
  expiresAt: number
}

export function parseApprovalCard(body: unknown): ApprovalCardBody | null {
  const b = obj(body)
  if (!b || !str(b.id, 128) || typeof b.session !== 'string' || !str(b.tool, 128)) return null
  if (typeof b.resumo !== 'string' || !Number.isSafeInteger(b.expiresAt)) return null
  return {
    id: b.id,
    session: b.session.slice(0, 200),
    tool: b.tool,
    resumo: b.resumo.slice(0, 2000),
    expiresAt: b.expiresAt as number
  }
}

/** Phone → PC. */
export interface ApprovalAnswerBody {
  id: string
  approved: boolean
}

export function parseApprovalAnswer(body: unknown): ApprovalAnswerBody | null {
  const b = obj(body)
  if (!b || !str(b.id, 128) || typeof b.approved !== 'boolean') return null
  return { id: b.id, approved: b.approved }
}

/** PC → phone: the card was answered (here or on another screen) or expired. */
export function parseApprovalClosed(body: unknown): { id: string } | null {
  const b = obj(body)
  return b && str(b.id, 128) ? { id: b.id } : null
}
