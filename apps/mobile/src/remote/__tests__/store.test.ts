import { ControlError, type ControlClient, type InboxMessage } from '@sagyou/core/control/client'
import {
  newEsp32Key,
  newSigningKeys,
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
import { KEY_PRIVATE, createControllerKeys } from '../keys'
import { configureRemote, useRemote } from '../store'
import { REMOTE_TEXT } from '../texts'
import { fakeSecure, type FakeSecure } from './fakes'

const NOW = 1_800_000_000_000
const PC = 'p'.repeat(32)

interface FakePc {
  keys: { privateKey: Uint8Array; publicKey: Uint8Array }
  queue: InboxMessage[]
  sent: { to: string; env: SignedEnvelope }[]
  power: { cmd: string; at: number; exp: number; mac: string }[]
  status: InboxMessage | null
  powerView: Awaited<ReturnType<ControlClient['powerState']>>
  esp32: Uint8Array
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
    client: {} as ControlClient & Record<string, jest.Mock>,
    msg: (kind, body, key) => ({
      from: PC,
      msgId: `m-${Math.random()}`,
      env: signEnvelope(key ?? pc.keys.privateKey, kind, body, NOW, MAX_TTL_MS[kind])
    })
  }
  pc.client = {
    me: () => 'm'.repeat(32),
    pcId: jest.fn(async () => PC),
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
    expect(env.expiresAt - env.issuedAt).toBe(24 * 60 * 60_000)
    expect(useRemote.getState()).toMatchObject({
      authorized: 'waiting-pc',
      notice: CONTROL_TEXT.previousRevoked
    })
    // The PC answers with its key in "authorized" (no code to compare from afar).
    t.pc.queue.push(t.pc.msg('authorized', { pcPublicKey: toBase64(t.pc.keys.publicKey) }))
    await useRemote.getState().refresh()
    expect(useRemote.getState().authorized).toBe('yes')
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
    expect(t.secure.data.size).toBe(0)
  })
})
