// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ControlClient, InboxMessage } from '@sagyou/core/control/client'
import { newSigningKeys, pairingCode, publicKeyOf } from '@sagyou/core/control/crypto'
import { signEnvelope, type ControlKind, type SignedEnvelope } from '@sagyou/core/control/messages'
import { toBase64 } from '@sagyou/core/sync/bytes'
import type { SyncStatus } from '@sagyou/core/sync/engine'
import { defaultRemoteConfig, type RemoteConfig } from '../modules/remote/remote-config'
import {
  AUTHORIZATION_TTL_MS,
  REMOTE_SUSPEND_MS,
  createRemoteService,
  type RemoteServiceDeps
} from '../modules/remote/remote-service'

const T0 = 1_800_000_000_000
const PHONE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)
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

function setup(opts: { controllers?: 'phone' | 'none'; locked?: boolean; esp32?: boolean } = {}) {
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
  } as unknown as ControlClient & {
    send: ReturnType<typeof vi.fn>
    inbox: ReturnType<typeof vi.fn>
    addController: ReturnType<typeof vi.fn>
    removeController: ReturnType<typeof vi.fn>
    putEsp32Key: ReturnType<typeof vi.fn>
  }
  let locked = opts.locked ?? true
  const timers: { fn: () => void; ms: number }[] = []
  const esp = opts.esp32 ? new Uint8Array(32).fill(7) : null
  let devices = [{ id: PHONE, revoked: false }]
  const deps: RemoteServiceDeps = {
    client,
    config: () => config,
    save: (c) => {
      config = c
    },
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
    verifyPassword: (p) => p === PASSWORD,
    unlock: vi.fn(() => {
      locked = false
    }),
    lock: vi.fn(() => {
      locked = true
    }),
    shutdown: vi.fn(async () => 'ok' as const),
    abortShutdown: vi.fn(async () => {}),
    shutdownAt: () => null,
    servers: async () => [{ name: 'Sagyou', up: true }],
    pendingCards: () => 0,
    answerCard: vi.fn(() => true),
    devices: async () => devices,
    esp32Key: () => esp,
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
    ;(t.client.inbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ messages: [req], dropped: 0 })
    await again.tick()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'replay' })
  })

  it('pedido de quem não é controle é recusado e conta como erro', async () => {
    const t = setup()
    const stranger = newSigningKeys()
    await t.deliver(t.request('unlock', {}, { from: OTHER, key: stranger.privateKey }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'unknown-controller' })
    expect(t.config().failures).toBe(1)
  })

  it('assinatura de outra chave é recusada', async () => {
    const t = setup()
    await t.deliver(t.request('unlock', {}, { key: newSigningKeys().privateKey }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'signature' })
  })

  it('pedido velho (emitido há 91 s) é recusado', async () => {
    const t = setup()
    await t.deliver(t.request('unlock', {}, { at: T0 - 91_000 }))
    expect(t.deps.unlock).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('5 recusas suspendem por 15 min; depois desbloqueia', async () => {
    const t = setup()
    const bad = newSigningKeys().privateKey
    for (let i = 0; i < 5; i++) await t.deliver(t.request('unlock', {}, { key: bad }))
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
    const bad = newSigningKeys().privateKey
    for (let i = 0; i < 4; i++) await t.deliver(t.request('unlock', {}, { key: bad }))
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

  it('desligar com flush falhando responde flush-failed e avisa shutdown-failed', async () => {
    const t = setup()
    ;(t.deps.shutdown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('flush-failed')
    await t.deliver(t.request('shutdown'))
    const last = t.sent.at(-1)!
    expect(last.env.body).toMatchObject({ ok: false, reason: 'flush-failed' })
    expect(last.notify).toBe('shutdown-failed')
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

  it('resposta a cartão pendente resolve', async () => {
    const t = setup()
    await t.deliver(t.request('approval-answer', { id: 'card-1', approved: false }))
    expect(t.deps.answerCard).toHaveBeenCalledWith('card-1', false)
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
    await t.deliver(t.request('authorize-request', authBody(newPhone.privateKey), { from: OTHER, key: newPhone.privateKey }))
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
    await t.deliver(t.request('authorize-request', authBody(newPhone.privateKey), { from: OTHER, key: newPhone.privateKey }))
    expect(await t.service.authorize(OTHER, 'errada')).toBe('wrong-password')
    expect(t.client.addController).not.toHaveBeenCalled()

    expect(await t.service.authorize(OTHER, PASSWORD)).toBe('ok')
    expect(t.client.addController).toHaveBeenCalledWith(OTHER)
    expect(t.config().controllers.map((c) => c.id)).toEqual([OTHER])
    const kinds = t.sent.filter((s) => s.to === OTHER).map((s) => s.env.kind)
    expect(kinds).toEqual(['authorized', 'esp32-key'])
    const authorized = t.sent.find((s) => s.env.kind === 'authorized')!
    expect(authorized.env.body).toEqual({ pcPublicKey: toBase64(t.pc.publicKey) })
    expect(t.service.pendingAuthorizations()).toEqual([])
  })

  it('pedido de autorização com assinatura de outra chave é ignorado', async () => {
    const t = setup({ controllers: 'none' })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-request', authBody(newPhone.privateKey), { from: OTHER, key: newSigningKeys().privateKey })
    )
    expect(t.service.pendingAuthorizations()).toEqual([])
    expect(t.config().failures).toBe(1)
  })

  it('autorização à distância com senha certa troca os controles e envia authorized e esp32-key', async () => {
    const t = setup({ esp32: true })
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-remote', { ...authBody(newPhone.privateKey), password: PASSWORD }, { from: OTHER, key: newPhone.privateKey })
    )
    expect(t.config().controllers.map((c) => c.id)).toEqual([OTHER])
    // The Worker already cleared the former controllers.
    expect(t.client.removeController).not.toHaveBeenCalled()
    expect(t.sent.filter((s) => s.to === OTHER).map((s) => s.env.kind)).toEqual(['authorized', 'esp32-key'])
    expect(t.deps.log.info).toHaveBeenCalledWith('remote', 'authorize_remote', { result: 'ok' })
  })

  it('autorização à distância com senha errada remove o papel no Worker e responde wrong-password', async () => {
    const t = setup()
    const newPhone = newSigningKeys()
    await t.deliver(
      t.request('authorize-remote', { ...authBody(newPhone.privateKey), password: 'errada' }, { from: OTHER, key: newPhone.privateKey })
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
      t.request('authorize-remote', { ...authBody(newPhone.privateKey), password: PASSWORD }, { from: OTHER, key: newPhone.privateKey })
    )
    expect(verify).not.toHaveBeenCalled()
    expect(t.lastResult()).toMatchObject({ ok: false, reason: 'suspended' })
    expect(t.config().controllers.map((c) => c.id)).toEqual([PHONE])
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
})

describe('remote-service: ciclo', () => {
  it('manda o status assinado e avisa ready uma vez por início', async () => {
    const t = setup()
    await t.service.tick()
    expect(t.statuses).toHaveLength(1)
    expect(t.statuses[0].kind).toBe('status')
    expect(t.statuses[0].body).toMatchObject({ v: 1, at: T0, locked: true, pendingCards: 0 })
    expect(t.sent.filter((s) => s.notify === 'ready').map((s) => s.to)).toEqual([PHONE])

    t.advance(30_000)
    await t.service.tick()
    expect(t.statuses).toHaveLength(2)
    expect(t.sent.filter((s) => s.notify === 'ready')).toHaveLength(1)
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
    const card = { id: 'c1', session: 'Sagyou', tool: 'delete_task', resumo: 'Apagar', expiresAt: T0 + 300_000 }
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
