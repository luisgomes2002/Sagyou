// Node built-ins typed by hand: the app's tsconfig carries no Node types (same as node-db.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require('node:crypto') as {
  createHash(alg: string): { update(data: Uint8Array): { digest(enc: 'hex'): string } }
}
const { existsSync, readFileSync } = require('node:fs') as {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
}
const { join } = require('node:path') as { join(...parts: string[]): string }
declare const __dirname: string
/* eslint-enable @typescript-eslint/no-require-imports */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../app.json') as {
  expo: {
    android: {
      allowBackup?: boolean
      package: string
      adaptiveIcon: Record<string, string>
    }
    plugins: unknown[]
  }
}

const ASSETS = join(__dirname, '..', '..', 'assets')
const ASSET_FILES = [
  'icon.png',
  'android-icon-foreground.png',
  'android-icon-background.png',
  'android-icon-monochrome.png',
  'splash-icon.png',
  'favicon.png'
]
const hash = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(join(ASSETS, file)))
    .digest('hex')

describe('ícone e splash do Sagyou', () => {
  it('o adaptive icon tem fundo sólido #0b0b0f e as três camadas', () => {
    expect(app.expo.android.adaptiveIcon.backgroundColor).toBe('#0b0b0f')
    for (const file of ASSET_FILES)
      expect([file, existsSync(join(ASSETS, file))]).toEqual([file, true])
  })

  it('a versão monocromática não é a mesma imagem do primeiro plano', () => {
    expect(hash('android-icon-monochrome.png')).not.toBe(hash('android-icon-foreground.png'))
  })

  it('a splash mostra o ícone sobre o fundo do tema', () => {
    const splash = app.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-splash-screen'
    ) as [string, Record<string, unknown>] | undefined
    expect(splash?.[1]).toEqual({
      image: './assets/splash-icon.png',
      imageWidth: 200,
      backgroundColor: '#0b0b0f',
      dark: { backgroundColor: '#0b0b0f' },
      light: { backgroundColor: '#f5f4f1' }
    })
  })
})

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
