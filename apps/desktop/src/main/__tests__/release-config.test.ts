// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The updater reads what these files publish; a release that ships without its
// manifests would leave every installed copy unable to find the next version.
const desktop = join(__dirname, '..', '..', '..')
const repo = join(desktop, '..', '..')
const read = (file: string): string => readFileSync(join(desktop, file), 'utf8')
const readRepo = (file: string): string => readFileSync(join(repo, file), 'utf8')

describe('configuração de release do atualizador', () => {
  const builder = read('electron-builder.yml')
  const workflow = readRepo('.github/workflows/release.yml')
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('publica no GitHub do projeto, não na URL de exemplo', () => {
    expect(builder).toMatch(/provider:\s*github/)
    expect(builder).toMatch(/owner:\s*luisgomes2002/)
    expect(builder).toMatch(/repo:\s*Sagyou/)
    expect(builder).not.toContain('example.com')
  })

  it('mantém appId e productName, que definem a pasta de dados do usuário', () => {
    expect(builder).toMatch(/^appId: com\.sagyou\.app$/m)
    expect(builder).toMatch(/^productName: Sagyou$/m)
    expect(builder).not.toMatch(/deleteAppDataOnUninstall:\s*true/)
  })

  it('gera o zip do macOS com nome que o workflow encontra', () => {
    expect(builder).toMatch(/-\s*zip/)
    expect(builder).toContain('artifactName: ${name}-${version}-mac.${ext}')
  })

  it('anexa instaladores e manifestos e falha se faltar algum', () => {
    for (const file of [
      'latest.yml',
      'latest-mac.yml',
      'latest-linux.yml',
      '*.blockmap',
      'sagyou-*-mac.zip'
    ]) {
      expect(workflow).toContain(file)
    }
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('fail_on_unmatched_files: true')
  })

  it('confere que a tag e o package.json têm a mesma versão', () => {
    expect(workflow).toContain('GITHUB_REF_NAME#v')
    expect(workflow).toMatch(/require\('\.\/apps\/desktop\/package\.json'\)\.version/)
  })

  it('a versão do desktop é a mesma no package.json e no package-lock', () => {
    const version = (JSON.parse(read('package.json')) as { version: string }).version
    const lock = JSON.parse(readRepo('package-lock.json')) as {
      packages: Record<string, { version?: string }>
    }
    expect(lock.packages['apps/desktop'].version).toBe(version)
  })

  it('não deixa o electron-builder publicar sozinho', () => {
    for (const script of ['build:win', 'build:mac', 'build:linux']) {
      expect(pkg.scripts[script]).toContain('--publish never')
    }
    expect(workflow).toMatch(/electron-builder --linux AppImage deb --publish never/)
  })

  it('confere cada instalador e manifesto pelo nome, não só um glob', () => {
    for (const file of [
      'dist/sagyou-$v-setup.exe',
      'dist/sagyou-$v-setup.exe.blockmap',
      'dist/latest.yml',
      'dist/sagyou-$v-mac.zip',
      'dist/latest-mac.yml',
      'dist/sagyou-$v.AppImage',
      'dist/sagyou-$v.deb',
      'dist/latest-linux.yml'
    ]) {
      expect(workflow).toContain(file)
    }
    expect(workflow.match(/test -f "\$f"/g)?.length).toBe(3)
    const deb = builder.slice(builder.indexOf('\ndeb:'))
    expect(deb.split('\n').slice(0, 4).join('\n')).toContain(
      'artifactName: ${name}-${version}.${ext}'
    )
  })

  it('só o job de release escreve, sem token salvo no checkout e como rascunho', () => {
    expect(workflow).toMatch(/^permissions:\r?\n {2}contents: read\r?$/m)
    expect(workflow.match(/contents: write/g)?.length).toBe(1)
    const checkouts = workflow.match(/uses: actions\/checkout@/g)?.length ?? 0
    expect(workflow.match(/persist-credentials: false/g)?.length).toBe(checkouts)
    expect(workflow).toContain('draft: true')
  })

  it('fixa toda action por SHA', () => {
    const uses = workflow.match(/uses: \S+/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/)
  })

  it('roda os builds à mão sem criar Release', () => {
    expect(workflow).toMatch(/^on:[\s\S]*workflow_dispatch:/m)
    const release = workflow.slice(workflow.indexOf('\n  release:'))
    expect(release.length).toBeGreaterThan(0)
    expect(release).toContain("if: startsWith(github.ref, 'refs/tags/')")
  })

  // @sagyou/core is TypeScript source: left external, the packaged app would
  // require() a .ts file that is not even in the package.
  it('empacota o @sagyou/core dentro do bundle do main e do preload', () => {
    const config = read('electron.vite.config.ts')
    const main = config.slice(config.indexOf('main:'), config.indexOf('preload:'))
    const preload = config.slice(config.indexOf('preload:'), config.indexOf('renderer:'))
    for (const section of [main, preload])
      expect(section).toMatch(/externalizeDeps:\s*\{\s*exclude:\s*\['@sagyou\/core'\]\s*\}/)
  })

  // The core is bundled but its own imports stay external, so the installer
  // must carry them as dependencies of the desktop or the app breaks on launch.
  it('leva no instalador cada dependência do @sagyou/core', () => {
    const core = JSON.parse(readRepo('packages/core/package.json')) as {
      dependencies: Record<string, string>
    }
    const desktop = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    for (const dep of Object.keys(core.dependencies))
      expect(desktop.dependencies[dep]).toBeDefined()
    expect(desktop.dependencies['@sagyou/core']).toBeUndefined()
    expect(desktop.devDependencies['@sagyou/core']).toBeDefined()
  })

  // The APK workflow handles the signing key: it must not be able to write to
  // the repository, keep a token in the checkout, or read any other secret.
  it('o workflow do APK só lê o repositório e só os quatro secrets da assinatura', () => {
    const apk = readRepo('.github/workflows/mobile-apk.yml')
    expect(apk).toMatch(/^permissions:\r?\n {2}contents: read\r?$/m)
    expect(apk.slice(0, apk.indexOf('\n  release:'))).not.toContain('contents: write')
    const checkouts = apk.match(/uses: actions\/checkout@/g)?.length ?? 0
    expect(checkouts).toBeGreaterThan(0)
    expect(apk.match(/persist-credentials: false/g)?.length).toBe(checkouts)
    const secrets = [...new Set((apk.match(/secrets\.[A-Z0-9_]+/g) ?? []).sort())]
    expect(secrets).toEqual([
      'secrets.ANDROID_KEYSTORE_BASE64',
      'secrets.ANDROID_KEYSTORE_PASSWORD',
      'secrets.ANDROID_KEY_ALIAS',
      'secrets.ANDROID_KEY_PASSWORD'
    ])
    for (const use of apk.match(/uses: \S+/g) ?? []) expect(use).toMatch(/@[0-9a-f]{40}$/)
  })

  // Security review: secrets in a protected environment, a pinned native
  // template, a validated Gradle wrapper, and the key decoded last.
  it('o APK usa ambiente protegido, template fixado e wrapper validado antes da chave', () => {
    const apk = readRepo('.github/workflows/mobile-apk.yml')
    expect(apk).toMatch(/^ {4}environment: mobile-release\r?$/m)
    expect(apk).toMatch(/--template expo-template-bare-minimum@\d+\.\d+\.\d+/)
    const validation = apk.indexOf('gradle/actions/wrapper-validation@')
    const prebuild = apk.indexOf('expo prebuild')
    const keystore = apk.indexOf('base64 -d')
    const gradle = apk.indexOf('./gradlew')
    expect(prebuild).toBeGreaterThan(0)
    expect(validation).toBeGreaterThan(prebuild)
    expect(keystore).toBeGreaterThan(validation)
    expect(gradle).toBeGreaterThan(keystore)
  })

  // The release job is the only one that can write, so it must not see the
  // signing key, the protected environment or a checkout of the code.
  it('o APK vira release rascunho só pela tag mobile-v*, num job separado que escreve', () => {
    const apk = readRepo('.github/workflows/mobile-apk.yml')
    expect(apk).toMatch(/^permissions:\r?\n {2}contents: read\r?$/m)
    expect(apk.match(/contents: write/g)?.length).toBe(1)
    const start = apk.indexOf('\n  release:')
    expect(start).toBeGreaterThan(0)
    const release = apk.slice(start)
    expect(release).toContain('contents: write')
    expect(release).toContain('needs: [apk, notes]')
    // Run by hand from a tag, github.ref is that tag too: only the push may release.
    expect(release).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/mobile-v')"
    )
    expect(release).toContain('--draft')
    expect(release).toContain('--latest=false')
    expect(release).toContain('--title "Sagyou Android $v"')
    expect(release).not.toContain('secrets.')
    expect(release).not.toContain('environment:')
    expect(release).not.toContain('actions/checkout')
  })

  // One repository, two apps: each release lists only its own app's pull requests.
  it('as notas de cada release vêm do script, só com as PRs do próprio app', () => {
    const desktopNotes = workflow.slice(
      workflow.indexOf('\n  notes:'),
      workflow.indexOf('\n  release:')
    )
    expect(desktopNotes).toContain('node apps/desktop/scripts/release-notes.mjs "$GITHUB_REF_NAME"')
    expect(desktopNotes).toContain('fetch-depth: 0')
    expect(desktopNotes).not.toContain('contents: write')
    const desktopRelease = workflow.slice(workflow.indexOf('\n  release:'))
    expect(desktopRelease).toContain('needs: [build-windows, build-mac, build-linux, notes]')
    expect(desktopRelease).toContain('body_path: artifacts/release-notes/release-notes.md')
    expect(workflow).not.toContain('generate_release_notes')
    // The notes are the body, never an uploaded asset.
    expect(desktopRelease).not.toContain('artifacts/**/*')

    const apk = readRepo('.github/workflows/mobile-apk.yml')
    const apkNotes = apk.slice(apk.indexOf('\n  notes:'), apk.indexOf('\n  release:'))
    expect(apkNotes).toContain('node apps/desktop/scripts/release-notes.mjs "$GITHUB_REF_NAME"')
    expect(apkNotes).toContain('fetch-depth: 0')
    expect(apkNotes).not.toContain('secrets.')
    expect(apkNotes).not.toContain('environment:')
    expect(apk.slice(apk.indexOf('\n  release:'))).toContain('--notes-file notes/release-notes.md')
  })

  it('a tag mobile-v* e a do desktop não disparam o workflow uma da outra', () => {
    const apk = readRepo('.github/workflows/mobile-apk.yml')
    const apkOn = apk.slice(apk.indexOf('\non:'), apk.indexOf('\npermissions:'))
    expect(apkOn).toContain('workflow_dispatch:')
    expect(apkOn.match(/^ {6}- '.*'\r?$/gm)?.map((t) => t.trim())).toEqual(["- 'mobile-v*'"])
    const deskOn = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'))
    expect(deskOn).toContain('workflow_dispatch:')
    expect(deskOn.match(/^ {6}- '.*'\r?$/gm)?.map((t) => t.trim())).toEqual(["- 'v*.*.*'"])
  })

  it('o APK confere a tag contra o app.json antes de instalar dependências', () => {
    const apk = readRepo('.github/workflows/mobile-apk.yml')
    const check = apk.indexOf('não bate com a versão do app.json')
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(apk.indexOf('npm ci'))
    const step = apk.slice(apk.lastIndexOf('- name: Tag matches app.json', check), check)
    expect(step).toContain("if: startsWith(github.ref, 'refs/tags/mobile-v')")
  })

  it('os builds do desktop não instalam o app do celular', () => {
    const builds = workflow.slice(workflow.indexOf('\n  build-windows:'))
    expect(builds).not.toMatch(/- run: npm ci\r?$/m)
    expect(
      builds.match(/npm ci -w sagyou -w @sagyou\/core --include-workspace-root/g)
    ).toHaveLength(3)
  })

  it('o Quality confere o tipo do Worker', () => {
    expect(readRepo('.github/workflows/quality.yml')).toContain(
      'npm run typecheck -w sagyou-sync-server'
    )
  })
})
