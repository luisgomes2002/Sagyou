// @vitest-environment node
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The desktop lives in apps/desktop inside an npm workspace. Its package name is
// what Electron uses for the dev userData folder and what electron-builder puts
// in installer names, so it must stay `sagyou` after the move.
const desktop = join(__dirname, '..', '..', '..')
const repo = join(desktop, '..', '..')
const json = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

describe('layout do monorepo', () => {
  it('declara os workspaces do app, do core e do Worker', () => {
    expect(json(join(repo, 'package.json')).workspaces).toEqual([
      'apps/*',
      'packages/*',
      'sync-server'
    ])
  })

  it('mantém nome e versão do desktop', () => {
    const pkg = json(join(desktop, 'package.json')) as {
      name: string
      version: string
      scripts: Record<string, string>
    }
    expect(pkg.name).toBe('sagyou')
    expect(pkg.version).toBe('1.0.1')
    expect(pkg.scripts.postinstall).toContain('better-sqlite3')
  })

  it('leva a configuração de build junto com o desktop', () => {
    expect(existsSync(join(desktop, 'electron-builder.yml'))).toBe(true)
    expect(existsSync(join(desktop, 'electron.vite.config.ts'))).toBe(true)
    expect(existsSync(join(repo, 'electron-builder.yml'))).toBe(false)
  })

  it('tem o pacote compartilhado em packages/core', () => {
    expect(json(join(repo, 'packages', 'core', 'package.json')).name).toBe('@sagyou/core')
  })
})
