import { notificationTarget, registerPush, type NotificationsApi } from '../push'

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

describe('notificationTarget', () => {
  const response = (data: unknown): unknown => ({
    notification: { request: { content: { data } } }
  })

  it("open: 'pc' leva à aba PC", () => {
    expect(notificationTarget(response({ open: 'pc' }))).toBe('pc')
  })

  it('qualquer outra coisa não navega', () => {
    for (const r of [null, undefined, {}, response(null), response({}), response({ open: 'x' })])
      expect(notificationTarget(r)).toBeNull()
  })
})
