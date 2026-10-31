// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The updater reads what these files publish; a release that ships without its
// manifests would leave every installed copy unable to find the next version.
const root = join(__dirname, '..', '..', '..')
const read = (file: string): string => readFileSync(join(root, file), 'utf8')

describe('configuração de release do atualizador', () => {
  const builder = read('electron-builder.yml')
  const workflow = read('.github/workflows/release.yml')
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
    expect(workflow).toMatch(/require\('\.\/package\.json'\)\.version/)
  })

  it('não deixa o electron-builder publicar sozinho', () => {
    for (const script of ['build:win', 'build:mac', 'build:linux']) {
      expect(pkg.scripts[script]).toContain('--publish never')
    }
    expect(workflow).toMatch(/electron-builder --linux AppImage deb --publish never/)
  })
})
