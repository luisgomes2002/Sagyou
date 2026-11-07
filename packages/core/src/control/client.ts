/**
 * HTTP client of the remote-control routes of the sync Worker, shared by the
 * desktop (the controlled PC) and the phone (a controller). It seals every
 * envelope for its recipient and opens what arrives; signatures are checked by
 * the caller, which knows whose key to expect.
 */
import type { FetchLike, SyncSecondFactor } from '../sync/engine'
import type { SyncConfig } from '../sync/config-types'
import { deriveKeys, keyProof, opaqueDeviceId } from '../sync/crypto'
import { fromBase64, fromUtf8, randomUUID, toBase64, utf8 } from '../sync/bytes'
import { ControlDecryptError, controlKey, openControl, sealControl } from './crypto'
import { isEnvelope, type SignedEnvelope } from './messages'

export type ControlErrorCode =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'not-deployed'
  | 'factor'
  | 'locked'
  | 'gone'
  | 'conflict'
  | 'not-configured'

export class ControlError extends Error {
  constructor(readonly code: ControlErrorCode) {
    super(`control: ${code}`)
    this.name = 'ControlError'
  }
}

export type NotifyCode = 'ready' | 'approval' | 'shutdown-failed'

/** Pseudo-recipients for the two sealed singletons the Worker keeps. */
export const STATUS_SLOT = 'status'
export const ESP32_KEY_SLOT = 'esp32-key'
/** The Worker keeps a message at most this long (authorize-remote is the exception). */
export const MAX_MESSAGE_TTL_MS = 10 * 60_000
/** How long "Restaurar acesso" waits in the PC's inbox (the envelope's own validity). */
export const RESTORE_TTL_MS = 60_000

export interface InboxMessage {
  from: string
  msgId: string
  env: SignedEnvelope
  /**
   * The Worker checked the sender's second factor for this message (only the
   * restore route sets it). Absent, as from an older Worker, means false.
   */
  factor?: boolean
}

export interface PowerStateReport {
  pcPing: boolean
  lastResult: string
  at: number
  mac: string
  lastPoll: number
}

export interface PowerStateView {
  state: PowerStateReport | null
  /** `takenAt`: when the ESP32 fetched it; null = not yet (or an older Worker). */
  lastCommand: { cmd: string; at: number; takenAt: number | null } | null
}

export interface ControlClient {
  /** This device's opaque id (what the Worker and the AAD use). */
  me(): string
  send(to: string, env: SignedEnvelope, notify?: NotifyCode): Promise<void>
  inbox(): Promise<{ messages: InboxMessage[]; dropped: number }>
  putStatus(env: SignedEnvelope): Promise<void>
  getStatus(): Promise<InboxMessage | null>
  setPc(factor: SyncSecondFactor): Promise<void>
  pcId(): Promise<string | null>
  controllers(): Promise<string[]>
  addController(id: string): Promise<void>
  removeController(id: string): Promise<void>
  /** Becomes a controller from afar; the envelope waits for the PC (24 h). */
  remoteRole(factor: SyncSecondFactor, env: SignedEnvelope): Promise<void>
  /** "Restaurar acesso": the Worker checks the factor, then the PC gets the envelope. */
  restore(factor: SyncSecondFactor, env: SignedEnvelope): Promise<void>
  putEsp32Key(key: Uint8Array): Promise<void>
  getEsp32Key(): Promise<Uint8Array | null>
  createPowerToken(factor: SyncSecondFactor): Promise<string>
  powerCommand(cmd: string, at: number, exp: number, mac: string): Promise<void>
  powerState(): Promise<PowerStateView>
  putPushToken(token: string): Promise<void>
}

export interface ControlClientDeps {
  fetch: FetchLike
  config: () => SyncConfig | null
  deviceId: () => string
  now: () => number
}

function errorFor(status: number, body: Record<string, unknown>): ControlError {
  if (status === 501) return new ControlError('not-deployed')
  if (status === 429) return new ControlError('locked')
  if (status === 410) return new ControlError('gone')
  if (status === 409) return new ControlError('conflict')
  if (status === 403) return new ControlError('forbidden')
  if (status === 401) {
    return new ControlError(
      body.error === 'invalid factor' || body.error === 'factor required'
        ? 'factor'
        : 'unauthorized'
    )
  }
  return new ControlError('offline')
}

export function createControlClient(deps: ControlClientDeps): ControlClient {
  const session = (): { cfg: SyncConfig; idKey: Uint8Array; me: string; ck: Uint8Array } => {
    const cfg = deps.config()
    if (!cfg) throw new ControlError('not-configured')
    const { id } = deriveKeys(cfg.syncKey)
    return { cfg, idKey: id, me: opaqueDeviceId(id, deps.deviceId()), ck: controlKey(cfg.syncKey) }
  }

  async function call(
    method: string,
    path: string,
    opts: { body?: unknown; proof?: boolean; factor?: SyncSecondFactor } = {}
  ): Promise<Record<string, unknown>> {
    const s = session()
    const headers: Record<string, string> = { authorization: `Bearer ${s.cfg.token}` }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.proof) headers['x-key-proof'] = keyProof(s.idKey)
    if (opts.factor?.totp) headers['x-totp-code'] = opts.factor.totp
    let res: { status: number; json(): Promise<unknown> }
    try {
      res = await deps.fetch(`${s.cfg.url.replace(/\/+$/, '')}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
      })
    } catch {
      throw new ControlError('offline')
    }
    let body: Record<string, unknown> = {}
    try {
      const parsed = await res.json()
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
      body = {}
    }
    if (res.status !== 200) throw errorFor(res.status, body)
    return body
  }

  const seal = (to: string, msgId: string, env: SignedEnvelope): string => {
    const s = session()
    return sealControl(s.ck, s.me, to, msgId, utf8(JSON.stringify(env)))
  }

  const open = (from: string, to: string, msgId: string, ciphertext: string): SignedEnvelope => {
    const parsed: unknown = JSON.parse(
      fromUtf8(openControl(session().ck, from, to, msgId, ciphertext))
    )
    if (!isEnvelope(parsed)) throw new ControlDecryptError()
    return parsed
  }

  return {
    me: () => session().me,

    async send(to, env, notify) {
      const msgId = randomUUID()
      const ttlMs = Math.min(MAX_MESSAGE_TTL_MS, Math.max(1000, env.expiresAt - deps.now()))
      await call('POST', '/control/send', {
        body: { to, msgId, ciphertext: seal(to, msgId, env), ttlMs, ...(notify ? { notify } : {}) }
      })
    },

    async inbox() {
      const body = await call('GET', '/control/inbox')
      const rows = Array.isArray(body.messages) ? body.messages : []
      const me = session().me
      const messages: InboxMessage[] = []
      let dropped = 0
      for (const row of rows as Record<string, unknown>[]) {
        try {
          const from = String(row.from)
          const msgId = String(row.msgId)
          messages.push({
            from,
            msgId,
            env: open(from, me, msgId, String(row.ciphertext)),
            // An older Worker sends no mark: nothing passed a second factor.
            factor: row.factor === true
          })
        } catch {
          dropped++
        }
      }
      return { messages, dropped }
    },

    async putStatus(env) {
      const msgId = randomUUID()
      await call('PUT', '/control/status', {
        body: { msgId, ciphertext: seal(STATUS_SLOT, msgId, env) }
      })
    },

    async getStatus() {
      const body = await call('GET', '/control/status')
      if (typeof body.ciphertext !== 'string') return null
      const from = String(body.from)
      const msgId = String(body.msgId)
      try {
        return { from, msgId, env: open(from, STATUS_SLOT, msgId, body.ciphertext) }
      } catch {
        return null
      }
    },

    async setPc(factor) {
      await call('POST', '/roles/pc', { proof: true, factor })
    },

    async pcId() {
      const body = await call('GET', '/roles/pc')
      return typeof body.pc === 'string' ? body.pc : null
    },

    async controllers() {
      const body = await call('GET', '/roles/controllers')
      return Array.isArray(body.controllers) ? body.controllers.map(String) : []
    },

    async addController(id) {
      await call('POST', '/roles/controllers', { body: { id }, proof: true })
    },

    async removeController(id) {
      await call('DELETE', `/roles/controllers/${encodeURIComponent(id)}`, { proof: true })
    },

    async remoteRole(factor, env) {
      const pc = await this.pcId()
      if (!pc) throw new ControlError('conflict')
      const msgId = randomUUID()
      await call('POST', '/roles/remote', {
        body: { msgId, ciphertext: seal(pc, msgId, env) },
        proof: true,
        factor
      })
    },

    async restore(factor, env) {
      const pc = await this.pcId()
      if (!pc) throw new ControlError('conflict')
      const msgId = randomUUID()
      await call('POST', '/control/restore', {
        body: { msgId, ciphertext: seal(pc, msgId, env), ttlMs: RESTORE_TTL_MS },
        proof: true,
        factor
      })
    },

    async putEsp32Key(key) {
      const s = session()
      const msgId = randomUUID()
      const ciphertext = sealControl(s.ck, s.me, ESP32_KEY_SLOT, msgId, utf8(toBase64(key)))
      await call('PUT', '/esp32-key', { body: { msgId, ciphertext } })
    },

    async getEsp32Key() {
      const body = await call('GET', '/esp32-key')
      if (typeof body.ciphertext !== 'string') return null
      try {
        const plain = openControl(
          session().ck,
          String(body.from),
          ESP32_KEY_SLOT,
          String(body.msgId),
          body.ciphertext
        )
        return fromBase64(fromUtf8(plain))
      } catch {
        return null
      }
    },

    async createPowerToken(factor) {
      const body = await call('POST', '/power-token', { proof: true, factor })
      if (typeof body.token !== 'string') throw new ControlError('offline')
      return body.token
    },

    async powerCommand(cmd, at, exp, mac) {
      await call('POST', '/power/command', { body: { cmd, at, exp, mac } })
    },

    async powerState() {
      const body = await call('GET', '/power/state')
      const st = body.state as Record<string, unknown> | null | undefined
      const lc = body.lastCommand as Record<string, unknown> | null | undefined
      return {
        state:
          st && typeof st === 'object'
            ? {
                pcPing: st.pcPing === true,
                lastResult: String(st.lastResult ?? ''),
                at: Number(st.at),
                mac: String(st.mac ?? ''),
                lastPoll: Number(st.lastPoll)
              }
            : null,
        lastCommand:
          lc && typeof lc === 'object'
            ? {
                cmd: String(lc.cmd),
                at: Number(lc.at),
                takenAt: typeof lc.takenAt === 'number' ? lc.takenAt : null
              }
            : null
      }
    },

    async putPushToken(token) {
      await call('PUT', '/push/token', { body: { token } })
    }
  }
}
