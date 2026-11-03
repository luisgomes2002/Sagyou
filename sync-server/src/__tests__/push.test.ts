// @vitest-environment node
import { generateKeyPairSync, createVerify } from 'crypto'
import { describe, expect, it } from 'vitest'
import { PUSH_TEXT, sendPush, serviceJwt } from '../push'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const account = {
  type: 'service_account',
  project_id: 'sagyou-teste',
  client_email: 'fcm@sagyou-teste.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

interface Sent {
  url: string
  init: RequestInit
}

function fakeFetch(opts: { fcmStatus?: number; tokenOk?: boolean } = {}): {
  fetch: typeof fetch
  sent: Sent[]
} {
  const sent: Sent[] = []
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    if (url.startsWith('https://oauth2')) {
      return new Response(JSON.stringify({ access_token: 'ya29.teste' }), {
        status: opts.tokenOk === false ? 400 : 200
      })
    }
    return new Response('{}', { status: opts.fcmStatus ?? 200 })
  }) as unknown as typeof fetch
  return { fetch: f, sent }
}

describe('sendPush', () => {
  it('sem conta de serviço não chama nada', async () => {
    const { fetch, sent } = fakeFetch()
    await sendPush({ fetch, now: () => 0 }, ['token-1'], 'ready')
    expect(sent).toEqual([])
  })

  it('manda só o texto fixo do código, para cada token', async () => {
    const { fetch, sent } = fakeFetch()
    await sendPush(
      { serviceAccount: JSON.stringify(account), fetch, now: () => 1_800_000_000_000 },
      ['token-1', 'token-2'],
      'approval'
    )
    const fcm = sent.filter((s) => s.url.includes('fcm.googleapis.com'))
    expect(fcm.map((s) => s.url)).toEqual([
      'https://fcm.googleapis.com/v1/projects/sagyou-teste/messages:send',
      'https://fcm.googleapis.com/v1/projects/sagyou-teste/messages:send'
    ])
    const body = JSON.parse(fcm[0].init.body as string)
    expect(body.message).toEqual({
      token: 'token-1',
      notification: { title: 'Sagyou', body: PUSH_TEXT.approval },
      data: { open: 'pc' },
      android: { priority: 'high' }
    })
    expect(PUSH_TEXT.approval).toBe('Aprovação pendente no Sagyou.')
    expect((fcm[0].init.headers as Record<string, string>).authorization).toBe('Bearer ya29.teste')
  })

  it('erro do Google não lança', async () => {
    const { fetch } = fakeFetch({ fcmStatus: 500 })
    await expect(
      sendPush({ serviceAccount: JSON.stringify(account), fetch, now: () => 0 }, ['t'], 'ready')
    ).resolves.toBeUndefined()
    const refused = fakeFetch({ tokenOk: false })
    await sendPush({ serviceAccount: JSON.stringify(account), fetch: refused.fetch, now: () => 0 }, ['t'], 'ready')
    expect(refused.sent.some((s) => s.url.includes('fcm'))).toBe(false)
  })

  it('conta de serviço malformada não lança nem chama nada', async () => {
    const { fetch, sent } = fakeFetch()
    await sendPush({ serviceAccount: '{"x":1}', fetch, now: () => 0 }, ['t'], 'ready')
    expect(sent).toEqual([])
  })
})

describe('serviceJwt', () => {
  it('é um RS256 válido para a chave da conta', async () => {
    const jwt = await serviceJwt(account, 1_800_000_000_000)
    const [h, c, s] = jwt.split('.')
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({
      iss: account.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      iat: 1_800_000_000,
      exp: 1_800_003_600
    })
    const verify = createVerify('RSA-SHA256')
    verify.update(`${h}.${c}`)
    expect(verify.verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })
})
