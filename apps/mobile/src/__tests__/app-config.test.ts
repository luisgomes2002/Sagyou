// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../app.json') as {
  expo: {
    version: string
    android: { allowBackup?: boolean; package: string; versionCode: number }
    plugins: unknown[]
  }
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

  // Android refuses to install an APK over one with a higher versionCode, so
  // the code is derived from the version and can only grow with it.
  it('o versionCode do Android segue a versão do app', () => {
    const [maj, min, pat] = app.expo.version.split('.').map(Number)
    expect(min).toBeLessThan(100)
    expect(pat).toBeLessThan(100)
    expect(app.expo.android.versionCode).toBe(maj * 10000 + min * 100 + pat)
  })

  it('a versão do app é a mesma nos arquivos do celular', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('../../package.json').version).toBe(app.expo.version)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lock = require('../../../../package-lock.json') as {
      packages: Record<string, { version?: string }>
    }
    expect(lock.packages['apps/mobile'].version).toBe(app.expo.version)
  })
})
