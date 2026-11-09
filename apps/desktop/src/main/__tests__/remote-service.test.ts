// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ControlClient, InboxMessage } from '@sagyou/core/control/client'
import { newSigningKeys, pairingCode, publicKeyOf } from '@sagyou/core/control/crypto'
import {
  checkEnvelope,
  signEnvelope,
  type ControlKind,
  type SignedEnvelope
} from '@sagyou/core/control/messages'
import { toBase64 } from '@sagyou/core/sync/bytes'
import type { SyncStatus } from '@sagyou/core/sync/engine'
import type { RcServerView } from '../modules/remote/rc-manager'
import { defaultRemoteConfig, type RemoteConfig } from '../modules/remote/remote-config'
import {
  AUTHORIZATION_TTL_MS,
  REMOTE_MAX_NONCES,
  REMOTE_SUSPEND_MS,
  createRemoteService,
  type RemoteService,
  type RemoteServiceDeps
} from '../modules/remote/remote-service'

const T0 = 1_800_000_000_000
const PHONE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)
const THIRD = 'c'.repeat(32)
const PASSWORD = 'senha certa'

const okSync: SyncStatus = {
  state: 'ok',
  lastSyncAt: T0,
  pendingCount: 0,
  paused: null,
  deviceName: 'PC',
  conflictCount: 0
}

interface Sent {
  to: string
  env: SignedEnvelope
  notify?: string
}

type FakeClient = ControlClient & {
  send: ReturnType<typeof vi.fn>
  inbox: ReturnType<typeof vi.fn>
  addController: ReturnType<typeof vi.fn>
  removeController: ReturnType<typeof vi.fn>
  putEsp32Key: ReturnType<typeof vi.fn>
  controllers: ReturnType<typeof vi.fn>
}

interface Keys {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

interface Setup {
  pc: Keys
  phone: Keys
  deps: RemoteServiceDeps
  service: RemoteService
  client: FakeClient
  sent: Sent[]
  statuses: SignedEnvelope[]
  timers: { fn: () => void; ms: number }[]
  request: (
    kind: ControlKind,
    body?: Record<string, unknown>,
    o?: { from?: string; key?: Uint8Array; at?: number }
  ) => InboxMessage
  deliver: (...msgs: InboxMessage[]) => Promise<void>
  results: () => Record<string, unknown>[]
  lastResult: () => Record<string, unknown> | undefined
  config: () => RemoteConfig
  setConfig: (c: RemoteConfig) => void
  advance: (ms: number) => void
  setDevices: (d: { id: string; revoked: boolean }[]) => void
  /** Who holds the controller role in the Worker. */
  setRoles: (ids: string[]) => void
  setHasPassword: (v: boolean) => void
  setServers: (list: RcServerView[]) => void
}

const server = (over: Partial<RcServerView> = {}): RcServerView => ({
  projectId: 'p1',
  name: 'Sagyou',
  enabled: true,
  autostart: true,
  state: 'running',
  confirmed: true,
  error: null,
  ...over
})

function setup(
  opts: { controllers?: 'phone' | 'none'; locked?: boolean; esp32?: boolean } = {}
): Setup {
  const pc = newSigningKeys()
  const phone = newSigningKeys()
  let now = T0
  let config: RemoteConfig = {
    ...defaultRemoteConfig(),
    enabled: true,
    pcKeys: { publicKey: toBase64(pc.publicKey), privateCipher: 'x' },
    controllers:
      opts.controllers === 'none'
        ? []
        : [{ id: PHONE, name: 'Pixel 8', publicKey: toBase64(phone.publicKey), since: 'x' }]
  }
  let queue: InboxMessage[] = []
  const sent: Sent[] = []
  const statuses: SignedEnvelope[] = []
  const client = {
    me: () => 'pc',
    send: vi.fn(async (to: string, env: SignedEnvelope, notify?: string) => {
      sent.push({ to, env, ...(notify ? { notify } : {}) })
    }),
    inbox: vi.fn(async () => {
      const messages = queue
      queue = []
      return { messages, dropped: 0 }
    }),
    putStatus: vi.fn(async (env: SignedEnvelope) => {
      statuses.push(env)
    }),
    addController: vi.fn(async () => {}),
    removeController: vi.fn(async () => {}),
    putEsp32Key: vi.fn(async () => {})
  } as unknown as FakeClient
  let locked = opts.locked ?? true
  const timers: { fn: () => void; ms: number }[] = []
  const esp = opts.esp32 ? new Uint8Array(32).fill(7) : null
  let devices = [{ id: PHONE, revoked: false }]
  let roles = [PHONE, OTHER]
  let hasPassword = true
  let servers: RcServerView[] = [server()]
  ;(client as unknown as { controllers: unknown }).controllers = vi.fn(async () => roles)
  const deps: RemoteServiceDeps = {
    client,
    config: () => config,
    save: vi.fn((c: RemoteConfig) => {
      config = c
    }),
    pcPrivateKey: () => pc.privateKey,
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, ms }
      timers.push(t)
      return t
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number])
      if (i >= 0) timers.splice(i, 1)
    },
    isLocked: () => locked,
    hasPassword: () => hasPassword,
    verifyPassword: vi.fn((p: string) => p === PASSWORD),
    unlock: vi.fn(() => {
      locked = false
    }),
    lock: vi.fn(() => {
      locked = true
    }),
    shutdown: vi.fn(async () => 'ok' as const),
    abortShutdown: vi.fn(async () => {}),
    shutdownAt: () => null,
    serverList: () => servers,
    startServer: vi.fn(async () => 'ok' as const),
    stopServer: vi.fn(async () => 'ok' as const),
    pendingCards: () => 0,
    answerCard: vi.fn(() => true),
    devices: async () => devices,
    esp32Key: () => esp,
    updateVersion: () => '1.6.1',
    installUpdate: vi.fn(async () => 'ok' as const),
    onAccessCut: vi.fn(),
    onAccessRestored: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() }
  }
  const service = createRemoteService(deps)
  service.syncStatusChanged(okSync)
  service.start()

  const request = (
    kind: ControlKind,
    body: Record<string, unknown> = {},
    o: { from?: string; key?: Uint8Array; at?: number } = {}
  ): InboxMessage => ({
    from: o.from ?? PHONE,
    msgId: `m-${Math.random()}`,
    env: signEnvelope(o.key ?? phone.privateKey, kind, body, o.at ?? now)
  })
  const deliver = async (...msgs: InboxMessage[]): Promise<void> => {
    queue.push(...msgs)
    await service.tick()
  }
  const results = (): Record<string, unknown>[] =>
    sent.filter((s) => s.env.kind === 'result').map((s) => s.env.body)
  const lastResult = (): Record<string, unknown> | undefined => results().at(-1)

  return {
    pc,
    phone,
    deps,
    service,
    client,
    sent,
    statuses,
    timers,
    request,
    deliver,
    results,
    lastResult,
    config: () => config,
    setConfig: (c: RemoteConfig) => {
      config = c
    },
    advance: (ms: number) => {
      now += ms
    },
    setDevices: (d: typeof devices) => {
      devices = d
    },
    setRoles: (ids: string[]) => {
      roles = ids
    },
    setHasPassword: (v: boolean) => {
      hasPassword = v
    },
    setServers: (list: RcServerView[]) => {
      servers = list
    }
  }
}

describe('remote-service: pedidos de um controle', () => {
  it('desbloqueia com pedido válido e responde ok', async () => {
    const t = setup()
    const req = t.request('unlock')
    await t.deliver(req)
    expect(t.deps.unlock).toHaveBeenCalledTimes(1)
    expect(t.lastResult()).toEqual({ replyTo: req.env.nonce, ok: true })
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'unlock', { result: 'ok' })
  })

  it('desbloquear já desbloqueado responde ok sem efeito', async () => {
    const t = setup({ locked: false })
    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()?.ok).toBe(true)
  })

  it('repetir o mesmo pedido é replay, e continua replay depois de reiniciar', async () => {
    const t = setup()
    const req = t.request('unlock')
    await t.deliver(req)
    await t.deliver(req)
    expect(t.deps.unlock).toHaveBeenCalledTimes(1)
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'replay' })

    // A new service over the same saved config (an app restart).
    const again = createRemoteService({ ...t.deps, unlock: vi.fn() })
    again.syncStatusChanged(okSync)
    again.start()
    ;(t.client.inbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      messages: [req],
      dropped: 0
    })
    await again.tick()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'replay' })
  })

  it('pedido de quem não é controle é recusado e não conta como erro', async () => {
    const t = setup()
    const stranger = newSigningKeys()
    await t.deliver(t.request('unlock', {}, { from: OTHER, key: stranger.privateKey }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'unknown-controller' })
    expect(t.config().failures).toBe(0)
  })

  it('5 envelopes de desconhecido não suspendem (I2)', async () => {
    const t = setup()
    const stranger = newSigningKeys().privateKey
    for (let i = 0; i < 5; i++) {
      await t.deliver(t.request('unlock', {}, { from: OTHER, key: stranger }))
    }
    expect(t.config().failures).toBe(0)
    expect(t.config().suspendedUntil).toBeNull()
    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).toHaveBeenCalledTimes(1)
  })

  it('assinatura de outra chave é recusada e não conta como erro', async () => {
    const t = setup()
    await t.deliver(t.request('unlock', {}, { key: newSigningKeys().privateKey }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'signature' })
    expect(t.config().failures).toBe(0)
  })

  it('pedido velho (emitido há 91 s) é recusado', async () => {
    const t = setup()
    await t.deliver(t.request('unlock', {}, { at: T0 - 91_000 }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('5 recusas de um controle suspendem por 15 min; depois desbloqueia', async () => {
    const t = setup()
    // Signed by the controller but out of its window: a refusal that counts.
    for (let i = 0; i < 5; i++) await t.deliver(t.request('unlock', {}, { at: T0 - 91_000 }))
    expect(t.config().suspendedUntil).toBe(T0 + REMOTE_SUSPEND_MS)
    expect(t.deps.log.warn).toHaveBeenCalledWith('remote', 'suspended', expect.anything())

    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({
      ok: false,
      reason: 'suspended',
      until: T0 + REMOTE_SUSPEND_MS
    })

    // Shutdown is suspended too, lock is not.
    await t.deliver(t.request('shutdown'))
    expect(t.deps.shutdown).not.toHaveBeenCalled()
    await t.deliver(t.request('lock'))
    expect(t.deps.lock).toHaveBeenCalledTimes(1)

    t.advance(REMOTE_SUSPEND_MS)
    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).toHaveBeenCalledTimes(1)
    expect(t.config().suspendedUntil).toBeNull()
  })

  it('um pedido aceito zera os erros', async () => {
    const t = setup()
    for (let i = 0; i < 4; i++) await t.deliver(t.request('unlock', {}, { at: T0 - 91_000 }))
    expect(t.config().failures).toBe(4)
    await t.deliver(t.request('lock'))
    expect(t.config().failures).toBe(0)
  })

  it('nonces aceitos ficam guardados até vencer', async () => {
    const t = setup()
    const req = t.request('lock')
    await t.deliver(req)
    expect(t.config().seenNonces.map((n) => n.nonce)).toContain(req.env.nonce)
    expect(t.config().seenNonces[0].until).toBeGreaterThanOrEqual(req.env.expiresAt)
  })

  it('nonces guardados têm limite e descartam os de validade mais antiga (I3)', async () => {
    const t = setup()
    const old = Array.from({ length: REMOTE_MAX_NONCES }, (_, i) => ({
      nonce: `n${i}`,
      until: T0 + 1_000 + i
    }))
    t.setConfig({ ...t.config(), seenNonces: old })
    const req = t.request('lock')
    await t.deliver(req)
    const nonces = t.config().seenNonces.map((n) => n.nonce)
    expect(nonces).toHaveLength(REMOTE_MAX_NONCES)
    expect(nonces).toContain(req.env.nonce)
    expect(nonces).not.toContain('n0')
    expect(nonces).toContain('n1')
  })

  it('grava o arquivo uma vez por ciclo, não por mensagem (I3)', async () => {
    const t = setup()
    vi.mocked(t.deps.save).mockClear()
    await t.deliver(
      t.request('lock'),
      t.request('lock'),
      t.request('unlock', {}, { at: T0 - 91_000 })
    )
    expect(t.deps.save).toHaveBeenCalledTimes(1)
    expect(t.config().seenNonces).toHaveLength(2)
    expect(t.config().failures).toBe(1)
  })

  it('a gravação do ciclo não desfaz um desligar feito no meio dele', async () => {
    const t = setup()
    vi.mocked(t.deps.unlock).mockImplementationOnce(() => {
      // remote:disable writes the config while the cycle is still running.
      t.setConfig({ ...t.config(), enabled: false })
    })
    await t.deliver(t.request('unlock'))
    expect(t.config().enabled).toBe(false)
    expect(t.config().seenNonces).toHaveLength(1)
  })

  it('desligar com flush falhando responde flush-failed e avisa shutdown-failed', async () => {
    const t = setup()
    ;(t.deps.shutdown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('flush-failed')
    await t.deliver(t.request('shutdown'))
    const last = t.sent.filter((s) => s.env.kind === 'result').at(-1)!
    expect(last.env.body).toMatchObject({ ok: false, reason: 'flush-failed' })
    expect(last.notify).toBe('shutdown-failed')
  })

  it('desligar com erro responde ok:false sem motivo e sem push de falha de salvar', async () => {
    const t = setup()
    vi.mocked(t.deps.shutdown).mockResolvedValueOnce('failed')
    await t.deliver(t.request('shutdown'))
    const last = t.sent.filter((s) => s.env.kind === 'result').at(-1)!
    expect(last.env.body.ok).toBe(false)
    expect(last.env.body.reason).toBeUndefined()
    expect(last.notify).toBeUndefined()

    vi.mocked(t.deps.shutdown).mockRejectedValueOnce(new Error('boom'))
    await t.deliver(t.request('shutdown'))
    expect(t.lastResult()).toMatchObject({ ok: false })
    expect(t.lastResult()?.reason).toBeUndefined()
  })

  it('segundo desligar com desligamento já marcado responde ok sem novo flush', async () => {
    const t = setup()
    t.deps.shutdownAt = () => T0 + 30_000
    await t.deliver(t.request('shutdown'))
    expect(t.deps.shutdown).not.toHaveBeenCalled()
    expect(t.lastResult()?.ok).toBe(true)
  })

  it('cancelar com erro responde ok:false', async () => {
    const t = setup()
    vi.mocked(t.deps.abortShutdown).mockRejectedValueOnce(new Error('boom'))
    await t.deliver(t.request('abort-shutdown'))
    expect(t.lastResult()).toMatchObject({ ok: false })
  })

  it('desligar e cancelar chamam as funções do PC', async () => {
    const t = setup()
    await t.deliver(t.request('shutdown'))
    await t.deliver(t.request('abort-shutdown'))
    expect(t.deps.shutdown).toHaveBeenCalledTimes(1)
    expect(t.deps.abortShutdown).toHaveBeenCalledTimes(1)
    expect(t.results().map((r) => r.ok)).toEqual([true, true])
  })

  it('resposta a cartão que não está pendente responde gone sem contar erro', async () => {
    const t = setup()
    ;(t.deps.answerCard as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    await t.deliver(t.request('approval-answer', { id: 'card-x', approved: true }))
    expect(t.deps.answerCard).toHaveBeenCalledWith('card-x', true)
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'gone' })
    expect(t.config().failures).toBe(0)
  })

  it('instalar atualização responde ok ao celular antes de instalar', async () => {
    const t = setup()
    const req = t.request('install-update')
    let answeredFirst = false
    vi.mocked(t.deps.installUpdate).mockImplementationOnce(async () => {
      answeredFirst = t.results().some((r) => r.replyTo === req.env.nonce && r.ok === true)
      return 'ok'
    })
    await t.deliver(req)
    expect(t.deps.installUpdate).toHaveBeenCalledTimes(1)
    expect(answeredFirst).toBe(true)
    expect(t.results().filter((r) => r.replyTo === req.env.nonce)).toHaveLength(1)
  })

  it('instalar sem versão pronta responde no-update e não instala', async () => {
    const t = setup()
    t.deps.updateVersion = () => null
    await t.deliver(t.request('install-update'))
    expect(t.deps.installUpdate).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'no-update' })
  })

  it('falha ao instalar depois do ok fica no log', async () => {
    const t = setup()
    vi.mocked(t.deps.installUpdate).mockResolvedValueOnce('failed')
    await t.deliver(t.request('install-update'))
    expect(t.lastResult()?.ok).toBe(true)
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'install_update', { result: 'failed' })
    expect(t.config().failures).toBe(0)
  })

  it('instalar atualização respeita a suspensão', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), suspendedUntil: T0 + 60_000 })
    await t.deliver(t.request('install-update'))
    expect(t.deps.installUpdate).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'suspended' })
  })

  it('resposta a cartão pendente resolve', async () => {
    const t = setup()
    await t.deliver(t.request('approval-answer', { id: 'card-1', approved: false }))
    expect(t.deps.answerCard).toHaveBeenCalledWith('card-1', false)
    expect(t.lastResult()?.ok).toBe(true)
  })
})

// Spec docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 3.
describe('remote-service: cortar e restaurar acesso', () => {
  const restore = (t: Setup, factor: boolean, at?: number): InboxMessage => ({
    ...t.request('restore-access', {}, at === undefined ? {} : { at }),
    factor
  })

  it('cortar grava a hora, chama o PC, responde ok e o status passa a dizer', async () => {
    const t = setup()
    const req = t.request('cut-access')
    await t.deliver(req)
    expect(t.config().accessCutAt).toBe(T0)
    expect(t.deps.onAccessCut).toHaveBeenCalledTimes(1)
    expect(t.lastResult()).toEqual({ replyTo: req.env.nonce, ok: true })
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'cut', { result: 'ok' })
    expect(t.statuses.at(-1)?.body).toMatchObject({ accessCutAt: T0 })
  })

  it('cortar não é barrado pela suspensão', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), suspendedUntil: T0 + REMOTE_SUSPEND_MS })
    await t.deliver(t.request('cut-access'))
    expect(t.deps.onAccessCut).toHaveBeenCalledTimes(1)
    expect(t.config().accessCutAt).toBe(T0)
  })

  it('cortar de novo com o acesso já cortado responde ok sem repetir', async () => {
    const t = setup()
    await t.deliver(t.request('cut-access'))
    t.advance(1000)
    await t.deliver(t.request('cut-access'))
    expect(t.deps.onAccessCut).toHaveBeenCalledTimes(1)
    expect(t.config().accessCutAt).toBe(T0)
    expect(t.lastResult()?.ok).toBe(true)
  })

  it('pedidos de cortar inválidos nunca contam para a suspensão', async () => {
    const t = setup()
    const stranger = newSigningKeys()
    const valid = t.request('cut-access')
    await t.deliver(valid)
    t.setConfig({ ...t.config(), accessCutAt: null })
    await t.deliver(
      t.request('cut-access', {}, { key: stranger.privateKey }),
      t.request('cut-access', {}, { at: T0 - 91_000 }),
      valid
    )
    expect(t.config().failures).toBe(0)
    expect(t.config().suspendedUntil).toBeNull()
    expect(t.deps.onAccessCut).toHaveBeenCalledTimes(1)
  })

  it('restaurar sem a marca do Worker é recusado com factor e conta', async () => {
    const t = setup()
    await t.deliver(t.request('cut-access'))
    const req = restore(t, false)
    await t.deliver(req)
    expect(t.config().accessCutAt).toBe(T0)
    expect(t.deps.onAccessRestored).not.toHaveBeenCalled()
    expect(t.lastResult()).toEqual({ replyTo: req.env.nonce, ok: false, reason: 'factor' })
    expect(t.config().failures).toBe(1)
  })

  it('restaurar com a marca, durante a suspensão, responde suspended', async () => {
    const t = setup()
    await t.deliver(t.request('cut-access'))
    t.setConfig({ ...t.config(), suspendedUntil: T0 + REMOTE_SUSPEND_MS })
    await t.deliver(restore(t, true))
    expect(t.config().accessCutAt).toBe(T0)
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'suspended' })
  })

  it('restaurar com a marca tira o corte e chama o PC', async () => {
    const t = setup()
    await t.deliver(t.request('cut-access'))
    const req = restore(t, true)
    await t.deliver(req)
    expect(t.config().accessCutAt).toBeNull()
    expect(t.deps.onAccessRestored).toHaveBeenCalledTimes(1)
    expect(t.lastResult()).toEqual({ replyTo: req.env.nonce, ok: true })
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'restore', { result: 'ok' })
  })

  it('restaurar sem corte responde ok sem efeito', async () => {
    const t = setup()
    await t.deliver(restore(t, true))
    expect(t.deps.onAccessRestored).not.toHaveBeenCalled()
    expect(t.lastResult()?.ok).toBe(true)
  })
})

describe('remote-service: autorização', () => {
  const authBody = (key: Uint8Array): Record<string, unknown> => ({
    name: 'Pixel 9',
    publicKey: toBase64(publicKeyOf(key))
  })

  it('pedido de autorização cria pendência com o código e some em 10 min', async () => {
    const t = setup({ controllers: 'none' })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-request', authBody(newPhone.privateKey), {
        from: OTHER,
        key: newPhone.privateKey
      })
    )
    // The phone gets the PC's key, signed by it, to show the same code.
    const pcKey = t.sent.find((s) => s.to === OTHER && s.env.kind === 'pc-key')!
    expect(pcKey.env.body).toEqual({ pcPublicKey: toBase64(t.pc.publicKey) })
    expect(checkEnvelope(pcKey.env, t.pc.publicKey, T0, () => false)).toEqual({ ok: true })
    expect(t.service.pendingAuthorizations()).toEqual([
      {
        id: OTHER,
        name: 'Pixel 9',
        code: pairingCode(t.pc.publicKey, newPhone.publicKey),
        expiresAt: T0 + AUTHORIZATION_TTL_MS
      }
    ])
    t.advance(AUTHORIZATION_TTL_MS)
    expect(t.service.pendingAuthorizations()).toEqual([])
    expect(await t.service.authorize(OTHER, PASSWORD)).toBe('expired')
  })

  it('autorizar localmente confere a senha, registra no Worker e envia authorized e esp32-key', async () => {
    const t = setup({ controllers: 'none', esp32: true })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-request', authBody(newPhone.privateKey), {
        from: OTHER,
        key: newPhone.privateKey
      })
    )
    expect(await t.service.authorize(OTHER, 'errada')).toBe('wrong-password')
    expect(t.client.addController).not.toHaveBeenCalled()

    expect(await t.service.authorize(OTHER, PASSWORD)).toBe('ok')
    expect(t.client.addController).toHaveBeenCalledWith(OTHER)
    expect(t.config().controllers.map((c) => c.id)).toEqual([OTHER])
    const kinds = t.sent.filter((s) => s.to === OTHER).map((s) => s.env.kind)
    expect(kinds).toEqual(['pc-key', 'authorized', 'esp32-key'])
    const authorized = t.sent.find((s) => s.env.kind === 'authorized')!
    expect(authorized.env.body).toEqual({ pcPublicKey: toBase64(t.pc.publicKey) })
    expect(t.service.pendingAuthorizations()).toEqual([])
  })

  it('pedido de autorização com assinatura de outra chave é ignorado sem contar erro', async () => {
    const t = setup({ controllers: 'none' })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-request', authBody(newPhone.privateKey), {
        from: OTHER,
        key: newSigningKeys().privateKey
      })
    )
    expect(t.service.pendingAuthorizations()).toEqual([])
    expect(t.config().failures).toBe(0)
  })

  it('pedido de autorização válido não zera os erros (C1)', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), failures: 3 })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-request', authBody(newPhone.privateKey), {
        from: OTHER,
        key: newPhone.privateKey
      })
    )
    expect(t.service.pendingAuthorizations()).toHaveLength(1)
    expect(t.config().failures).toBe(3)
  })

  it('no máximo 3 pedidos de autorização novos por ciclo (I3)', async () => {
    const t = setup({ controllers: 'none' })
    const ids = ['1', '2', '3', '4', '5'].map((d) => d.repeat(32))
    await t.deliver(
      ...ids.map((from) => {
        const k = newSigningKeys()
        return t.request('authorize-request', authBody(k.privateKey), { from, key: k.privateKey })
      })
    )
    expect(t.service.pendingAuthorizations().map((p) => p.id)).toEqual(ids.slice(0, 3))
    expect(t.sent.filter((s) => s.env.kind === 'pc-key')).toHaveLength(3)
  })

  it('autorização à distância de quem não tem o papel no Worker é descartada (C1)', async () => {
    const t = setup()
    t.setRoles([PHONE])
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(newPhone.privateKey), password: 'chute' },
        { from: OTHER, key: newPhone.privateKey }
      )
    )
    expect(t.deps.verifyPassword).not.toHaveBeenCalled()
    expect(t.config().failures).toBe(0)
    expect(t.results()).toEqual([])
    expect(t.client.removeController).not.toHaveBeenCalled()
    expect(t.config().controllers.map((c) => c.id)).toEqual([PHONE])
  })

  it('só uma autorização à distância confere a senha por ciclo (C1)', async () => {
    const t = setup()
    t.setRoles([PHONE, OTHER, THIRD])
    const a = newSigningKeys()
    const b = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(a.privateKey), password: 'chute 1' },
        { from: OTHER, key: a.privateKey }
      ),
      t.request(
        'authorize-remote',
        { ...authBody(b.privateKey), password: 'chute 2' },
        { from: THIRD, key: b.privateKey }
      )
    )
    expect(t.deps.verifyPassword).toHaveBeenCalledTimes(1)
    expect(t.config().failures).toBe(1)
  })

  it('autorização à distância com assinatura errada não conta e remove o papel', async () => {
    const t = setup()
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(newPhone.privateKey), password: PASSWORD },
        { from: OTHER, key: newSigningKeys().privateKey }
      )
    )
    expect(t.deps.verifyPassword).not.toHaveBeenCalled()
    expect(t.config().failures).toBe(0)
    expect(t.client.removeController).toHaveBeenCalledWith(OTHER)
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'signature' })
  })

  it('autorização à distância com senha certa troca os controles e envia authorized e esp32-key', async () => {
    const t = setup({ esp32: true })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(newPhone.privateKey), password: PASSWORD },
        { from: OTHER, key: newPhone.privateKey }
      )
    )
    expect(t.config().controllers.map((c) => c.id)).toEqual([OTHER])
    // The Worker already cleared the former controllers.
    expect(t.client.removeController).not.toHaveBeenCalled()
    // Then the first heartbeat of this start tells it the PC is ready.
    expect(t.sent.filter((s) => s.to === OTHER).map((s) => s.env.kind)).toEqual([
      'authorized',
      'esp32-key',
      'status'
    ])
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'authorize_remote', { result: 'ok' })
  })

  it('autorização à distância com senha errada remove o papel no Worker e responde wrong-password', async () => {
    const t = setup()
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(newPhone.privateKey), password: 'errada' },
        { from: OTHER, key: newPhone.privateKey }
      )
    )
    expect(t.client.removeController).toHaveBeenCalledWith(OTHER)
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'wrong-password' })
    expect(t.config().failures).toBe(1)
    expect(t.config().controllers.map((c) => c.id)).toEqual([PHONE])
  })

  it('autorização à distância suspensa não confere a senha', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), suspendedUntil: T0 + 60_000 })
    const verify = vi.spyOn(t.deps, 'verifyPassword')
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request(
        'authorize-remote',
        { ...authBody(newPhone.privateKey), password: PASSWORD },
        { from: OTHER, key: newPhone.privateKey }
      )
    )
    expect(verify).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'suspended' })
    expect(t.config().controllers.map((c) => c.id)).toEqual([PHONE])
    expect(t.client.removeController).toHaveBeenCalledWith(OTHER)
  })

  it('revogar tira da lista, do Worker e avisa o celular', async () => {
    const t = setup()
    await t.service.revokeController(PHONE)
    expect(t.config().controllers).toEqual([])
    expect(t.client.removeController).toHaveBeenCalledWith(PHONE)
    expect(t.sent.at(-1)?.env.kind).toBe('revoked')
    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).not.toHaveBeenCalled()
  })

  it('aparelho revogado ou ausente no sync sai do arquivo', async () => {
    const t = setup()
    t.setDevices([{ id: PHONE, revoked: true }])
    await t.service.checkDevices()
    expect(t.config().controllers).toEqual([])

    const u = setup()
    u.setDevices([])
    await u.service.checkDevices()
    expect(u.config().controllers).toEqual([])
  })

  it('controle sem o papel no Worker sai do arquivo (I1)', async () => {
    const t = setup()
    t.setRoles([OTHER])
    await t.service.checkDevices()
    expect(t.config().controllers).toEqual([])
    await t.deliver(t.request('unlock'))
    expect(t.deps.unlock).not.toHaveBeenCalled()
  })

  it('o ciclo confere os papéis no início (I1)', async () => {
    const t = setup()
    t.setRoles([])
    await t.service.tick()
    expect(t.client.controllers).toHaveBeenCalled()
    expect(t.config().controllers).toEqual([])
  })
})

describe('remote-service: ciclo', () => {
  it('manda o status assinado e avisa ready uma vez por início', async () => {
    const t = setup()
    await t.service.tick()
    expect(t.statuses).toHaveLength(1)
    expect(t.statuses[0].kind).toBe('status')
    expect(t.statuses[0].body).toMatchObject({
      v: 1,
      at: T0,
      locked: true,
      pendingCards: 0,
      updateVersion: '1.6.1'
    })
    expect(t.sent.filter((s) => s.notify === 'ready').map((s) => s.to)).toEqual([PHONE])

    t.advance(30_000)
    await t.service.tick()
    expect(t.statuses).toHaveLength(2)
    expect(t.sent.filter((s) => s.notify === 'ready')).toHaveLength(1)
  })

  it('sem senha do Sagyou o serviço não roda (M3)', async () => {
    const t = setup()
    t.setHasPassword(false)
    await t.service.tick()
    expect(t.client.inbox).not.toHaveBeenCalled()
    expect(t.service.running()).toBe(false)
  })

  it('sync inativo para o ciclo e ativo o retoma', async () => {
    const t = setup()
    expect(t.service.running()).toBe(true)
    t.service.syncStatusChanged({ ...okSync, state: 'paused', paused: 'restore' })
    expect(t.service.running()).toBe(false)
    expect(t.timers).toHaveLength(0)
    await t.service.tick()
    expect(t.client.inbox).not.toHaveBeenCalled()

    t.service.syncStatusChanged({ ...okSync, state: 'no-keychain' })
    expect(t.service.running()).toBe(false)

    t.service.syncStatusChanged(okSync)
    expect(t.service.running()).toBe(true)
    await t.service.tick()
    expect(t.client.inbox).toHaveBeenCalledTimes(1)
  })

  it('cartão vai a cada controle com push de aprovação; fechar avisa', async () => {
    const t = setup()
    const card = {
      id: 'c1',
      session: 'Sagyou',
      tool: 'delete_task',
      resumo: 'Apagar',
      expiresAt: T0 + 300_000
    }
    await t.service.sendCard(card)
    const sentCard = t.sent.at(-1)!
    expect(sentCard).toMatchObject({ to: PHONE, notify: 'approval' })
    expect(sentCard.env.kind).toBe('approval-card')
    expect(sentCard.env.body).toEqual(card)
    await t.service.closeCard('c1')
    expect(t.sent.at(-1)?.env).toMatchObject({ kind: 'approval-closed', body: { id: 'c1' } })
  })

  it('publicar a chave do ESP32 grava no Worker e envia aos controles', async () => {
    const t = setup({ esp32: true })
    await t.service.publishEsp32Key()
    expect(t.client.putEsp32Key).toHaveBeenCalledTimes(1)
    expect(t.sent.at(-1)).toMatchObject({ to: PHONE })
    expect(t.sent.at(-1)?.env.kind).toBe('esp32-key')
  })
})

describe('remote-service: servidores de Remote Control', () => {
  it('server-start válido liga pelo celular e responde ok', async () => {
    const t = setup()
    const req = t.request('server-start', { projectId: 'p1' })
    await t.deliver(req)
    expect(t.deps.startServer).toHaveBeenCalledWith('p1', 'phone')
    expect(t.lastResult()).toEqual({ replyTo: req.env.nonce, ok: true })
  })

  it('server-stop válido desliga e responde ok', async () => {
    const t = setup()
    await t.deliver(t.request('server-stop', { projectId: 'p1' }))
    expect(t.deps.stopServer).toHaveBeenCalledWith('p1')
    expect(t.lastResult()?.ok).toBe(true)
  })

  it.each(['not-confirmed', 'cut', 'unknown-server', 'start-failed'] as const)(
    'recusa %s vira o mesmo motivo e não conta nem zera os erros',
    async (reason) => {
      const t = setup()
      t.setConfig({ ...t.config(), failures: 2 })
      ;(t.deps.startServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(reason)
      await t.deliver(t.request('server-start', { projectId: 'p1' }))
      expect(t.lastResult()).toMatchObject({ ok: false, reason })
      expect(t.config().failures).toBe(2)
      expect(t.config().suspendedUntil).toBeNull()
    }
  )

  it('server-stop aceito não zera o contador de recusas', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), failures: 3 })
    await t.deliver(t.request('server-stop', { projectId: 'p1' }))
    expect(t.lastResult()?.ok).toBe(true)
    expect(t.config().failures).toBe(3)
  })

  it('server-stop de projeto desconhecido responde unknown-server sem contar', async () => {
    const t = setup()
    ;(t.deps.stopServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce('unknown-server')
    await t.deliver(t.request('server-stop', { projectId: 'p9' }))
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'unknown-server' })
    expect(t.config().failures).toBe(0)
  })

  it('suspenso: server-start é recusado sem ligar; server-stop passa', async () => {
    const t = setup()
    t.setConfig({ ...t.config(), suspendedUntil: T0 + 60_000 })
    await t.deliver(t.request('server-start', { projectId: 'p1' }))
    expect(t.deps.startServer).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'suspended', until: T0 + 60_000 })

    await t.deliver(t.request('server-stop', { projectId: 'p1' }))
    expect(t.deps.stopServer).toHaveBeenCalledWith('p1')
    expect(t.lastResult()?.ok).toBe(true)
  })

  it('corpo inválido responde shape sem chamar o gerenciador nem contar', async () => {
    const t = setup()
    await t.deliver(t.request('server-start', {}))
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'shape' })
    await t.deliver(t.request('server-stop', { projectId: 'x'.repeat(65) }))
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'shape' })
    expect(t.deps.startServer).not.toHaveBeenCalled()
    expect(t.deps.stopServer).not.toHaveBeenCalled()
    expect(t.config().failures).toBe(0)
  })

  it('o status traz só os servidores habilitados, com os campos novos', async () => {
    const t = setup()
    t.setServers([
      server({ projectId: 'p1', name: 'Sagyou', state: 'needs-confirm' }),
      server({ projectId: 'p2', name: 'Murasaki', state: 'stopped', autostart: false }),
      server({ projectId: 'p3', name: 'Outro', enabled: false, state: 'stopped' }),
      server({ projectId: 'p4', name: 'Fora', state: 'external' })
    ])
    await t.service.tick()
    expect(t.statuses[0].body.servers).toEqual([
      { name: 'Sagyou', up: true, projectId: 'p1', state: 'needs-confirm', autostart: true },
      { name: 'Murasaki', up: false, projectId: 'p2', state: 'stopped', autostart: false },
      { name: 'Fora', up: true, projectId: 'p4', state: 'external', autostart: true }
    ])
    // Only servers with "Iniciar com o Sagyou" hold back "PC pronto".
    expect(t.sent.filter((s) => s.notify === 'ready')).toHaveLength(1)
  })

  it('PC pronto espera um servidor com iniciar com o Sagyou parado', async () => {
    const t = setup()
    t.setServers([server({ state: 'starting' })])
    await t.service.tick()
    expect(t.statuses[0].body.servers).toEqual([
      { name: 'Sagyou', up: false, projectId: 'p1', state: 'starting', autostart: true }
    ])
    expect(t.sent.filter((s) => s.notify === 'ready')).toHaveLength(0)
  })

  it('statusSoon faz o próximo ciclo mandar o status antes de 30 s', async () => {
    const t = setup()
    await t.service.tick()
    expect(t.statuses).toHaveLength(1)
    t.advance(5_000)
    await t.service.tick()
    expect(t.statuses).toHaveLength(1)
    t.service.statusSoon()
    t.advance(5_000)
    await t.service.tick()
    expect(t.statuses).toHaveLength(2)
  })
})
