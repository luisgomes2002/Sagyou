// Expo config plugin: signs the release APK with the keystore the GitHub
// workflow decodes from secrets. Nothing secret lives in the repository: the
// generated build.gradle only reads environment variables at build time.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARKER = 'SAGYOU_KEYSTORE_PATH'

const RELEASE_SIGNING = `signingConfigs {
        release {
            if (System.getenv('${MARKER}')) {
                storeFile file(System.getenv('${MARKER}'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`

/** Adds the release signing config and points the release build type at it. Idempotent. */
function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle
  if (!/signingConfigs\s*\{/.test(gradle)) throw new Error('build.gradle sem signingConfigs')
  const withConfig = gradle.replace(/signingConfigs\s*\{/, RELEASE_SIGNING)
  // The template signs release with the debug key; the first match inside a
  // `release {` block of buildTypes is that line.
  const signed = withConfig.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
    '$1signingConfig signingConfigs.release'
  )
  if (signed === withConfig) throw new Error('build.gradle sem release assinado com debug')
  return signed
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents)
    return cfg
  })
}

module.exports = withReleaseSigning
module.exports.applyReleaseSigning = applyReleaseSigning
