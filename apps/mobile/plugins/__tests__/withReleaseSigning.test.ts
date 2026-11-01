// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyReleaseSigning } = require('../withReleaseSigning') as {
  applyReleaseSigning: (gradle: string) => string
}

// The shape of the build.gradle that `expo prebuild` generates.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}`

describe('assinatura do APK de release', () => {
  it('assina o release com a chave das variáveis de ambiente, e o debug segue com a dele', () => {
    const out = applyReleaseSigning(TEMPLATE)
    expect(out).toContain("storeFile file(System.getenv('SAGYOU_KEYSTORE_PATH'))")
    expect(out).toContain("keyAlias System.getenv('ANDROID_KEY_ALIAS')")
    const release = out.slice(out.indexOf('buildTypes'))
    expect(release).toMatch(/release \{[\s\S]*signingConfig signingConfigs\.release/)
    expect(release).toMatch(/debug \{\s*signingConfig signingConfigs\.debug/)
  })

  it('não guarda senha nem chave no build.gradle: só lê as variáveis de ambiente', () => {
    const out = applyReleaseSigning(TEMPLATE)
    expect(out).toContain("storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')")
    expect(out).toContain("keyPassword System.getenv('ANDROID_KEY_PASSWORD')")
    // The only literal passwords are the debug keystore's well-known 'android'.
    const literals = out.match(/(store|key)Password '[^']*'/g) ?? []
    expect(literals).toEqual(["storePassword 'android'", "keyPassword 'android'"])
  })

  it('é idempotente', () => {
    const once = applyReleaseSigning(TEMPLATE)
    expect(applyReleaseSigning(once)).toBe(once)
  })
})
