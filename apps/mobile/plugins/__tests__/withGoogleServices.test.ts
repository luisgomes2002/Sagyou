// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyGoogleServices } = require('../withGoogleServices') as {
  applyGoogleServices: (
    config: { android?: Record<string, unknown> },
    env: Record<string, string | undefined>
  ) => { android?: Record<string, unknown> }
}

const BASE = { android: { package: 'com.sagyou.mobile', versionCode: 300 } }

describe('google-services.json do Firebase', () => {
  it('sem a variável, não muda a configuração (o APK sai sem push)', () => {
    expect(applyGoogleServices(BASE, {})).toEqual(BASE)
    expect(applyGoogleServices(BASE, { GOOGLE_SERVICES_JSON: '' })).toEqual(BASE)
  })

  it('com a variável, aponta o googleServicesFile para o arquivo escrito pelo workflow', () => {
    const out = applyGoogleServices(BASE, { GOOGLE_SERVICES_JSON: '/tmp/runner/google-services.json' })
    expect(out.android).toEqual({
      package: 'com.sagyou.mobile',
      versionCode: 300,
      googleServicesFile: '/tmp/runner/google-services.json'
    })
    // The config passed in is not mutated.
    expect(BASE.android).not.toHaveProperty('googleServicesFile')
  })

  it('o arquivo nunca fica no repositório', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = require('../../app.json') as { expo: { android: Record<string, unknown> } }
    expect(app.expo.android).not.toHaveProperty('googleServicesFile')
  })
})
