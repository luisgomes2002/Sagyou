import { ControlError, type ControlClient, type InboxMessage } from '@sagyou/core/control/client'
import {
  newEsp32Key,
  newSigningKeys,
  openPasswordFromPc,
  pairingCode,
  powerCommandMac,
  powerStateMac
} from '@sagyou/core/control/crypto'
import {
  MAX_TTL_MS,
  checkEnvelope,
  signEnvelope,
  type ControlKind,
  type SignedEnvelope
} from '@sagyou/core/control/messages'
import { CONTROL_TEXT } from '@sagyou/core/control/texts'
import { toBase64 } from '@sagyou/core/sync/bytes'
import {
  KEY_PCPIN,
  KEY_PCPUB,
  KEY_PRIVATE,
  KEY_REQUESTED,
  KEY_STATE,
  createControllerKeys
} from '../keys'
import { CUT_WAIT_MS, configureRemote, useRemote } from '../store'
import { REMOTE_TEXT, accessCutText } from '../texts'
import { fakeSecure, type FakeSecure } from './fakes'

const NOW = 1_800_000_000_000

/** Lets a timer's async callback (an inbox read) run to the end. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}
const PC = 'p'.repeat(32)

interface FakePc {
  keys: { privateKey: Uint8Array; publicKey: Uint8Array }
  queue: InboxMessage[]
  sent: { to: string; env: SignedEnvelope }[]
  power: { cmd: string; at: number; exp: number; mac: string }[]
  status: InboxMessage | null
  powerView: Awaited<ReturnType<ControlClient['powerState']>>
  esp32: Uint8Array
  /** The PC key GET /roles/pc answers (null: the PC did not publish it). */
  workerKey: Uint8Array | null
  client: ControlClient & Record<string, jest.Mock>
  msg(kind: ControlKind, body: Record<string, unknown>, key?: Uint8Array): InboxMessage
}

function fakePc(): FakePc {
  const pc: FakePc = {
    keys: newSigningKeys(),
    queue: [],
    sent: [],
    power: [],
    status: null,
    powerView: { state: null, lastCommand: null },
    esp32: newEsp32Key(),
    workerKey: null,
    client: {} as ControlClient & Record<string, jest.Mock>,
    msg: (kind, body, key) => ({
      from: PC,
      msgId: `m-${Math.random()}`,
      env: signEnvelope(key ?? pc.keys.privateKey, kind, body, NOW, MAX_TTL_MS[kind])
    })
  }
  pc.workerKey = pc.keys.publicKey
  pc.client = {
    me: () => 'm'.repeat(32),
    pcId: jest.fn(async () => PC),
    pcKey: jest.fn(async () => ({ pc: PC, publicKey: pc.workerKey })),
    send: jest.fn(async (to: string, env: SignedEnvelope) => {
      pc.sent.push({ to, env })
    }),
    inbox: jest.fn(async () => {
      const messages = pc.queue
      pc.queue = []
      return { messages, dropped: 0 }
    }),
    getStatus: jest.fn(async () => pc.status),
    powerState: jest.fn(async () => pc.powerView),
    powerCommand: jest.fn(async (cmd: string, at: number, exp: number, mac: string) => {
      pc.power.push({ cmd, at, exp, mac })
    }),
    remoteRole: jest.fn(async () => undefined),
    getEsp32Key: jest.fn(async () => pc.esp32)
  } as unknown as ControlClient & Record<string, jest.Mock>
  return pc
}

interface Setup {
  pc: FakePc
  secure: FakeSecure
  authenticate: jest.Mock
}

function setup(): Setup {
  const pc = fakePc()
  const secure = fakeSecure()
  const authenticate = jest.fn(async () => true)
  configureRemote({
    client: pc.client,
    keys: createControllerKeys(secure, () => NOW),
    now: () => NOW,
    deviceName: () => 'Pixel 9',
    authenticate,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
  })
  useRemote.getState().reset()
  return { pc, secure, authenticate }
}

/** Asks here at home and lets the simulated PC answer pc-key, then authorized. */
async function authorize(t: Setup): Promise<void> {
  await useRemote.getState().requestAuthorization()
  const pcKey = toBase64(t.pc.keys.publicKey)
  t.pc.queue.push(t.pc.msg('pc-key', { pcPublicKey: pcKey }))
  await useRemote.getState().refresh()
  t.pc.queue.push(t.pc.msg('authorized', { pcPublicKey: pcKey }))
  t.pc.queue.push(t.pc.msg('esp32-key', { key: toBase64(t.pc.esp32) }))
  await useRemote.getState().refresh()
}

afterEach(() => {
  useRemote.getState().reset()
  configureRemote(null)
})

describe('store do controle remoto', () => {
  describe('pedido à distância vale 1 h', () => {
    const waiting = (t: Setup, requestedAt?: number): void => {
      t.secure.data.set(KEY_STATE, 'waiting-pc')
      if (requestedAt !== undefined) t.secure.data.set(KEY_REQUESTED, String(requestedAt))
    }

    it('mais de 1 h esperando o PC: o pedido expirou', async () => {
      const t = setup()
      waiting(t, NOW - 3_600_001)
      await useRemote.getState().init()
      expect(useRemote.getState()).toMatchObject({
        authorized: 'waiting-pc',
        requestExpired: true
      })
      expect(REMOTE_TEXT.requestExpired).toBe('O pedido expirou. Ligue o PC e peça de novo.')
      // "Pedir de novo" gives the request up: back to none, every key deleted.
      await useRemote.getState().cancelRequest()
      expect(useRemote.getState()).toMatchObject({ authorized: 'none', requestExpired: false })
      expect(t.secure.data.size).toBe(0)
    })

    it('dentro de 1 h o pedido continua esperando', async () => {
      const t = setup()
      waiting(t, NOW - 59 * 60_000)
      await useRemote.getState().init()
      expect(useRemote.getState().requestExpired).toBe(false)
    })

    it('pedido de antes da atualização (sem a hora) não mostra o aviso', async () => {
      const t = setup()
      waiting(t)
      await useRemote.getState().init()
      expect(useRemote.getState()).toMatchObject({
        authorized: 'waiting-pc',
        requestExpired: false
      })
    })

    it('esquecer o celular apaga a hora do pedido', async () => {
      const t = setup()
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.secure.data.has(KEY_REQUESTED)).toBe(true)
      await useRemote.getState().removeThisPhone()
      expect(t.secure.data.has(KEY_REQUESTED)).toBe(false)
    })
  })

  it('pedido de autorização: assinado pela chave nova, código igual ao do PC e autorizado', async () => {
    const t = setup()
    await useRemote.getState().requestAuthorization()
    expect(useRemote.getState().authorized).toBe('pending')
    const request = t.pc.sent[0]
    expect(request.to).toBe(PC)
    expect(request.env.kind).toBe('authorize-request')
    expect(request.env.body.name).toBe('Pixel 9')

    t.pc.queue.push(t.pc.msg('pc-key', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
    await useRemote.getState().refresh()
    const phonePub = new Uint8Array(Buffer.from(String(request.env.body.publicKey), 'base64'))
    expect(useRemote.getState().pairingCode).toBe(pairingCode(t.pc.keys.publicKey, phonePub))

    t.pc.queue.push(t.pc.msg('authorized', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
    await useRemote.getState().refresh()
    expect(useRemote.getState().authorized).toBe('yes')
    expect(useRemote.getState().pairingCode).toBeNull()
  })

  it('authorized com outra chave que a do código é ignorado', async () => {
    const t = setup()
    await useRemote.getState().requestAuthorization()
    t.pc.queue.push(t.pc.msg('pc-key', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
    await useRemote.getState().refresh()
    const other = newSigningKeys()
    t.pc.queue.push(
      t.pc.msg('authorized', { pcPublicKey: toBase64(other.publicKey) }, other.privateKey)
    )
    await useRemote.getState().refresh()
    expect(useRemote.getState().authorized).toBe('pending')
  })

  it('PC recusou a autorização: volta a nenhum, com o texto', async () => {
    const t = setup()
    await useRemote.getState().requestAuthorization()
    const nonce = t.pc.sent[0].env.nonce
    t.pc.queue.push(t.pc.msg('result', { replyTo: nonce, ok: false, reason: 'refused' }))
    await useRemote.getState().refresh()
    expect(useRemote.getState().authorized).toBe('none')
    expect(useRemote.getState().error).toBe(REMOTE_TEXT.refused)
  })

  it('estou longe do PC: fator ao Worker, aguardando o PC, aviso e chave do ESP32', async () => {
    const t = setup()
    await useRemote.getState().requestRemote('senha', ' 123456 ')
    expect(t.pc.client.remoteRole).toHaveBeenCalledWith(
      { totp: '123456' },
      expect.objectContaining({ kind: 'authorize-remote' })
    )
    const env = jest.mocked(t.pc.client.remoteRole).mock.calls[0][1] as SignedEnvelope
    expect(env.expiresAt - env.issuedAt).toBe(60 * 60_000)
    expect(t.secure.data.get(KEY_REQUESTED)).toBe(String(NOW))
    expect(useRemote.getState()).toMatchObject({
      authorized: 'waiting-pc',
      notice: CONTROL_TEXT.previousRevoked
    })
    // The PC answers with its key in "authorized" (no code to compare from afar).
    t.pc.queue.push(t.pc.msg('authorized', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
    await useRemote.getState().refresh()
    expect(useRemote.getState().authorized).toBe('yes')
  })

  describe('senha selada para a chave do PC', () => {
    const sentEnv = (t: Setup): SignedEnvelope =>
      jest.mocked(t.pc.client.remoteRole).mock.calls.at(-1)?.[1] as SignedEnvelope
    const phoneKey = (env: SignedEnvelope): Uint8Array =>
      new Uint8Array(Buffer.from(String(env.body.publicKey), 'base64'))

    it('celular novo: sela com a chave do Worker, sem a senha em claro, e guarda a chave', async () => {
      const t = setup()
      await useRemote.getState().requestRemote('senha çã', '123456')
      const env = sentEnv(t)
      expect(env.body).not.toHaveProperty('password')
      expect(
        openPasswordFromPc(t.pc.keys.privateKey, phoneKey(env), String(env.body.sealedPassword))
      ).toBe('senha çã')
      expect(t.secure.data.get(KEY_PCPUB)).toBe(toBase64(t.pc.keys.publicKey))
      expect(useRemote.getState().authorized).toBe('waiting-pc')
    })

    it('sem chave no Worker: nada é enviado e aparece o texto', async () => {
      const t = setup()
      t.pc.workerKey = null
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.pc.client.remoteRole).not.toHaveBeenCalled()
      expect(useRemote.getState()).toMatchObject({
        authorized: 'none',
        error: 'O PC ainda não publicou a chave dele. Atualize o Sagyou no PC e tente de novo.'
      })
    })

    it('sem PC no Worker: nada é enviado e pede para ativar o controle no PC', async () => {
      const t = setup()
      jest.mocked(t.pc.client.pcKey).mockResolvedValueOnce({ pc: null, publicKey: null })
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.pc.client.remoteRole).not.toHaveBeenCalled()
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.noPc)
    })

    it('celular que conhecia outra chave: nada é enviado e aparece o texto', async () => {
      const t = setup()
      t.secure.data.set(KEY_PCPUB, toBase64(newSigningKeys().publicKey))
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.pc.client.remoteRole).not.toHaveBeenCalled()
      expect(useRemote.getState().error).toBe(
        'A chave do PC mudou. Autorize este celular em casa, comparando o código.'
      )
    })

    it('celular que conhecia a mesma chave envia', async () => {
      const t = setup()
      t.secure.data.set(KEY_PCPUB, toBase64(t.pc.keys.publicKey))
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.pc.client.remoteRole).toHaveBeenCalledTimes(1)
    })

    it('fator errado e nova tentativa: continua conferindo contra a mesma chave', async () => {
      const t = setup()
      t.secure.data.set(KEY_PCPUB, toBase64(t.pc.keys.publicKey))
      jest.mocked(t.pc.client.remoteRole).mockRejectedValueOnce(new ControlError('factor'))
      await useRemote.getState().requestRemote('senha', '000000')
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.factor)
      expect(t.secure.data.get(KEY_PCPUB)).toBe(toBase64(t.pc.keys.publicKey))
      t.pc.workerKey = newSigningKeys().publicKey
      await useRemote.getState().requestRemote('senha', '123456')
      expect(t.pc.client.remoteRole).toHaveBeenCalledTimes(1)
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.pcKeyChanged)
    })

    it('aguardando o PC: authorized assinado por outra chave é ignorado', async () => {
      const t = setup()
      await useRemote.getState().requestRemote('senha', '123456')
      const other = newSigningKeys()
      t.pc.queue.push(
        t.pc.msg('authorized', { pcPublicKey: toBase64(other.publicKey) }, other.privateKey)
      )
      await useRemote.getState().refresh()
      expect(useRemote.getState().authorized).toBe('waiting-pc')
    })

    it('senha errada não esquece a chave fixada: Worker com outra chave dá pcKeyChanged', async () => {
      const t = setup()
      await useRemote.getState().requestRemote('senha', '123456')
      const nonce = sentEnv(t).nonce
      t.pc.queue.push(t.pc.msg('authorized', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
      await useRemote.getState().refresh()
      expect(t.secure.data.get(KEY_PCPIN)).toBe(toBase64(t.pc.keys.publicKey))
      // Later, a fresh request is refused (wrong password): forget() runs.
      await useRemote.getState().removeThisPhone()
      await useRemote.getState().requestRemote('errada', '123456')
      const retry = sentEnv(t).nonce
      expect(retry).not.toBe(nonce)
      t.pc.queue.push(t.pc.msg('result', { replyTo: retry, ok: false, reason: 'wrong-password' }))
      await useRemote.getState().refresh()
      expect(useRemote.getState().authorized).toBe('none')
      // An attacker swaps the key in the Worker: the phone still refuses it.
      t.pc.workerKey = newSigningKeys().publicKey
      const calls = jest.mocked(t.pc.client.remoteRole).mock.calls.length
      await useRemote.getState().requestRemote('senha', '123456')
      expect(jest.mocked(t.pc.client.remoteRole).mock.calls).toHaveLength(calls)
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.pcKeyChanged)
    })

    it('cancelar e remover este celular mantêm a chave fixada', async () => {
      const t = setup()
      await authorize(t)
      await useRemote.getState().removeThisPhone()
      await useRemote.getState().requestRemote('senha', '123456')
      await useRemote.getState().cancelRequest()
      t.pc.workerKey = newSigningKeys().publicKey
      await useRemote.getState().requestRemote('senha', '123456')
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.pcKeyChanged)
    })

    it('autorizar em casa comparando o código troca a chave fixada', async () => {
      const t = setup()
      await authorize(t)
      const fresh = newSigningKeys()
      t.pc.keys = fresh
      t.pc.workerKey = fresh.publicKey
      await useRemote.getState().removeThisPhone()
      await authorize(t)
      expect(t.secure.data.get(KEY_PCPIN)).toBe(toBase64(fresh.publicKey))
      await useRemote.getState().removeThisPhone()
      await useRemote.getState().requestRemote('senha', '123456')
      expect(useRemote.getState()).toMatchObject({ authorized: 'waiting-pc', error: null })
    })

    it('celular autorizado antes da chave fixada passa a fixar a chave que já conhecia', async () => {
      const t = setup()
      t.secure.data.set(KEY_STATE, 'yes')
      t.secure.data.set(KEY_PCPUB, toBase64(t.pc.keys.publicKey))
      await useRemote.getState().init()
      expect(t.secure.data.get(KEY_PCPIN)).toBe(toBase64(t.pc.keys.publicKey))
    })

    it('PC responde outdated: texto de atualizar o celular', async () => {
      const t = setup()
      await useRemote.getState().requestRemote('senha', '123456')
      const nonce = sentEnv(t).nonce
      t.pc.queue.push(t.pc.msg('result', { replyTo: nonce, ok: false, reason: 'outdated' }))
      await useRemote.getState().refresh()
      expect(useRemote.getState().error).toBe('Atualize o Sagyou no celular.')
    })
  })

  it('senha do Sagyou errada à distância volta com o texto', async () => {
    const t = setup()
    await useRemote.getState().requestRemote('errada', '123456')
    const nonce = (jest.mocked(t.pc.client.remoteRole).mock.calls[0][1] as SignedEnvelope).nonce
    t.pc.queue.push(t.pc.msg('result', { replyTo: nonce, ok: false, reason: 'wrong-password' }))
    await useRemote.getState().refresh()
    expect(useRemote.getState()).toMatchObject({
      authorized: 'none',
      error: CONTROL_TEXT.wrongPassword
    })
  })

  it('fator errado no Worker mostra o texto', async () => {
    const t = setup()
    jest.mocked(t.pc.client.remoteRole).mockRejectedValueOnce(new ControlError('factor'))
    await useRemote.getState().requestRemote('senha', '000000')
    expect(useRemote.getState()).toMatchObject({ authorized: 'none', error: REMOTE_TEXT.factor })
  })

  it('biometria trocada: texto e volta a não autorizado', async () => {
    const t = setup()
    await authorize(t)
    t.secure.failRead = new Error('KeyPermanentlyInvalidatedException')
    await useRemote.getState().unlock()
    expect(useRemote.getState()).toMatchObject({
      authorized: 'none',
      error: CONTROL_TEXT.biometricsChanged
    })
  })

  it('desbloquear manda pedido assinado; resultado suspenso mostra até quando', async () => {
    const t = setup()
    await authorize(t)
    await useRemote.getState().unlock()
    const req = t.pc.sent.at(-1)!
    expect(req.env.kind).toBe('unlock')
    const phonePub = new Uint8Array(Buffer.from(String(t.pc.sent[0].env.body.publicKey), 'base64'))
    expect(checkEnvelope(req.env, phonePub, NOW, () => false)).toEqual({ ok: true })
    const until = new Date(2026, 10, 3, 14, 32).getTime()
    t.pc.queue.push(
      t.pc.msg('result', { replyTo: req.env.nonce, ok: false, reason: 'suspended', until })
    )
    await useRemote.getState().refresh()
    expect(useRemote.getState().error).toBe('Desbloqueio remoto suspenso até 14:32.')
  })

  it('ligar pede biometria e manda um MAC que o ESP32 confere', async () => {
    const t = setup()
    await authorize(t)
    await useRemote.getState().wake()
    expect(t.authenticate).toHaveBeenCalled()
    const cmd = t.pc.power[0]
    expect(cmd).toMatchObject({ cmd: 'wake', at: NOW, exp: NOW + 120_000 })
    expect(cmd.mac).toBe(powerCommandMac(t.pc.esp32, 'wake', cmd.at, cmd.exp))
  })

  it('sem biometria não liga', async () => {
    const t = setup()
    await authorize(t)
    t.authenticate.mockResolvedValueOnce(false)
    await useRemote.getState().wake()
    expect(t.pc.power).toHaveLength(0)
  })

  it('cartão assinado por outra chave é ignorado; cartão vencido não é respondido', async () => {
    const t = setup()
    await authorize(t)
    const other = newSigningKeys()
    const card = {
      id: 'c1',
      session: 'Claude Code',
      tool: 'delete_task',
      resumo: 'Apagar',
      expiresAt: NOW + 60_000
    }
    t.pc.queue.push(t.pc.msg('approval-card', card, other.privateKey))
    await useRemote.getState().refresh()
    expect(useRemote.getState().cards).toEqual([])

    t.pc.queue.push(t.pc.msg('approval-card', card))
    await useRemote.getState().refresh()
    expect(useRemote.getState().cards).toEqual([card])

    t.pc.queue.push(t.pc.msg('approval-card', { ...card, id: 'c2', expiresAt: NOW + 1 }))
    await useRemote.getState().refresh()
    useRemote.setState({
      cards: useRemote.getState().cards.map((c) => (c.id === 'c2' ? { ...c, expiresAt: NOW } : c))
    })
    await useRemote.getState().answer('c2', true)
    expect(useRemote.getState().error).toBe(CONTROL_TEXT.cardGone)

    await useRemote.getState().answer('c1', true)
    expect(t.pc.sent.at(-1)?.env).toMatchObject({
      kind: 'approval-answer',
      body: { id: 'c1', approved: true }
    })
    expect(useRemote.getState().cards).toEqual([])
  })

  it('Worker antigo (501) mostra o texto de atualizar', async () => {
    const t = setup()
    await authorize(t)
    jest.mocked(t.pc.client.inbox).mockRejectedValueOnce(new ControlError('not-deployed'))
    await useRemote.getState().refresh()
    expect(useRemote.getState().connection).toBe(CONTROL_TEXT.notDeployed)
  })

  it('estado do ESP32 sem MAC válido conta como sem contato', async () => {
    const t = setup()
    await authorize(t)
    t.pc.powerView = {
      state: {
        pcPing: true,
        lastResult: 'ok',
        at: NOW - 1000,
        lastPoll: NOW - 1000,
        mac: 'forjado'
      },
      lastCommand: null
    }
    await useRemote.getState().refresh()
    expect(useRemote.getState().view?.esp32Offline).toBe(true)
    t.pc.powerView = {
      state: {
        pcPing: true,
        lastResult: 'ok',
        at: NOW - 1000,
        lastPoll: NOW - 1000,
        mac: powerStateMac(t.pc.esp32, true, 'ok', NOW - 1000)
      },
      lastCommand: null
    }
    await useRemote.getState().refresh()
    expect(useRemote.getState().view).toMatchObject({
      esp32Offline: false,
      state: 'waiting-sagyou'
    })
  })

  it('cancelar pedido pendente ou aguardando o PC apaga as chaves e volta a nenhum', async () => {
    for (const ask of ['pending', 'waiting-pc'] as const) {
      const t = setup()
      if (ask === 'pending') await useRemote.getState().requestAuthorization()
      else await useRemote.getState().requestRemote('senha', '123456')
      expect(useRemote.getState().authorized).toBe(ask)
      expect(t.secure.data.size).toBeGreaterThan(0)
      await useRemote.getState().cancelRequest()
      expect(useRemote.getState()).toMatchObject({ authorized: 'none', notice: null })
      expect(t.secure.data.size).toBe(0)
    }
  })

  it('aguardando o PC à distância: lê o estado do PC e liga pelo ESP32', async () => {
    const t = setup()
    await useRemote.getState().requestRemote('senha', '123456')
    await useRemote.getState().refresh()
    expect(useRemote.getState().view?.state).toBe('off')
    await useRemote.getState().wake()
    expect(t.pc.power[0]).toMatchObject({ cmd: 'wake', at: NOW })
    expect(t.pc.power[0].mac).toBe(powerCommandMac(t.pc.esp32, 'wake', NOW, NOW + 120_000))
  })

  it('comando não buscado pelo ESP32 há 2 min: o takenAt chega ao estado', async () => {
    const t = setup()
    await authorize(t)
    t.pc.powerView = {
      state: null,
      lastCommand: { cmd: 'wake', at: NOW - 3 * 60_000, takenAt: null }
    }
    await useRemote.getState().refresh()
    expect(useRemote.getState().view?.esp32NoAnswer).toBe(true)
    t.pc.powerView = {
      state: null,
      lastCommand: { cmd: 'wake', at: NOW - 3 * 60_000, takenAt: NOW - 3 * 60_000 + 5_000 }
    }
    await useRemote.getState().refresh()
    expect(useRemote.getState().view?.esp32NoAnswer).toBe(false)
  })

  it('cancelar desligamento forçado pelo ESP32 manda abort-shutdown ao ESP32, não ao PC', async () => {
    const t = setup()
    await authorize(t)
    t.pc.powerView = {
      state: null,
      lastCommand: { cmd: 'shutdown', at: NOW - 10_000, takenAt: NOW - 5_000 }
    }
    await useRemote.getState().refresh()
    expect(useRemote.getState().view?.forcedShutdownUntil).toBe(NOW - 5_000 + 60_000)
    const sentBefore = t.pc.sent.length
    await useRemote.getState().abortShutdown()
    expect(t.pc.power.at(-1)).toMatchObject({ cmd: 'abort-shutdown' })
    expect(t.pc.sent).toHaveLength(sentBefore)
  })

  it('nenhum segredo no estado em memória', async () => {
    const t = setup()
    await authorize(t)
    const dump = JSON.stringify(useRemote.getState())
    expect(dump).not.toContain(t.secure.data.get(KEY_PRIVATE) as string)
    expect(dump).not.toContain(toBase64(t.pc.esp32))
  })

  it('PC revogou este celular: chaves apagadas e texto', async () => {
    const t = setup()
    await authorize(t)
    t.pc.queue.push(t.pc.msg('revoked', {}))
    await useRemote.getState().refresh()
    expect(useRemote.getState()).toMatchObject({ authorized: 'none', error: REMOTE_TEXT.revoked })
    // Only the pinned PC key stays (spec 2026-11-09): a wipe or "Desconectar" deletes it.
    expect([...t.secure.data.keys()]).toEqual([KEY_PCPIN])
  })

  // Spec docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 3.
  describe('cortar e restaurar acesso', () => {
    it('cortar manda cut-access assinado ao PC', async () => {
      const t = setup()
      await authorize(t)
      await useRemote.getState().cutAccess()
      const req = t.pc.sent.at(-1)!
      expect(req.to).toBe(PC)
      expect(req.env.kind).toBe('cut-access')
      const phonePub = new Uint8Array(
        Buffer.from(String(t.pc.sent[0].env.body.publicKey), 'base64')
      )
      expect(checkEnvelope(req.env, phonePub, NOW, () => false)).toEqual({ ok: true })
    })

    it('sem resposta em 60 s: oferece forçar pelo ESP32', async () => {
      const t = setup()
      await authorize(t)
      jest.useFakeTimers()
      try {
        await useRemote.getState().cutAccess()
        expect(useRemote.getState().error).toBeNull()
        const reads = jest.mocked(t.pc.client.inbox).mock.calls.length
        jest.advanceTimersByTime(CUT_WAIT_MS)
        await flush()
        // The inbox is read once more before saying the PC did not answer.
        expect(jest.mocked(t.pc.client.inbox).mock.calls.length).toBeGreaterThan(reads)
        expect(useRemote.getState()).toMatchObject({
          error: REMOTE_TEXT.cutNoAnswer,
          cutUnanswered: true
        })
        expect(REMOTE_TEXT.cutNoAnswer).toBe(
          'O PC não respondeu. Forçar o desligamento pelo ESP32?'
        )
        await useRemote.getState().forceShutdown()
        expect(useRemote.getState().cutUnanswered).toBe(false)
      } finally {
        jest.useRealTimers()
      }
    })

    // Review of PR #48: with the PC tab out of focus nothing reads the inbox,
    // so the PC's answer waited in the Worker and the phone said "no answer".
    it('resposta que ficou no Worker (aba fora de foco) é lida antes do aviso', async () => {
      const t = setup()
      await authorize(t)
      jest.useFakeTimers()
      try {
        await useRemote.getState().cutAccess()
        const req = t.pc.sent.at(-1)!
        t.pc.queue.push(t.pc.msg('result', { replyTo: req.env.nonce, ok: true }))
        jest.advanceTimersByTime(CUT_WAIT_MS)
        await flush()
        expect(useRemote.getState()).toMatchObject({ error: null, cutUnanswered: false })
      } finally {
        jest.useRealTimers()
      }
    })

    it('resposta antes de 60 s: sem erro depois do prazo', async () => {
      const t = setup()
      await authorize(t)
      jest.useFakeTimers()
      try {
        await useRemote.getState().cutAccess()
        const req = t.pc.sent.at(-1)!
        t.pc.queue.push(t.pc.msg('result', { replyTo: req.env.nonce, ok: true }))
        await useRemote.getState().refresh()
        jest.advanceTimersByTime(CUT_WAIT_MS)
        expect(useRemote.getState().error).toBeNull()
      } finally {
        jest.useRealTimers()
      }
    })

    it('restaurar sem código não envia nada', async () => {
      const t = setup()
      await authorize(t)
      t.pc.client.restore = jest.fn(async () => undefined)
      await useRemote.getState().restoreAccess('   ')
      expect(t.pc.client.restore).not.toHaveBeenCalled()
      expect(useRemote.getState().error).toBe(REMOTE_TEXT.needFactor)
    })

    it('restaurar manda o código ao Worker com o pedido assinado', async () => {
      const t = setup()
      await authorize(t)
      t.pc.client.restore = jest.fn(async () => undefined)
      await useRemote.getState().restoreAccess(' 123456 ')
      expect(t.pc.client.restore).toHaveBeenCalledTimes(1)
      const [factor, env] = jest.mocked(t.pc.client.restore).mock.calls[0] as unknown as [
        { totp: string },
        SignedEnvelope
      ]
      expect(factor).toEqual({ totp: '123456' })
      expect(env.kind).toBe('restore-access')
    })

    it('código errado e bloqueio do Worker mostram os textos', async () => {
      const t = setup()
      await authorize(t)
      t.pc.client.restore = jest.fn(async () => {
        throw new ControlError('factor')
      })
      await useRemote.getState().restoreAccess('000000')
      expect(useRemote.getState().error).toBe('Código do autenticador inválido.')
      t.pc.client.restore = jest.fn(async () => {
        throw new ControlError('locked')
      })
      await useRemote.getState().restoreAccess('000000')
      expect(useRemote.getState().error).toBe('Muitas tentativas. Tente de novo em 15 minutos.')
    })

    it('hora do corte em HH:MM', () => {
      expect(accessCutText(new Date(2026, 10, 7, 9, 5).getTime())).toBe('Acesso cortado em 09:05.')
    })
  })
})
