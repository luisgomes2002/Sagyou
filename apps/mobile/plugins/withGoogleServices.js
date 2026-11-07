// Expo config plugin: Firebase Cloud Messaging needs google-services.json in
// the native project. The workflow writes it from the GOOGLE_SERVICES_JSON
// secret to a file outside the repository and passes that file's path in the
// GOOGLE_SERVICES_JSON environment variable. Without it (a local build, a
// fork) the APK is built without push and everything else works.

/** Points android.googleServicesFile at the workflow's file, if there is one. */
function applyGoogleServices(config, env) {
  const file = env.GOOGLE_SERVICES_JSON
  if (!file) return config
  return { ...config, android: { ...config.android, googleServicesFile: file } }
}

function withGoogleServices(config) {
  return applyGoogleServices(config, process.env)
}

module.exports = withGoogleServices
module.exports.applyGoogleServices = applyGoogleServices
