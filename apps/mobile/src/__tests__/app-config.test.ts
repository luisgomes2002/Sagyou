// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../app.json') as {
  expo: { android: { allowBackup?: boolean; package: string }; plugins: unknown[] }
}

describe('configuração do app Android', () => {
  // Review finding: Android Auto Backup is on by default and would copy
  // sagyou.db (every record, in plain text) and the device id to Google Drive;
  // a restored phone would then clone this device's sync identity.
  it('não entra no backup automático do Android', () => {
    expect(app.expo.android.allowBackup).toBe(false)
  })

  it('assina o APK de release pelo plugin que só lê variáveis de ambiente', () => {
    expect(app.expo.plugins).toContain('./plugins/withReleaseSigning')
    expect(app.expo.android.package).toBe('com.sagyou.mobile')
  })
})
