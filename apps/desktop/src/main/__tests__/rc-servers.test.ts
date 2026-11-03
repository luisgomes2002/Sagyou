// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { listCommandLines, matchServers } from '../modules/remote/rc-servers'

describe('matchServers', () => {
  it('reconhece o executável nativo com nome entre aspas', () => {
    const lines = [
      '"C:\\Users\\luis\\.local\\bin\\claude.exe" remote-control --spawn worktree --name "Sagyou"'
    ]
    expect(matchServers(lines, ['Sagyou'])).toEqual([{ name: 'Sagyou', up: true }])
  })

  it('reconhece o node rodando o cli.js com nome sem aspas', () => {
    const lines = [
      'node.exe C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js remote-control --name Murasaki'
    ]
    expect(matchServers(lines, ['Murasaki'])).toEqual([{ name: 'Murasaki', up: true }])
  })

  it('nome com espaço não liga um nome mais curto', () => {
    const lines = ['claude.exe remote-control --name "Sagyou Beta"']
    expect(matchServers(lines, ['Sagyou', 'Sagyou Beta'])).toEqual([
      { name: 'Sagyou', up: false },
      { name: 'Sagyou Beta', up: true }
    ])
  })

  it('linha sem remote-control não conta', () => {
    expect(matchServers(['claude.exe --name "Sagyou"'], ['Sagyou'])).toEqual([
      { name: 'Sagyou', up: false }
    ])
  })

  it('ignora maiúsculas e mantém a ordem da lista', () => {
    const lines = ['claude remote-control --name "murasaki"', 'claude remote-control --name sagyou']
    expect(matchServers(lines, ['Murasaki', 'Living', 'Sagyou'])).toEqual([
      { name: 'Murasaki', up: true },
      { name: 'Living', up: false },
      { name: 'Sagyou', up: true }
    ])
  })
})

describe('listCommandLines', () => {
  it('fora do Windows não roda nada', async () => {
    const exec = vi.fn()
    expect(await listCommandLines(exec, 'linux')).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  it('no Windows usa o PowerShell e separa as linhas', async () => {
    const exec = vi.fn(async () => 'a remote-control --name X\r\n\r\nb remote-control --name Y\r\n')
    expect(await listCommandLines(exec, 'win32')).toEqual([
      'a remote-control --name X',
      'b remote-control --name Y'
    ])
    expect(exec).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-Command'])
    )
  })

  it('erro vira lista vazia', async () => {
    const exec = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await listCommandLines(exec, 'win32')).toEqual([])
  })
})
