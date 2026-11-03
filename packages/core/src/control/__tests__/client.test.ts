import { describe, expect, it } from 'vitest'
import type { FetchInit } from '../../sync/engine'
import type { SyncConfig } from '../../sync/config-types'
import { deriveKeys, keyProof, opaqueDeviceId } from '../../sync/crypto'
import { fromUtf8, utf8 } from '../../sync/bytes'
import { ControlError, createControlClient, type ControlClient } from '../client'
import { controlKey, newSigningKeys, openControl, sealControl } from '../crypto'
import { signEnvelope } from '../messages'

const NOW = 1_800_000_000_000
const syncKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const config: SyncConfig = {
  url: 'https://sync.example.com/',
  syncKey,
  token: 'tok_123',
  deviceName: 'Pixel',
  paused: null
}
const idKey = deriveKeys(syncKey).id
const ME = opaqueDeviceId(idKey, 'device-phone')
const PC = opaqueDeviceId(idKey, 'device-pc')
const ck = controlKey(syncKey)

interface Call {
  url: string
  init: FetchInit
}

function setup(responses: (call: Call) => { status: number; body?: unknown } | Error): {
  client: ControlClient
  calls: Call[]
} {
  const calls: Call[] = []
  const client = createControlClient({
    fetch: async (url, init) => {
      const call = { url, init }
      calls.push(call)
      const r = responses(call)
      if (r instanceof Error) throw r
      return { status: r.status, json: async () => r.body ?? {} }
    },
    config: () => config,
    deviceId: () => 'device-phone',
    now: () => NOW
  })
  return { client, calls }
}

const env = signEnvelope(newSigningKeys().privateKey, 'unlock', {}, NOW)

describe('createControlClient', () => {
  it('usa o token e só manda prova da chave e fator onde precisa', async () => {
    const { client, calls } = setup(() => ({ status: 200, body: { token: 'esp' } }))
    await client.setPc({ totp: '123456' })
    await client.createPowerToken({ totp: '654321' })
    await client.addController(PC)
    await client.powerCommand('wake', NOW, NOW + 120_000, 'ab')
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST https://sync.example.com/roles/pc',
      'POST https://sync.example.com/power-token',
      'POST https://sync.example.com/roles/controllers',
      'POST https://sync.example.com/power/command'
    ])
    for (const c of calls) expect(c.init.headers.authorization).toBe('Bearer tok_123')
    expect(calls[0].init.headers['x-key-proof']).toBe(keyProof(idKey))
    expect(calls[0].init.headers['x-totp-code']).toBe('123456')
    expect(calls[1].init.headers['x-totp-code']).toBe('654321')
    expect(calls[2].init.headers['x-key-proof']).toBe(keyProof(idKey))
    expect(calls[2].init.headers['x-totp-code']).toBeUndefined()
    expect(calls[3].init.headers['x-key-proof']).toBeUndefined()
  })

  it('send cifra para o destinatário com o AAD certo', async () => {
    const { client, calls } = setup(() => ({ status: 200 }))
    await client.send(PC, env, 'approval')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.to).toBe(PC)
    expect(body.notify).toBe('approval')
    expect(body.ttlMs).toBe(60_000)
    const plain = openControl(ck, ME, PC, body.msgId, body.ciphertext)
    expect(JSON.parse(fromUtf8(plain))).toEqual(env)
  })

  it('inbox abre as mensagens e descarta as adulteradas', async () => {
    const good = sealControl(ck, PC, ME, 'm1', utf8(JSON.stringify(env)))
    const tampered = sealControl(ck, PC, ME, 'm2', utf8(JSON.stringify(env)))
    const { client } = setup(() => ({
      status: 200,
      body: {
        messages: [
          { from: PC, msgId: 'm1', ciphertext: good },
          { from: PC, msgId: 'outro', ciphertext: tampered }
        ]
      }
    }))
    const { messages, dropped } = await client.inbox()
    expect(messages).toEqual([{ from: PC, msgId: 'm1', env }])
    expect(dropped).toBe(1)
  })

  it('remoteRole descobre o PC e sela para ele', async () => {
    const { client, calls } = setup((c) =>
      c.url.endsWith('/roles/pc') && c.init.method === 'GET'
        ? { status: 200, body: { pc: PC } }
        : { status: 200 }
    )
    await client.remoteRole({ totp: 'ABCD-EFGH-IJKL' }, env)
    const post = calls[1]
    expect(post.url).toBe('https://sync.example.com/roles/remote')
    expect(post.init.headers['x-totp-code']).toBe('ABCD-EFGH-IJKL')
    const body = JSON.parse(post.init.body as string)
    expect(() => openControl(ck, ME, PC, body.msgId, body.ciphertext)).not.toThrow()
  })

  it('a chave do ESP32 vai cifrada e volta igual', async () => {
    let stored: Record<string, unknown> = {}
    const { client } = setup((c) => {
      if (c.init.method === 'PUT') {
        stored = { ...JSON.parse(c.init.body as string), from: ME }
        return { status: 200 }
      }
      return { status: 200, body: stored }
    })
    const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i)
    await client.putEsp32Key(key)
    expect(JSON.stringify(stored)).not.toContain('255')
    expect(await client.getEsp32Key()).toEqual(key)
  })

  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [401, { error: 'invalid factor' }, 'factor'],
    [403, {}, 'forbidden'],
    [409, {}, 'conflict'],
    [410, {}, 'gone'],
    [429, {}, 'locked'],
    [501, { error: 'control not deployed' }, 'not-deployed'],
    [500, {}, 'offline']
  ])('HTTP %i vira o código de erro certo', async (status, body, code) => {
    const { client } = setup(() => ({ status, body }))
    await expect(client.pcId()).rejects.toEqual(new ControlError(code as never))
  })

  it('rede fora do ar vira offline', async () => {
    const { client } = setup(() => new Error('ECONNREFUSED'))
    await expect(client.inbox()).rejects.toMatchObject({ code: 'offline' })
  })
})
