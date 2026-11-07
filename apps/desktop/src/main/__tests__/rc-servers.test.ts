// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  killRemoteControlServers,
  listCommandLines,
  matchServers,
  type ExecText
} from '../modules/remote/rc-servers'

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
    expect(await listCommandLines(exec, 'win32', { SystemRoot: 'D:\\Win' })).toEqual([
      'a remote-control --name X',
      'b remote-control --name Y'
    ])
    // Absolute path: a powershell.exe dropped in the working folder or on PATH never runs.
    expect(exec).toHaveBeenCalledWith(
      'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.arrayContaining(['-NoProfile', '-Command'])
    )
  })

  it('sem SystemRoot usa C:\\Windows', async () => {
    const exec = vi.fn(async () => '')
    await listCommandLines(exec, 'win32', {})
    expect(exec).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.anything()
    )
  })

  it('erro vira lista vazia', async () => {
    const exec = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await listCommandLines(exec, 'win32')).toEqual([])
  })
})

// Spec 2026-11-07-endurecer-acesso-remoto: "Cortar acesso" ends every server.
describe('killRemoteControlServers', () => {
  it('lista os PIDs pelo PowerShell e encerra cada árvore com o taskkill do sistema', async () => {
    const exec = vi.fn<ExecText>(async (file) =>
      file.endsWith('powershell.exe') ? '120\r\n4410\r\n' : ''
    )
    expect(await killRemoteControlServers(exec, 'win32', { SystemRoot: 'D:\\Win' })).toBe(2)
    const [listCall, ...kills] = exec.mock.calls
    expect(listCall[0]).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    // The search excludes its own PowerShell, so it never kills itself.
    expect(listCall[1].join(' ')).toContain('$PID')
    expect(listCall[1].join(' ')).toContain('remote-control')
    expect(kills).toEqual([
      ['D:\\Win\\System32\\taskkill.exe', ['/PID', '120', '/T', '/F']],
      ['D:\\Win\\System32\\taskkill.exe', ['/PID', '4410', '/T', '/F']]
    ])
  })

  it('ignora linhas que não são PIDs', async () => {
    const exec = vi.fn<ExecText>(async (file) =>
      file.endsWith('powershell.exe') ? '12a\r\n\r\n-3\r\n77\r\n' : ''
    )
    expect(await killRemoteControlServers(exec, 'win32', {})).toBe(1)
    expect(exec).toHaveBeenLastCalledWith('C:\\Windows\\System32\\taskkill.exe', [
      '/PID',
      '77',
      '/T',
      '/F'
    ])
  })

  it('um taskkill que falha não para os outros e não conta', async () => {
    const exec = vi.fn<ExecText>(async (file, args) => {
      if (file.endsWith('powershell.exe')) return '1\r\n2\r\n'
      if (args[1] === '1') throw new Error('já saiu')
      return ''
    })
    expect(await killRemoteControlServers(exec, 'win32', {})).toBe(1)
  })

  it('erro na busca = 0, sem taskkill', async () => {
    const exec = vi.fn<ExecText>(async () => {
      throw new Error('boom')
    })
    expect(await killRemoteControlServers(exec, 'win32', {})).toBe(0)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('fora do Windows não faz nada', async () => {
    const exec = vi.fn<ExecText>(async () => '')
    expect(await killRemoteControlServers(exec, 'linux')).toBe(0)
    expect(exec).not.toHaveBeenCalled()
  })
})
