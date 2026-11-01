/** The version this APK was built with (app.json is bundled at build time). */
export function installedVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../../app.json') as { expo: { version: string } }).expo.version
}
