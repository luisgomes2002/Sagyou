import {
  parseApprovalCard,
  parseApprovalClosed,
  parseAuthorized,
  parseEsp32Key,
  parsePcKey,
  parseResult,
  type ApprovalCardBody,
  type ResultBody
} from '@sagyou/core/control/bodies'
import { ControlError, type ControlClient, type InboxMessage } from '@sagyou/core/control/client'
import {
  pairingCode,
  powerCommandMac,
  powerStateMac,
  type PowerCommand
} from '@sagyou/core/control/crypto'
import {
  MAX_TTL_MS,
  checkEnvelope,
  isEnvelope,
  parsePcStatus,
  type ControlKind,
  type PcStatus,
  type SignedEnvelope
} from '@sagyou/core/control/messages'
import { pcState, type PcView } from '@sagyou/core/control/state'
import { CONTROL_TEXT, suspendedText } from '@sagyou/core/control/texts'
import { toBase64 } from '@sagyou/core/sync/bytes'
import { create } from 'zustand'
import {
  KeyCancelledError,
  KeyInvalidatedError,
  type AuthorizationState,
  type ControllerKeys
} from './keys'
import { REMOTE_TEXT } from './texts'

/** What the store needs from the app; injected so tests run without native modules. */
export interface RemoteDeps {
  client: ControlClient
  keys: ControllerKeys
  now: () => number
  deviceName: () => string
  /** Biometrics for the ESP32 commands, whose key is not bound to the Keystore prompt. */
  authenticate: () => Promise<boolean>
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export const POLL_MS = 5_000
/** A power command waits this long in the Worker for the ESP32. */
export const POWER_TTL_MS = 120_000
/** How long "Cortar acesso" waits for the PC's answer before offering the ESP32. */
export const CUT_WAIT_MS = 60_000

export interface RemoteStore {
  authorized: AuthorizationState
  view: PcView | null
  status: PcStatus | null
  cards: ApprovalCardBody[]
  /** The answer to the last action, or why it failed. */
  error: string | null
  /** Connection to the Worker (offline, old Worker); cleared by the next good refresh. */
  connection: string | null
  /** "Celulares anteriores perderam o controle…" after a remote authorization. */
  notice: string | null
  pairingCode: string | null
  /** "Estou longe do PC" waited longer than the Worker keeps it (1 h). */
  requestExpired: boolean
  busy: boolean
  init(): Promise<void>
  requestAuthorization(): Promise<void>
  requestRemote(password: string, factor: string): Promise<void>
  /** Gives up a request the PC never answered: deletes the keys, back to 'none'. */
  cancelRequest(): Promise<void>
  refresh(): Promise<void>
  startPolling(): void
  stopPolling(): void
  wake(): Promise<void>
  shutdown(): Promise<void>
  forceShutdown(): Promise<void>
  abortShutdown(): Promise<void>
  unlock(): Promise<void>
  lock(): Promise<void>
  installUpdate(): Promise<void>
  /** "Cortar acesso": no answer in CUT_WAIT_MS offers the ESP32 shutdown. */
  cutAccess(): Promise<void>
  /** "Restaurar acesso": the Worker checks `factor` (6 digits or a backup code). */
  restoreAccess(factor: string): Promise<void>
  answer(id: string, approved: boolean): Promise<void>
  removeThisPhone(): Promise<void>
  /** Hands this phone's FCM token to the Worker (push.ts decides when). */
  putPushToken(token: string): Promise<void>
  clearError(): void
  /** After a wipe or when leaving: forget everything in memory. */
  reset(): void
}

let deps: RemoteDeps | null = null
let pcIdCache: string | null = null
let timer: unknown = null
/** Nonces of PC messages already handled. */
const seen = new Set<string>()
/** Our requests waiting for a result, by nonce. */
const requests = new Map<string, ControlKind>()
/** The nonce of the authorization request, whose refusal may come before we know the PC key. */
let authNonce: string | null = null

export function configureRemote(next: RemoteDeps | null): void {
  deps = next
  pcIdCache = null
  seen.clear()
  requests.clear()
  authNonce = null
}

const initial = {
  authorized: 'none' as AuthorizationState,
  view: null,
  status: null,
  cards: [] as ApprovalCardBody[],
  error: null,
  connection: null,
  notice: null,
  pairingCode: null,
  requestExpired: false,
  busy: false
}

function connectionText(error: unknown): string | null {
  if (!(error instanceof ControlError)) return REMOTE_TEXT.generic
  switch (error.code) {
    case 'not-deployed':
      return CONTROL_TEXT.notDeployed
    case 'offline':
      return CONTROL_TEXT.offline
    case 'factor':
      return REMOTE_TEXT.factor
    case 'locked':
      return REMOTE_TEXT.locked
    case 'conflict':
      return REMOTE_TEXT.noPc
    default:
      return REMOTE_TEXT.generic
  }
}

function resultText(result: ResultBody): string {
  switch (result.reason) {
    case 'wrong-password':
      return CONTROL_TEXT.wrongPassword
    case 'suspended':
      return result.until ? suspendedText(result.until) : CONTROL_TEXT.refused
    case 'flush-failed':
      return CONTROL_TEXT.flushFailed
    case 'gone':
      return CONTROL_TEXT.cardGone
    case 'install-failed':
      return CONTROL_TEXT.installFailed
    case 'no-update':
      return REMOTE_TEXT.noUpdate
    case 'refused':
      return REMOTE_TEXT.refused
    case 'factor':
      return REMOTE_TEXT.factor
    default:
      return CONTROL_TEXT.refused
  }
}

const sameKey = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export const useRemote = create<RemoteStore>((set, get) => {
  const need = (): RemoteDeps => {
    if (!deps) throw new Error('remote not configured')
    return deps
  }

  const pcId = async (): Promise<string> => {
    if (pcIdCache) return pcIdCache
    const id = await need().client.pcId()
    if (!id) throw new ControlError('conflict')
    pcIdCache = id
    return id
  }

  const forget = async (state: Partial<RemoteStore>): Promise<void> => {
    await need().keys.clear()
    requests.clear()
    authNonce = null
    set({ ...initial, ...state })
  }

  /** Every action's failure: the biometrics changed, cancelled, or the Worker answered. */
  const fail = async (error: unknown): Promise<void> => {
    if (error instanceof KeyInvalidatedError) {
      await forget({ error: CONTROL_TEXT.biometricsChanged })
      return
    }
    if (error instanceof KeyCancelledError) {
      set({ busy: false })
      return
    }
    if (error instanceof ControlError && error.code === 'forbidden' && get().authorized === 'yes') {
      await forget({ error: REMOTE_TEXT.revoked })
      return
    }
    set({ busy: false, error: connectionText(error) })
  }

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      await action()
      set({ busy: false })
    } catch (error) {
      await fail(error)
    }
  }

  /** Returns the request's nonce, which the PC's result answers. */
  const sendToPc = async (kind: ControlKind, body: Record<string, unknown>): Promise<string> => {
    const d = need()
    const pc = await pcId()
    const env = await d.keys.sign(kind, body)
    requests.set(env.nonce, kind)
    await d.client.send(pc, env)
    return env.nonce
  }

  const power = async (cmd: PowerCommand): Promise<void> => {
    const d = need()
    if (!(await d.authenticate())) return
    const key = await d.keys.esp32Key()
    if (!key) {
      set({ error: REMOTE_TEXT.noEsp32Key })
      return
    }
    const at = d.now()
    const exp = at + POWER_TTL_MS
    await d.client.powerCommand(cmd, at, exp, powerCommandMac(key, cmd, at, exp))
  }

  // ── Messages from the PC ──────────────────────────────────────────────────────

  const handleResult = async (env: SignedEnvelope): Promise<void> => {
    const result = parseResult(env.body)
    if (!result) return
    if (result.replyTo === authNonce) {
      if (!result.ok) await forget({ error: resultText(result) })
      return
    }
    if (!requests.has(result.replyTo)) return
    requests.delete(result.replyTo)
    set({ error: result.ok ? null : resultText(result) })
  }

  const handle = async (msg: InboxMessage, pc: string): Promise<void> => {
    const d = need()
    const { env } = msg
    if (msg.from !== pc || seen.has(env.nonce)) return
    const now = d.now()
    const once = (nonce: string): boolean => seen.has(nonce)
    const pcKey = await d.keys.pcPublicKey()

    if (env.kind === 'pc-key') {
      const parsed = parsePcKey(env.body)
      if (get().authorized !== 'pending' || !parsed) return
      if (!checkEnvelope(env, parsed.key, now, once).ok) return
      seen.add(env.nonce)
      const mine = await d.keys.publicKey()
      await d.keys.setPcPublicKey(parsed.key)
      set({ pairingCode: mine ? pairingCode(mine, parsed.key) : null })
      return
    }

    if (env.kind === 'authorized') {
      const parsed = parseAuthorized(env.body)
      const state = get().authorized
      if (!parsed || (state !== 'pending' && state !== 'waiting-pc')) return
      if (!checkEnvelope(env, parsed.key, now, once).ok) return
      // Asked here at home: it must be the key whose code was compared on both screens.
      if (state === 'pending' && (!pcKey || !sameKey(pcKey, parsed.key))) return
      seen.add(env.nonce)
      await d.keys.setPcPublicKey(parsed.key)
      await d.keys.setState('yes')
      authNonce = null
      set({ authorized: 'yes', pairingCode: null })
      return
    }

    if (!pcKey) {
      // Before we know the PC key, only a refusal of our own authorization request counts
      // (a forged one could at most make us ask again).
      if (env.kind === 'result' && isEnvelope(env) && env.expiresAt > now) {
        seen.add(env.nonce)
        await handleResult(env)
      }
      return
    }
    if (!checkEnvelope(env, pcKey, now, once).ok) return
    seen.add(env.nonce)

    switch (env.kind) {
      case 'result':
        await handleResult(env)
        return
      case 'esp32-key': {
        const key = parseEsp32Key(env.body)
        if (key) await d.keys.setEsp32Key(key)
        return
      }
      case 'approval-card': {
        const card = parseApprovalCard(env.body)
        if (!card || card.expiresAt <= now) return
        set({ cards: [...get().cards.filter((c) => c.id !== card.id), card] })
        return
      }
      case 'approval-closed': {
        const closed = parseApprovalClosed(env.body)
        if (closed) set({ cards: get().cards.filter((c) => c.id !== closed.id) })
        return
      }
      case 'revoked':
        await forget({ error: REMOTE_TEXT.revoked })
        return
      default:
        return
    }
  }

  const loadPcState = async (pc: string): Promise<void> => {
    const d = need()
    const now = d.now()
    const pcKey = await d.keys.pcPublicKey()
    let status: PcStatus | null = null
    const slot = await d.client.getStatus()
    if (slot && slot.from === pc && pcKey && checkEnvelope(slot.env, pcKey, now, () => false).ok) {
      status = parsePcStatus(slot.env.body)
    }
    const powerView = await d.client.powerState()
    const esp = await d.keys.esp32Key()
    const report = powerView.state
    const power = report
      ? {
          pcPing: report.pcPing,
          at: report.at,
          lastPoll: report.lastPoll,
          verified:
            !!esp && powerStateMac(esp, report.pcPing, report.lastResult, report.at) === report.mac
        }
      : null
    const lc = powerView.lastCommand
    const lastCommand = lc ? { cmd: lc.cmd, at: lc.at, takenAt: lc.takenAt ?? null } : null
    const view = pcState({ now, status, power, lastCommand })
    const espError =
      report && power?.verified && powerView.lastCommand && report.at >= powerView.lastCommand.at
        ? report.lastResult === 'clock'
          ? CONTROL_TEXT.esp32Clock
          : report.lastResult && report.lastResult !== 'ok'
            ? CONTROL_TEXT.esp32Refused
            : null
        : null
    set({
      status,
      view,
      cards: get().cards.filter((c) => c.expiresAt > now),
      ...(espError ? { error: espError } : {})
    })
  }

  let polling = false
  const schedule = (): void => {
    const d = need()
    timer = d.setTimer(() => {
      timer = null
      void get()
        .refresh()
        .finally(() => {
          if (timer === null && polling) schedule()
        })
    }, POLL_MS)
  }

  return {
    ...initial,

    async init() {
      const d = need()
      const state = await d.keys.state()
      const pcKey = await d.keys.pcPublicKey()
      // A request from before this was kept has no time: no notice (decision 8).
      const requestedAt = state === 'waiting-pc' ? await d.keys.requestedAt() : null
      set({
        authorized: state === 'yes' && !pcKey ? 'none' : state,
        requestExpired:
          requestedAt !== null && d.now() - requestedAt > MAX_TTL_MS['authorize-remote']
      })
    },

    requestAuthorization: () =>
      run(async () => {
        const d = need()
        const pc = await pcId()
        const fresh = await d.keys.renew()
        const env = fresh.sign('authorize-request', {
          name: d.deviceName().slice(0, 80) || 'Celular',
          publicKey: toBase64(fresh.publicKey)
        })
        authNonce = env.nonce
        await d.client.send(pc, env)
        await d.keys.setState('pending')
        set({ authorized: 'pending', pairingCode: null, notice: null })
      }),

    requestRemote: (password, factor) =>
      run(async () => {
        const d = need()
        const fresh = await d.keys.renew()
        const env = fresh.sign(
          'authorize-remote',
          {
            name: d.deviceName().slice(0, 80) || 'Celular',
            publicKey: toBase64(fresh.publicKey),
            password
          },
          MAX_TTL_MS['authorize-remote']
        )
        authNonce = env.nonce
        await d.client.remoteRole({ totp: factor.trim() }, env)
        await d.keys.setRequestedAt(env.issuedAt)
        await d.keys.setState('waiting-pc')
        set({ authorized: 'waiting-pc', notice: CONTROL_TEXT.previousRevoked })
        // Already a controller in the Worker: the ESP32 key lets it turn the PC on now.
        try {
          const key = await d.client.getEsp32Key()
          if (key) await d.keys.setEsp32Key(key)
        } catch {
          // The PC sends it again with the authorization.
        }
      }),

    async refresh() {
      if (!deps || get().authorized === 'none') return
      if (get().authorized === 'waiting-pc' && !get().requestExpired) {
        const at = await deps.keys.requestedAt()
        if (at !== null && deps.now() - at > MAX_TTL_MS['authorize-remote']) {
          set({ requestExpired: true })
        }
      }
      try {
        const pc = await pcId()
        const { messages } = await need().client.inbox()
        for (const msg of messages) await handle(msg, pc)
        if (get().authorized !== 'none' && get().authorized !== 'pending') await loadPcState(pc)
        set({ connection: null })
      } catch (error) {
        if (
          error instanceof ControlError &&
          error.code === 'forbidden' &&
          get().authorized === 'yes'
        ) {
          await forget({ error: REMOTE_TEXT.revoked })
          return
        }
        set({ connection: connectionText(error) })
      }
    },

    startPolling() {
      if (!deps || polling) return
      polling = true
      void get().refresh()
      if (timer === null) schedule()
    },

    stopPolling() {
      polling = false
      if (timer !== null && deps) deps.clearTimer(timer)
      timer = null
    },

    wake: () => run(() => power('wake')),
    forceShutdown: () => run(() => power('shutdown')),
    abortShutdown: () =>
      run(async () => {
        // Scheduled by the Sagyou (the PC is alive and counting down): cancel there;
        // forced through the ESP32 (no heartbeat, a stale shutdownAt says nothing): cancel there.
        if (get().view?.state === 'shutting-down') await sendToPc('abort-shutdown', {})
        else await power('abort-shutdown')
      }),
    shutdown: () => run(() => sendToPc('shutdown', {})),
    unlock: () => run(() => sendToPc('unlock', {})),
    lock: () => run(() => sendToPc('lock', {})),
    installUpdate: () => run(() => sendToPc('install-update', {})),

    cutAccess: () =>
      run(async () => {
        const nonce = await sendToPc('cut-access', {})
        const d = need()
        // Still unanswered: the PC (or its Sagyou) is not responding.
        d.setTimer(() => {
          if (!requests.has(nonce)) return
          requests.delete(nonce)
          set({ error: REMOTE_TEXT.cutNoAnswer })
        }, CUT_WAIT_MS)
      }),

    restoreAccess: (factor) => {
      const code = factor.trim()
      if (!code) {
        set({ error: REMOTE_TEXT.needFactor })
        return Promise.resolve()
      }
      return run(async () => {
        const d = need()
        const env = await d.keys.sign('restore-access', {})
        requests.set(env.nonce, 'restore-access')
        try {
          await d.client.restore({ totp: code }, env)
        } catch (error) {
          requests.delete(env.nonce)
          throw error
        }
      })
    },

    answer: (id, approved) =>
      run(async () => {
        const card = get().cards.find((c) => c.id === id)
        if (!card || card.expiresAt <= need().now()) {
          set({ cards: get().cards.filter((c) => c.id !== id), error: CONTROL_TEXT.cardGone })
          return
        }
        await sendToPc('approval-answer', { id, approved })
        set({ cards: get().cards.filter((c) => c.id !== id) })
      }),

    async cancelRequest() {
      const state = get().authorized
      if (state !== 'pending' && state !== 'waiting-pc') return
      get().stopPolling()
      await forget({})
    },

    async removeThisPhone() {
      get().stopPolling()
      await forget({})
    },

    async putPushToken(token) {
      if (!deps) throw new Error('remote not configured')
      await deps.client.putPushToken(token)
    },

    clearError: () => set({ error: null }),

    reset() {
      get().stopPolling()
      pcIdCache = null
      seen.clear()
      requests.clear()
      authNonce = null
      set({ ...initial })
    }
  }
})
