import {
  createResponseGate,
  CHANNELS,
  entryFromNotification,
  notificationTap,
  pushCode,
  registerChannels,
  registerPush,
  type NotificationsApi
} from '../push'

interface Fakes {
  notifications: Record<keyof NotificationsApi, jest.Mock>
  putPushToken: jest.Mock
}

function api(over: Partial<Record<keyof NotificationsApi, jest.Mock>> = {}): Fakes {
  const notifications = {
    getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token' })),
    ...over
  }
  const putPushToken = jest.fn(async () => undefined)
  return { notifications, putPushToken }
}

describe('registerPush', () => {
  it('só registra o token num celular autorizado', async () => {
    for (const state of ['none', 'pending', 'waiting-pc'] as const) {
      const deps = api()
      expect(await registerPush(deps, state)).toBe('not-authorized')
      expect(deps.notifications.requestPermissionsAsync).not.toHaveBeenCalled()
      expect(deps.putPushToken).not.toHaveBeenCalled()
    }
    const deps = api()
    expect(await registerPush(deps, 'yes')).toBe('registered')
    expect(deps.putPushToken).toHaveBeenCalledWith('fcm-token')
  })

  it('pede permissão quando ainda não tem', async () => {
    const deps = api({ getPermissionsAsync: jest.fn(async () => ({ granted: false })) })
    expect(await registerPush(deps, 'yes')).toBe('registered')
    expect(deps.notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
  })

  it('sem permissão, nada quebra e nenhum token sai do celular', async () => {
    const deps = api({
      getPermissionsAsync: jest.fn(async () => ({ granted: false })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: false }))
    })
    expect(await registerPush(deps, 'yes')).toBe('denied')
    expect(deps.notifications.getDevicePushTokenAsync).not.toHaveBeenCalled()
    expect(deps.putPushToken).not.toHaveBeenCalled()
  })

  it('sem Firebase no APK ou sem rede, devolve falha em vez de lançar', async () => {
    const noFirebase = api({
      getDevicePushTokenAsync: jest.fn(async () => {
        throw new Error('Default FirebaseApp is not initialized')
      })
    })
    expect(await registerPush(noFirebase, 'yes')).toBe('failed')

    const offline = api()
    offline.putPushToken.mockRejectedValueOnce(new Error('offline'))
    expect(await registerPush(offline, 'yes')).toBe('failed')

    const empty = api({
      getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: '' }))
    })
    expect(await registerPush(empty, 'yes')).toBe('failed')
    expect(empty.putPushToken).not.toHaveBeenCalled()
  })
})

const notification = (over: {
  identifier?: unknown
  data?: unknown
  body?: unknown
  date?: unknown
}): unknown => ({
  date: over.date,
  request: {
    identifier: over.identifier ?? 'n1',
    content: { body: over.body, data: over.data }
  }
})

describe('pushCode', () => {
  it('lê data.code e ignora o que não é um código conhecido', () => {
    expect(pushCode(notification({ data: { open: 'pc', code: 'approval' } }))).toBe('approval')
    expect(pushCode(notification({ data: { open: 'pc', code: 'session-waiting' } }))).toBeNull()
    expect(pushCode(notification({ data: { open: 'pc' } }))).toBeNull()
    for (const n of [null, undefined, {}, notification({ data: null })]) {
      expect(pushCode(n)).toBeNull()
    }
  })
})

describe('entryFromNotification', () => {
  const NOW = 1_800_000_000_000

  it('guarda o id do Android, o código e o horário; nunca o corpo de um código conhecido', () => {
    const n = notification({
      identifier: 'abc',
      data: { open: 'pc', code: 'server-ready' },
      body: 'Servidor de Remote Control ligado.',
      date: NOW - 5000
    })
    expect(entryFromNotification(n, NOW)).toEqual({
      id: 'abc',
      code: 'server-ready',
      at: NOW - 5000,
      read: false
    })
  })

  it('a data em segundos vale, e sem data usa o agora', () => {
    const seconds = notification({ data: { code: 'ready' }, date: Math.floor(NOW / 1000) })
    expect(entryFromNotification(seconds, NOW)?.at).toBe(Math.floor(NOW / 1000) * 1000)
    expect(entryFromNotification(notification({ data: { code: 'ready' } }), NOW)?.at).toBe(NOW)
  })

  it('push sem code (Worker antigo) vira unknown com o corpo, cortado em 200; sem corpo, sem texto', () => {
    const old = entryFromNotification(
      notification({ data: { open: 'pc' }, body: 'x'.repeat(300) }),
      NOW
    )
    expect(old?.code).toBe('unknown')
    expect(old?.text).toHaveLength(200)
    const bare = entryFromNotification(notification({ data: { open: 'pc' } }), NOW)
    expect(bare).toEqual({ id: 'n1', code: 'unknown', at: NOW, read: false })
  })

  it('sem identificador não entra no histórico', () => {
    expect(entryFromNotification({ request: { content: {} } }, NOW)).toBeNull()
    expect(entryFromNotification(notification({ identifier: '' }), NOW)).toBeNull()
    expect(entryFromNotification(null, NOW)).toBeNull()
  })
})

describe('notificationTap', () => {
  const response = (data: unknown): unknown => ({
    notification: { request: { content: { data } } }
  })

  it('aprovação leva à tela Notificações; os outros códigos, à aba PC', () => {
    expect(notificationTap(response({ open: 'pc', code: 'approval' }))).toEqual({
      target: 'notifications',
      code: 'approval'
    })
    expect(notificationTap(response({ open: 'pc', code: 'ready' }))).toEqual({
      target: 'pc',
      code: 'ready'
    })
  })

  it("o push antigo (open: 'pc' sem code) continua levando à aba PC", () => {
    expect(notificationTap(response({ open: 'pc' }))).toEqual({ target: 'pc', code: null })
  })

  it('qualquer outra coisa não navega', () => {
    for (const r of [null, undefined, {}, response(null), response({}), response({ open: 'x' })]) {
      expect(notificationTap(r)).toBeNull()
    }
  })
})

describe('createResponseGate', () => {
  const response = (identifier: unknown, data: unknown = { open: 'pc' }): unknown => ({
    notification: { request: { identifier, content: { data } } }
  })

  it('a mesma notificação tratada não reabre a tela; uma nova reabre', () => {
    const gate = createResponseGate()
    expect(gate(response('n1'))).toEqual({ target: 'pc', code: null })
    // getLastNotificationResponseAsync keeps returning the last tap on every mount.
    expect(gate(response('n1'))).toBeNull()
    expect(gate(response('n2', { open: 'pc', code: 'approval' }))).toEqual({
      target: 'notifications',
      code: 'approval'
    })
    expect(gate(response('n2', { open: 'pc', code: 'approval' }))).toBeNull()
  })

  it('o que não leva a lugar nenhum não conta como tratado', () => {
    const gate = createResponseGate()
    expect(gate(null)).toBeNull()
    expect(
      gate({ notification: { request: { identifier: 'n1', content: { data: {} } } } })
    ).toBeNull()
    expect(gate(response('n1'))).toEqual({ target: 'pc', code: null })
  })
})

describe('registerChannels', () => {
  it('cria os três canais com os nomes da spec; Segurança com importância máxima', async () => {
    const setNotificationChannelAsync = jest.fn(async () => undefined)
    await registerChannels({ setNotificationChannelAsync }, { HIGH: 4, MAX: 5 })
    expect(CHANNELS.map((c) => [c.id, c.name])).toEqual([
      ['pc', 'PC e servidores'],
      ['sessions', 'Sessões de código'],
      ['security', 'Segurança']
    ])
    expect(setNotificationChannelAsync.mock.calls).toEqual([
      ['pc', { name: 'PC e servidores', importance: 4 }],
      ['sessions', { name: 'Sessões de código', importance: 4 }],
      ['security', { name: 'Segurança', importance: 5 }]
    ])
  })

  it('uma falha de um canal não impede os outros nem lança', async () => {
    const setNotificationChannelAsync = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    await expect(
      registerChannels({ setNotificationChannelAsync }, { HIGH: 4, MAX: 5 })
    ).resolves.toBeUndefined()
    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(3)
  })
})
