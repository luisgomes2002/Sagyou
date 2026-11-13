// The controlled PC's side of the remote control (spec docs/specs/2026-11-03-controle-remoto-app.md).
//
// Every 5 s it reads its inbox in the Worker and every 30 s it publishes a
// signed heartbeat (`PcStatus`). Each request must be signed by an authorized
// controller, inside its time window, with a nonce never accepted before (kept
// in remote-control.json, so a restart does not reopen a replay). Five refused
// requests in a row suspend unlock, shutdown and remote authorization for
// 15 minutes. Only a refusal of someone already authenticated counts (a known
// controller's request out of its window or replayed, a wrong password from the
// holder of the Worker's controller role); an unknown sender or a bad signature
// never does, or anyone in the sync could keep the real phone suspended. Only an
// authenticated request clears the count. Counters and nonces are written once
// per cycle, not per message. Effects go through injected functions: this
// module never touches the window, the lock or the OS itself.
import {
  parseApprovalAnswer,
  parseAuthorizeRemote,
  parseAuthorizeRequest,
  parseServerRequest,
  type ApprovalCardBody,
  type ResultReason
} from '@sagyou/core/control/bodies'
import {
  ControlError,
  type ControlClient,
  type ControlErrorCode,
  type InboxMessage,
  type NotifyCode
} from '@sagyou/core/control/client'
import {
  ControlDecryptError,
  openPasswordFromPc,
  pairingCode,
  publicKeyOf
} from '@sagyou/core/control/crypto'
import {
  CLOCK_SKEW_MS,
  MAX_TTL_MS,
  checkEnvelope,
  signEnvelope,
  type ControlKind,
  type PcServer,
  type PcStatus,
  type SignedEnvelope
} from '@sagyou/core/control/messages'
import { fromBase64, toBase64 } from '@sagyou/core/sync/bytes'
import type { SyncStatus } from '@sagyou/core/sync/engine'
import type { Logger } from '../logs/logger'
import type { RcServerView, RcStartResult, RcStopResult } from './rc-manager'
import type { RemoteConfig, RemoteController } from './remote-config'

export const REMOTE_FAIL_LIMIT = 5
export const REMOTE_SUSPEND_MS = 15 * 60_000
export const REMOTE_TICK_MS = 5_000
export const REMOTE_STATUS_MS = 30_000
export const REMOTE_DEVICES_MS = 5 * 60_000
export const AUTHORIZATION_TTL_MS = 10 * 60_000
/** Nonces kept at most; past it, the ones that expire first go. */
export const REMOTE_MAX_NONCES = 2000
/** New authorize-request handled per inbox read; the rest are dropped. */
export const MAX_AUTHORIZE_REQUESTS_PER_CYCLE = 3
/** authorize-remote whose password is checked per inbox read. */
export const MAX_AUTHORIZE_REMOTE_PER_CYCLE = 1
const STATUS_TTL_MS = MAX_TTL_MS.status
/** How long a phone's "Ligar" is remembered to push "server-ready" to it (spec 2026-11-13). */
const SERVER_REQUEST_MS = 10 * 60_000
const NOTICE_TTL_MS = 10 * 60_000

/** Sync states in which the remote control runs; anything else stops it. */
const SYNC_RUNNING_STATES: SyncStatus['state'][] = ['ok', 'offline', 'update-pending']

export interface PendingAuthorization {
  /** The phone's opaque device id. */
  id: string
  name: string
  /** 6 digits, shown here and on the phone. */
  code: string
  expiresAt: number
}

export type RemoteCard = ApprovalCardBody

export interface RemoteServiceDeps {
  client: ControlClient
  config: () => RemoteConfig
  save: (config: RemoteConfig) => void
  pcPrivateKey: () => Uint8Array | null
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  isLocked: () => boolean
  /** The Sagyou password exists: without it the PC is never controlled. */
  hasPassword: () => boolean
  verifyPassword: (password: string) => boolean
  unlock: () => void
  lock: () => void
  shutdown: () => Promise<'ok' | 'flush-failed' | 'failed'>
  abortShutdown: () => Promise<void>
  shutdownAt: () => number | null
  /**
   * The Remote Control servers the Sagyou manages (rc-manager). May refresh
   * them first: it is read once per heartbeat.
   */
  serverList: () => RcServerView[] | Promise<RcServerView[]>
  /** server-start from a phone (spec 2026-11-09-servidores-remote-control). */
  startServer: (projectId: string, origin: 'phone') => Promise<RcStartResult>
  /** server-stop from a phone; never barred by the suspension. */
  stopServer: (projectId: string) => Promise<RcStopResult>
  pendingCards: () => number
  /** False when the id is not (or no longer) pending. */
  answerCard: (id: string, approved: boolean) => boolean
  devices: () => Promise<{ id: string; revoked: boolean }[]>
  esp32Key: () => Uint8Array | null
  /** A downloaded version ready to install, or null. */
  updateVersion: () => string | null
  /** The same path as update:install: stop run timers, save, restart in the new version. */
  installUpdate: () => Promise<'ok' | 'none' | 'failed'>
  /**
   * "Cortar acesso" was just accepted (accessCutAt is already saved): refuse the
   * external token's queue and cards, start ending the Remote Control servers,
   * lock the Sagyou (spec 2026-11-07-endurecer-acesso-remoto).
   */
  onAccessCut: () => void
  /** "Restaurar acesso" was just accepted (accessCutAt is already null). */
  onAccessRestored: () => void
  log: Pick<Logger, 'info' | 'warn'>
  /** After a cycle that changed what the settings screen shows. */
  onChange?: () => void
}

export interface RemoteService {
  start(): void
  stop(): void
  /** One cycle; exposed for tests. */
  tick(): Promise<void>
  running(): boolean
  /** Last error of the cycle with the Worker (null when the last one worked). */
  lastError(): ControlErrorCode | null
  pendingAuthorizations(): PendingAuthorization[]
  authorize(id: string, password: string): Promise<'ok' | 'wrong-password' | 'expired'>
  refuse(id: string): Promise<void>
  revokeController(id: string): Promise<void>
  sendCard(card: RemoteCard): Promise<void>
  closeCard(id: string): Promise<void>
  publishEsp32Key(): Promise<void>
  syncStatusChanged(status: SyncStatus): void
  /** Drops controllers revoked (or gone) in the sync. */
  checkDevices(): Promise<void>
  /** The next cycle publishes the status (a server changed). */
  statusSoon(): void
  /**
   * A push (spec 2026-11-13): a signed status with `notify`, to `only` (a controller) or to
   * every controller. Does nothing while the controlled mode is not running.
   */
  notifyEvent(code: NotifyCode, only?: string): Promise<void>
  /** The rc-manager says a server asked by a phone is ready: "server-ready" to that phone only. */
  serverReady(projectId: string): Promise<void>
  /**
   * A server failed: before it was ready ('start', only to the phone that asked) or after it
   * ('crash', to every controller).
   */
  serverFailed(projectId: string, phase: 'start' | 'crash'): Promise<void>
  /**
   * Tells the Worker this PC stops answering on purpose (quit, update): no "PC sem sinal".
   * Best effort, never throws.
   */
  announceOffline(): Promise<void>
}

/** What the heartbeat says about one server: only those turned on for a project. */
export function pcServers(list: RcServerView[]): PcServer[] {
  return list
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      up: s.state === 'running' || s.state === 'external' || s.state === 'needs-confirm',
      projectId: s.projectId,
      state: s.state,
      autostart: s.autostart
    }))
}

type Counters = Pick<RemoteConfig, 'failures' | 'suspendedUntil' | 'seenNonces'>

interface Pending extends PendingAuthorization {
  publicKey: string
  nonce: string
}

export function createRemoteService(deps: RemoteServiceDeps): RemoteService {
  const { client, log } = deps
  let wanted = false
  let syncActive = false
  let timer: unknown = null
  let busy = false
  let readySent = false
  let lastStatusAt = Number.NEGATIVE_INFINITY
  let lastDevicesAt = Number.NEGATIVE_INFINITY
  let lastError: ControlErrorCode | null = null
  let dirty = false
  const pending = new Map<string, Pending>()
  // Within a cycle, counters and nonces wait here and are written once at the end.
  let inCycle = false
  let draft: Counters | null = null
  // Per inbox read: the Worker's controller role and the request budgets.
  let roles: Promise<Set<string>> | null = null
  let authorizeRequests = 0
  let authorizeRemotes = 0
  // Spec 2026-11-13: the last heartbeat (re-sent with watch=false when this PC stops on
  // purpose), the pushes started during a cycle, the phone that asked each server to start and
  // who was known in the last device check (null until the first one).
  let lastStatus: PcStatus | null = null
  const background: Promise<void>[] = []
  const serverRequests = new Map<string, { controllerId: string; at: number }>()
  let knownDevices: Map<string, boolean> | null = null

  const isActive = (): boolean =>
    wanted && syncActive && deps.hasPassword() && deps.config().enabled

  /** The saved config plus this cycle's unsaved counters. */
  const cfg = (): RemoteConfig => (draft ? { ...deps.config(), ...draft } : deps.config())

  /** Written now (with any pending counters). */
  const update = (fn: (c: RemoteConfig) => RemoteConfig): void => {
    const next = fn(cfg())
    draft = null
    deps.save(next)
    dirty = true
  }

  /** Counters and nonces: batched while a cycle runs. */
  const updateCounters = (fn: (c: Counters) => Counters): void => {
    const c = cfg()
    const next = fn({
      failures: c.failures,
      suspendedUntil: c.suspendedUntil,
      seenNonces: c.seenNonces
    })
    if (!inCycle) return update((full) => ({ ...full, ...next }))
    draft = next
    dirty = true
  }

  /** Merged over the config as it is now, so a change made meanwhile (remote:disable) survives. */
  const flushDraft = (): void => {
    if (!draft) return
    const next = { ...deps.config(), ...draft }
    draft = null
    deps.save(next)
  }

  const suspendedUntil = (now: number): number | null => {
    const until = cfg().suspendedUntil
    return until !== null && now < until ? until : null
  }

  const seen =
    (now: number) =>
    (nonce: string): boolean =>
      cfg().seenNonces.some((n) => n.nonce === nonce && n.until > now)

  /** A signature-valid envelope: its nonce can never be accepted again. */
  const markSeen = (env: SignedEnvelope, now: number): void =>
    updateCounters((c) => {
      let seenNonces = [
        ...c.seenNonces.filter((n) => n.until > now),
        { nonce: env.nonce, until: env.expiresAt + CLOCK_SKEW_MS }
      ]
      if (seenNonces.length > REMOTE_MAX_NONCES) {
        // Keep the ones valid the longest; those dropped are the first to expire anyway.
        seenNonces = seenNonces.sort((a, b) => b.until - a.until).slice(0, REMOTE_MAX_NONCES)
      }
      return { ...c, seenNonces }
    })

  /** Only after an authenticated request. */
  const accepted = (): void => {
    if (cfg().failures !== 0) updateCounters((c) => ({ ...c, failures: 0 }))
  }

  /** A request that does not count (unknown sender, bad signature or shape). */
  const ignored = (reason: ResultReason): void => {
    log.warn('remote', 'refused', { reason, counted: false })
  }

  const refused = (now: number, reason: ResultReason): void => {
    log.warn('remote', 'refused', { reason })
    let suspendedNow = false
    updateCounters((c) => {
      const failures = c.failures + 1
      if (failures < REMOTE_FAIL_LIMIT) return { ...c, failures }
      log.warn('remote', 'suspended', { minutes: REMOTE_SUSPEND_MS / 60_000 })
      suspendedNow = true
      return { ...c, failures: 0, suspendedUntil: now + REMOTE_SUSPEND_MS }
    })
    if (suspendedNow) queueNotify('suspended')
  }

  const sign = (kind: ControlKind, body: object, ttlMs?: number): SignedEnvelope => {
    const key = deps.pcPrivateKey()
    if (!key) throw new ControlError('not-configured')
    return signEnvelope(key, kind, body as Record<string, unknown>, deps.now(), ttlMs)
  }

  const reply = async (
    to: string,
    replyTo: string,
    ok: boolean,
    extra: { reason?: ResultReason; until?: number } = {},
    notify?: NotifyCode
  ): Promise<void> => {
    await client.send(to, sign('result', { replyTo, ok, ...extra }), notify)
  }

  const pcPublicKey = (): string => {
    const keys = cfg().pcKeys
    if (keys) return keys.publicKey
    const key = deps.pcPrivateKey()
    if (!key) throw new ControlError('not-configured')
    return toBase64(publicKeyOf(key))
  }

  const sendAuthorized = async (to: string): Promise<void> => {
    await client.send(to, sign('authorized', { pcPublicKey: pcPublicKey() }, NOTICE_TTL_MS))
    const esp = deps.esp32Key()
    if (esp) await client.send(to, sign('esp32-key', { key: toBase64(esp) }, NOTICE_TTL_MS))
  }

  const controllers = (): RemoteController[] => cfg().controllers

  /** Who holds the controller role in the Worker, read once per inbox read. */
  const roleHolders = (): Promise<Set<string>> => {
    roles ??= client.controllers().then((ids) => new Set(ids))
    return roles
  }

  /** Not counted: the envelope was not authenticated. */
  const countable = (reason: ResultReason): boolean => reason !== 'signature' && reason !== 'shape'

  // ── Incoming requests ────────────────────────────────────────────────────────

  async function authorizeRequest(msg: InboxMessage, now: number): Promise<void> {
    // Anyone in the sync can send one: never counted, never clears the count.
    if (++authorizeRequests > MAX_AUTHORIZE_REQUESTS_PER_CYCLE) return ignored('refused')
    const body = parseAuthorizeRequest(msg.env.body)
    if (!body) return ignored('shape')
    const check = checkEnvelope(msg.env, body.key, now, seen(now))
    if (!check.ok) return ignored(check.reason)
    markSeen(msg.env, now)
    const priv = deps.pcPrivateKey()
    if (!priv) return
    dirty = true
    pending.set(msg.from, {
      id: msg.from,
      name: body.name,
      publicKey: body.publicKey,
      nonce: msg.env.nonce,
      code: pairingCode(publicKeyOf(priv), body.key),
      expiresAt: now + AUTHORIZATION_TTL_MS
    })
    // The phone needs this key to show the same 6 digits before the PC authorizes it.
    await client.send(msg.from, sign('pc-key', { pcPublicKey: pcPublicKey() }, NOTICE_TTL_MS))
  }

  async function authorizeRemote(msg: InboxMessage, now: number): Promise<void> {
    const { from, env } = msg
    // Only who got the role from /roles/remote (with the authenticator) may try
    // the password; anyone else is dropped without a check, a count or a reply.
    let holders: Set<string>
    try {
      holders = await roleHolders()
    } catch {
      log.warn('remote', 'roles_failed')
      return
    }
    if (!holders.has(from)) return ignored('unknown-controller')
    if (++authorizeRemotes > MAX_AUTHORIZE_REMOTE_PER_CYCLE) return ignored('refused')

    // The Worker already made it a controller; refused here, it is not one.
    const refuse = async (reason: ResultReason, extra: { until?: number } = {}): Promise<void> => {
      // An already authorized phone (a retried request) keeps its role.
      if (!controllers().some((c) => c.id === from)) {
        try {
          await client.removeController(from)
        } catch {
          log.warn('remote', 'remove_controller_failed')
        }
      }
      return reply(from, env.nonce, false, { reason, ...extra })
    }

    const body = parseAuthorizeRemote(env.body)
    if (!body) {
      ignored('shape')
      return refuse('shape')
    }
    const check = checkEnvelope(env, body.key, now, seen(now))
    if (!check.ok) {
      if (countable(check.reason)) refused(now, check.reason)
      else ignored(check.reason)
      return refuse(check.reason)
    }
    markSeen(env, now)
    const until = suspendedUntil(now)
    if (until !== null) return refuse('suspended', { until })
    // A phone from before the seal (spec 2026-11-09): signed, but its password
    // travelled under the sync key only. Never checked, never counted.
    if (body.outdated) {
      ignored('outdated')
      return refuse('outdated')
    }
    const priv = deps.pcPrivateKey()
    let password: string
    try {
      if (!priv) throw new ControlDecryptError()
      password = openPasswordFromPc(priv, body.key, body.sealedPassword)
    } catch {
      // Not sealed to this PC's key: shaped like a malformed body, not counted.
      ignored('shape')
      return refuse('shape')
    }
    if (!deps.verifyPassword(password)) {
      refused(now, 'wrong-password')
      return refuse('wrong-password')
    }
    accepted()
    // The Worker already removed every former controller (/roles/remote); here
    // only this PC's own list changes.
    update((c) => ({
      ...c,
      controllers: [
        { id: from, name: body.name, publicKey: body.publicKey, since: new Date(now).toISOString() }
      ]
    }))
    pending.delete(from)
    log.info('remote', 'authorize_remote', { result: 'ok' })
    await sendAuthorized(from)
  }

  async function controllerRequest(msg: InboxMessage, now: number): Promise<void> {
    const { from, env } = msg
    const ctrl = controllers().find((c) => c.id === from)
    if (!ctrl) {
      ignored('unknown-controller')
      return reply(from, env.nonce, false, { reason: 'unknown-controller' })
    }
    let key: Uint8Array
    try {
      key = fromBase64(ctrl.publicKey)
    } catch {
      ignored('signature')
      return reply(from, env.nonce, false, { reason: 'signature' })
    }
    const check = checkEnvelope(env, key, now, seen(now))
    if (!check.ok) {
      if (countable(check.reason)) refused(now, check.reason)
      else ignored(check.reason)
      return reply(from, env.nonce, false, { reason: check.reason })
    }
    markSeen(env, now)
    const until = suspendedUntil(now)

    switch (env.kind) {
      case 'unlock': {
        if (until !== null) return reply(from, env.nonce, false, { reason: 'suspended', until })
        accepted()
        if (deps.isLocked()) deps.unlock()
        log.info('remote', 'unlock', { result: 'ok' })
        return reply(from, env.nonce, true)
      }
      case 'lock': {
        accepted()
        deps.lock()
        log.info('remote', 'lock', { result: 'ok' })
        return reply(from, env.nonce, true)
      }
      case 'shutdown': {
        if (until !== null) return reply(from, env.nonce, false, { reason: 'suspended', until })
        accepted()
        // Already scheduled: no second flush; the phone shows the countdown.
        if (deps.shutdownAt() !== null) return reply(from, env.nonce, true)
        let result: 'ok' | 'flush-failed' | 'failed'
        try {
          result = await deps.shutdown()
        } catch {
          result = 'failed'
        }
        if (result === 'flush-failed') {
          log.warn('remote', 'shutdown', { result: 'flush-failed' })
          return reply(from, env.nonce, false, { reason: 'flush-failed' }, 'shutdown-failed')
        }
        if (result === 'failed') {
          log.warn('remote', 'shutdown', { result: 'failed' })
          // No reason: the phone shows its generic refusal.
          return reply(from, env.nonce, false)
        }
        log.info('remote', 'shutdown', { result: 'ok' })
        // From here every heartbeat says watch=false; say it now, before the PC goes down.
        queueOffline()
        return reply(from, env.nonce, true)
      }
      case 'install-update': {
        if (until !== null) return reply(from, env.nonce, false, { reason: 'suspended', until })
        accepted()
        if (deps.updateVersion() === null) {
          log.info('remote', 'install_update', { result: 'none' })
          return reply(from, env.nonce, false, { reason: 'no-update' })
        }
        // Answered first: installing quits this app, and the answer would never leave.
        await reply(from, env.nonce, true)
        const result = await deps.installUpdate()
        log.info('remote', 'install_update', { result })
        return
      }
      case 'abort-shutdown': {
        accepted()
        try {
          await deps.abortShutdown()
        } catch {
          log.warn('remote', 'abort_shutdown', { result: 'failed' })
          return reply(from, env.nonce, false)
        }
        log.info('remote', 'abort_shutdown', { result: 'ok' })
        return reply(from, env.nonce, true)
      }
      case 'restore-access': {
        // Only through the Worker's restore route, which checked the second
        // factor: the phone's signature alone does not lift a cut.
        if (msg.factor !== true) {
          refused(now, 'factor')
          return reply(from, env.nonce, false, { reason: 'factor' })
        }
        if (until !== null) return reply(from, env.nonce, false, { reason: 'suspended', until })
        accepted()
        if (cfg().accessCutAt !== null) {
          update((c) => ({ ...c, accessCutAt: null }))
          deps.onAccessRestored()
        }
        log.info('remote', 'restore', { result: 'ok' })
        return reply(from, env.nonce, true)
      }
      case 'server-start': {
        // None of these refusals counts: the request was authenticated.
        const body = parseServerRequest(env.body)
        if (!body) {
          ignored('shape')
          return reply(from, env.nonce, false, { reason: 'shape' })
        }
        if (until !== null) return reply(from, env.nonce, false, { reason: 'suspended', until })
        let result: RcStartResult
        try {
          result = await deps.startServer(body.projectId, 'phone')
        } catch {
          result = 'start-failed'
        }
        if (result !== 'ok') return reply(from, env.nonce, false, { reason: result })
        accepted()
        serverRequests.set(body.projectId, { controllerId: from, at: now })
        return reply(from, env.nonce, true)
      }
      case 'server-stop': {
        // Turning a server off always passes, suspended or not.
        const body = parseServerRequest(env.body)
        if (!body) {
          ignored('shape')
          return reply(from, env.nonce, false, { reason: 'shape' })
        }
        let result: RcStopResult
        try {
          result = await deps.stopServer(body.projectId)
        } catch {
          result = 'unknown-server'
        }
        if (result !== 'ok') return reply(from, env.nonce, false, { reason: result })
        // Not accepted(): it passes while suspended, so it must not clear the count.
        return reply(from, env.nonce, true)
      }
      case 'approval-answer': {
        const body = parseApprovalAnswer(env.body)
        if (!body) {
          refused(now, 'shape')
          return reply(from, env.nonce, false, { reason: 'shape' })
        }
        accepted()
        // An id no longer pending (answered on the PC, expired, or made up) is not
        // an attack when the signature is valid: it just answers "gone".
        const ok = deps.answerCard(body.id, body.approved)
        return reply(from, env.nonce, ok, ok ? {} : { reason: 'gone' })
      }
      default:
        // PC-to-phone kinds have no meaning here.
        return
    }
  }

  /**
   * "Cortar acesso" never counts toward the suspension and is never barred by
   * it: otherwise whoever holds a phone could send bad requests to keep the
   * real one from cutting. An invalid one is just ignored.
   */
  async function cutAccess(msg: InboxMessage, now: number): Promise<void> {
    const { from, env } = msg
    const ctrl = controllers().find((c) => c.id === from)
    if (!ctrl) {
      ignored('unknown-controller')
      return reply(from, env.nonce, false, { reason: 'unknown-controller' })
    }
    let key: Uint8Array
    try {
      key = fromBase64(ctrl.publicKey)
    } catch {
      ignored('signature')
      return reply(from, env.nonce, false, { reason: 'signature' })
    }
    const check = checkEnvelope(env, key, now, seen(now))
    if (!check.ok) {
      ignored(check.reason)
      return reply(from, env.nonce, false, { reason: check.reason })
    }
    markSeen(env, now)
    if (cfg().accessCutAt === null) {
      update((c) => ({ ...c, accessCutAt: now }))
      deps.onAccessCut()
      queueNotify('access-cut')
    }
    log.info('remote', 'cut', { result: 'ok' })
    return reply(from, env.nonce, true)
  }

  async function handle(msg: InboxMessage, now: number): Promise<void> {
    if (msg.env.kind === 'authorize-request') return authorizeRequest(msg, now)
    if (msg.env.kind === 'authorize-remote') return authorizeRemote(msg, now)
    if (msg.env.kind === 'cut-access') return cutAccess(msg, now)
    return controllerRequest(msg, now)
  }

  // ── Cycle ────────────────────────────────────────────────────────────────────

  /** What the heartbeat and every push say about this PC right now. */
  async function buildStatus(now: number): Promise<PcStatus> {
    const servers = pcServers(await deps.serverList())
    return {
      v: 1,
      at: now,
      locked: deps.isLocked(),
      servers,
      pendingCards: deps.pendingCards(),
      shutdownAt: deps.shutdownAt(),
      suspendedUntil: suspendedUntil(now),
      updateVersion: deps.updateVersion(),
      accessCutAt: cfg().accessCutAt
    }
  }

  async function heartbeat(now: number): Promise<void> {
    const status = await buildStatus(now)
    const servers = status.servers
    lastStatus = status
    const env = sign('status', status, STATUS_TTL_MS)
    // watch=false while a shutdown is scheduled: the PC is going down on purpose.
    await client.putStatus(env, { watch: deps.shutdownAt() === null })
    await publishKey()
    // "PC pronto" waits only for the servers with "Iniciar com o Sagyou".
    if (!readySent && servers.every((s) => !s.autostart || s.up)) {
      readySent = true
      for (const c of controllers()) await client.send(c.id, env, 'ready')
    }
  }

  /**
   * Keeps this PC's public key in the Worker (spec 2026-11-09): a phone far from
   * home seals the Sagyou password to it. Checked every heartbeat, so a PC that
   * becomes the PC again publishes without a restart. Never stops the heartbeat.
   */
  const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i])

  async function publishKey(): Promise<void> {
    try {
      const { pc, publicKey } = await client.pcKey()
      if (pc !== client.me()) return
      const mine = fromBase64(pcPublicKey())
      if (publicKey && sameBytes(publicKey, mine)) return
      await client.publishPcKey(mine)
      log.info('remote', 'pc_key_published')
    } catch (error) {
      const code = error instanceof ControlError ? error.code : 'offline'
      log.warn('remote', 'pc_key_publish_failed', { code })
    }
  }

  const noteError = (error: unknown): void => {
    const code: ControlErrorCode = error instanceof ControlError ? error.code : 'offline'
    if (code !== lastError) {
      log.warn('remote', 'cycle_failed', { code })
      dirty = true
    }
    lastError = code
  }

  async function checkDevices(): Promise<void> {
    const list = await deps.devices()
    const live = new Set(list.filter((d) => !d.revoked).map((d) => d.id))
    const gone = controllers().filter((c) => !live.has(c.id))
    if (gone.length) {
      update((c) => ({ ...c, controllers: c.controllers.filter((x) => live.has(x.id)) }))
      log.info('remote', 'revoke', { reason: 'sync', count: gone.length })
    }
    for (const id of [...pending.keys()]) if (!live.has(id)) pending.delete(id)

    // Spec 2026-11-13: tell the phones when a device is paired or revoked. The first check
    // after the Sagyou opens only makes the base.
    const current = new Map(list.map((d) => [d.id, d.revoked]))
    if (knownDevices !== null) {
      for (const [id, revoked] of current) {
        if (!knownDevices.has(id)) {
          if (!revoked) queueNotify('device-paired')
        } else if (knownDevices.get(id) === false && revoked) {
          queueNotify('device-revoked')
        }
      }
    }
    knownDevices = current

    // A controller the Worker no longer has (removed there, or replaced by
    // /roles/remote) is not one here either.
    const holders = new Set(await client.controllers())
    const lost = controllers().filter((c) => !holders.has(c.id))
    if (lost.length) {
      update((c) => ({ ...c, controllers: c.controllers.filter((x) => holders.has(x.id)) }))
      log.info('remote', 'revoke', { reason: 'role', count: lost.length })
    }
  }

  async function pushEvent(code: NotifyCode, only?: string): Promise<void> {
    if (!isActive() || !deps.pcPrivateKey()) return
    const targets = only ? controllers().filter((c) => c.id === only) : controllers()
    if (targets.length === 0) return
    const env = sign('status', await buildStatus(deps.now()), STATUS_TTL_MS)
    for (const c of targets) {
      try {
        await client.send(c.id, env, code)
      } catch (error) {
        // A Worker before this version answers 400 to a new code: not a cycle error (the
        // settings screen would show it), only a line in the log.
        log.warn('remote', 'push_failed', {
          code,
          reason: error instanceof ControlError ? error.code : 'offline'
        })
      }
    }
    log.info('remote', 'push', { code, to: targets.length })
  }

  /** Started during a cycle, awaited at its end (and fine to leave alone outside one). */
  function queueNotify(code: NotifyCode, only?: string): void {
    background.push(pushEvent(code, only).catch(() => undefined))
  }

  async function sendOffline(): Promise<void> {
    try {
      const key = deps.pcPrivateKey()
      if (!key || !lastStatus) return
      // The last servers list, with everything else as it is now: a scheduled shutdown must
      // show on the phone, not the stale "pronto" of the last heartbeat.
      const now = deps.now()
      const status: PcStatus = {
        ...lastStatus,
        at: now,
        locked: deps.isLocked(),
        pendingCards: deps.pendingCards(),
        shutdownAt: deps.shutdownAt(),
        suspendedUntil: suspendedUntil(now),
        updateVersion: deps.updateVersion(),
        accessCutAt: cfg().accessCutAt
      }
      const env = sign('status', status, STATUS_TTL_MS)
      await client.putStatus(env, { watch: false })
    } catch {
      // Best effort: without it the Worker only warns later.
    }
  }

  function queueOffline(): void {
    background.push(sendOffline())
  }

  async function tick(): Promise<void> {
    if (busy || !isActive() || !deps.pcPrivateKey()) return
    busy = true
    inCycle = true
    roles = null
    authorizeRequests = 0
    authorizeRemotes = 0
    try {
      const now = deps.now()
      for (const [id, p] of pending) {
        if (p.expiresAt <= now) {
          pending.delete(id)
          dirty = true
        }
      }
      const current = cfg()
      if (current.suspendedUntil !== null && now >= current.suspendedUntil) {
        updateCounters((c) => ({ ...c, suspendedUntil: null, failures: 0 }))
      }
      if (now - lastDevicesAt >= REMOTE_DEVICES_MS) {
        lastDevicesAt = now
        try {
          await checkDevices()
        } catch {
          log.warn('remote', 'devices_failed')
        }
      }
      let failed = false
      try {
        const { messages, dropped } = await client.inbox()
        if (dropped) log.warn('remote', 'inbox_dropped', { count: dropped })
        for (const msg of messages) {
          try {
            await handle(msg, deps.now())
          } catch (error) {
            noteError(error)
            failed = true
          }
        }
      } catch (error) {
        noteError(error)
        failed = true
      }
      if (now - lastStatusAt >= REMOTE_STATUS_MS) {
        try {
          await heartbeat(deps.now())
          lastStatusAt = now
        } catch (error) {
          noteError(error)
          failed = true
        }
      }
      if (!failed && lastError !== null) {
        lastError = null
        dirty = true
      }
    } finally {
      inCycle = false
      roles = null
      try {
        flushDraft()
      } catch {
        log.warn('remote', 'config_save_failed')
      }
      busy = false
      await Promise.allSettled(background.splice(0))
      // Paused or turned off while this cycle ran: refreshLoop found no timer to clear (it is
      // re-armed only after the cycle), so the announce is made here.
      if (!isActive()) await sendOffline()
      if (dirty) {
        dirty = false
        deps.onChange?.()
      }
    }
  }

  const schedule = (ms: number): void => {
    timer = deps.setTimer(() => {
      timer = null
      void tick().finally(() => {
        if (timer === null && isActive()) schedule(REMOTE_TICK_MS)
      })
    }, ms)
  }

  const refreshLoop = (): void => {
    if (isActive()) {
      if (timer === null) schedule(0)
    } else if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
      // The loop stopped on purpose (sync paused, controlled mode off): not a silent PC.
      void sendOffline()
    }
  }

  const broadcast = async (env: () => SignedEnvelope, notify?: NotifyCode): Promise<void> => {
    if (!isActive()) return
    for (const c of controllers()) {
      try {
        await client.send(c.id, env(), notify)
      } catch (error) {
        noteError(error)
      }
    }
  }

  return {
    start() {
      wanted = true
      readySent = false
      lastStatusAt = Number.NEGATIVE_INFINITY
      lastDevicesAt = Number.NEGATIVE_INFINITY
      refreshLoop()
    },

    stop() {
      wanted = false
      pending.clear()
      refreshLoop()
    },

    tick,

    running: () => isActive() && (timer !== null || busy),

    lastError: () => lastError,

    pendingAuthorizations() {
      const now = deps.now()
      return [...pending.values()]
        .filter((p) => p.expiresAt > now)
        .map(({ id, name, code, expiresAt }) => ({ id, name, code, expiresAt }))
    },

    async authorize(id, password) {
      const p = pending.get(id)
      const now = deps.now()
      if (!p || p.expiresAt <= now) {
        pending.delete(id)
        return 'expired'
      }
      if (!deps.verifyPassword(password)) return 'wrong-password'
      await client.addController(id)
      update((c) => ({
        ...c,
        controllers: [
          ...c.controllers.filter((x) => x.id !== id),
          { id, name: p.name, publicKey: p.publicKey, since: new Date(now).toISOString() }
        ]
      }))
      pending.delete(id)
      log.info('remote', 'authorize', { result: 'ok' })
      await sendAuthorized(id)
      return 'ok'
    },

    async refuse(id) {
      const p = pending.get(id)
      pending.delete(id)
      if (!p) return
      try {
        await reply(id, p.nonce, false, { reason: 'refused' })
      } catch (error) {
        noteError(error)
      }
    },

    async revokeController(id) {
      // Local list first: from here on, its requests are refused whatever the Worker says.
      update((c) => ({ ...c, controllers: c.controllers.filter((x) => x.id !== id) }))
      log.info('remote', 'revoke', { reason: 'user', count: 1 })
      try {
        await client.removeController(id)
        await client.send(id, sign('revoked', {}, NOTICE_TTL_MS))
      } catch (error) {
        noteError(error)
      }
    },

    async sendCard(card) {
      const ttl = Math.min(MAX_TTL_MS['approval-card'], Math.max(1000, card.expiresAt - deps.now()))
      await broadcast(() => sign('approval-card', card, ttl), 'approval')
    },

    async closeCard(id) {
      await broadcast(() => sign('approval-closed', { id }, NOTICE_TTL_MS))
    },

    async publishEsp32Key() {
      const key = deps.esp32Key()
      if (!key) return
      await client.putEsp32Key(key)
      for (const c of controllers()) {
        await client.send(c.id, sign('esp32-key', { key: toBase64(key) }, NOTICE_TTL_MS))
      }
    },

    syncStatusChanged(status) {
      syncActive = SYNC_RUNNING_STATES.includes(status.state) && status.paused === null
      refreshLoop()
    },

    checkDevices,

    statusSoon() {
      lastStatusAt = Number.NEGATIVE_INFINITY
    },

    notifyEvent: pushEvent,

    async serverReady(projectId) {
      const request = serverRequests.get(projectId)
      if (!request) return
      serverRequests.delete(projectId)
      if (deps.now() - request.at > SERVER_REQUEST_MS) return
      await pushEvent('server-ready', request.controllerId)
    },

    async serverFailed(projectId, phase) {
      const request = serverRequests.get(projectId)
      serverRequests.delete(projectId)
      if (phase === 'start') {
        if (!request || deps.now() - request.at > SERVER_REQUEST_MS) return
        await pushEvent('server-failed', request.controllerId)
        return
      }
      await pushEvent('server-failed')
    },

    async announceOffline() {
      await sendOffline()
    }
  }
}
