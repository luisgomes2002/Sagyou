import { openChannelSettings, type LinkingLike } from '../channels-settings'

function linking(over: Partial<Record<keyof LinkingLike, jest.Mock>> = {}): {
  api: LinkingLike
  sendIntent: jest.Mock
  openSettings: jest.Mock
} {
  const sendIntent = over.sendIntent ?? jest.fn(async () => undefined)
  const openSettings = over.openSettings ?? jest.fn(async () => undefined)
  return { api: { sendIntent, openSettings }, sendIntent, openSettings }
}

describe('openChannelSettings', () => {
  it('abre as configurações do canal pelo pacote do app', async () => {
    const l = linking()
    await openChannelSettings('security', l.api, 'com.sagyou.mobile')
    expect(l.sendIntent).toHaveBeenCalledWith('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'com.sagyou.mobile' },
      { key: 'android.provider.extra.CHANNEL_ID', value: 'security' }
    ])
    expect(l.openSettings).not.toHaveBeenCalled()
  })

  it('usa o pacote de app.json quando nenhum é dado', async () => {
    const l = linking()
    await openChannelSettings('pc', l.api)
    const extras = l.sendIntent.mock.calls[0][1] as { key: string; value: string }[]
    expect(extras[0]).toEqual({
      key: 'android.provider.extra.APP_PACKAGE',
      value: 'com.sagyou.mobile'
    })
  })

  it('se o sistema recusa o intent, abre as configurações do app', async () => {
    const l = linking({ sendIntent: jest.fn().mockRejectedValue(new Error('no activity')) })
    await expect(openChannelSettings('sessions', l.api, 'x')).resolves.toBeUndefined()
    expect(l.openSettings).toHaveBeenCalledTimes(1)
  })

  it('se nada funciona, não lança', async () => {
    const l = linking({
      sendIntent: jest.fn().mockRejectedValue(new Error('a')),
      openSettings: jest.fn().mockRejectedValue(new Error('b'))
    })
    await expect(openChannelSettings('pc', l.api, 'x')).resolves.toBeUndefined()
  })
})
