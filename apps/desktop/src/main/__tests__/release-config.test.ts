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

  it('o Quality confere o tipo do Worker', () => {
    expect(readRepo('.github/workflows/quality.yml')).toContain(
      'npm run typecheck -w sagyou-sync-server'
    )
  })
})
