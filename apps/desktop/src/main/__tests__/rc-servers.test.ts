// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('../modules/logs/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  killRemoteControlServerNamed,
  killRemoteControlServers,
  listCommandLines,
  listRemoteControlNames,
  remoteControlTargets,
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

const SELF = 999
const row = (pid: number, ppid: number, cmd: string): string => `${pid}\t${ppid}\t${cmd}`
const scan = (...rows: string[]): string => rows.map((r) => `${r}\r\n`).join('')

// Review of PR #48: the cut used to end anything whose command line contained
// "remote-control" (an editor in a folder named so, a build, a git).
describe('remoteControlTargets', () => {
  it('pega o claude remote-control e a shell da tarefa de logon', () => {
    expect(
      remoteControlTargets(
        [
          row(10, 1, '"C:\\Users\\l\\.local\\bin\\claude.exe" remote-control --name Sagyou'),
          row(
            11,
            1,
            '"C:\\nodejs\\node.exe" "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" remote-control --name "Murasaki"'
          ),
          row(12, 1, 'cmd.exe /c claude remote-control --name Living'),
          row(13, 1, 'powershell.exe -Command "claude remote-control --name X"')
        ],
        SELF
      )
    ).toEqual(['10', '11', '12', '13'])
  })

  it('não pega editor, build ou git numa pasta chamada remote-control', () => {
    expect(
      remoteControlTargets(
        [
          row(20, 1, '"C:\\VSCode\\Code.exe" E:\\Projetos\\esp32-remote-control'),
          row(21, 1, 'node E:\\x\\remote-control\\server.js'),
          row(22, 1, 'git -C E:\\claude\\remote-control status'),
          row(23, 1, 'notepad.exe remote-control.txt'),
          row(24, 1, 'node claude-remote-control.js')
        ],
        SELF
      )
    ).toEqual([])
  })

  it('nunca pega o próprio Sagyou nem um filho dele', () => {
    expect(
      remoteControlTargets(
        [
          row(SELF, 1, 'claude remote-control'),
          row(30, SELF, "powershell.exe -Command claude remote-control 'x'"),
          row(31, 1, 'claude remote-control --name A')
        ],
        SELF
      )
    ).toEqual(['31'])
  })

  it('ignora linhas malformadas', () => {
    expect(remoteControlTargets(['12a\t1\tclaude remote-control', '', 'x'], SELF)).toEqual([])
  })
})

// Spec 2026-11-07-endurecer-acesso-remoto: "Cortar acesso" ends every server.
describe('killRemoteControlServers', () => {
  it('lista pelo PowerShell e encerra cada árvore com o taskkill do sistema', async () => {
    const exec = vi.fn<ExecText>(async (file) =>
      file.endsWith('powershell.exe')
        ? scan(row(120, 1, 'claude remote-control --name A'), row(4410, 1, 'claude remote-control'))
        : ''
    )
    const env = { SystemRoot: 'D:\\Win' }
    expect(await killRemoteControlServers(exec, 'win32', env, SELF)).toBe(2)
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

  it('só encerra o que é claude remote-control', async () => {
    const exec = vi.fn<ExecText>(async (file) =>
      file.endsWith('powershell.exe')
        ? scan(row(5, 1, 'Code.exe E:\\remote-control'), '', row(77, 1, 'claude remote-control'))
        : ''
    )
    expect(await killRemoteControlServers(exec, 'win32', {}, SELF)).toBe(1)
    expect(exec).toHaveBeenLastCalledWith('C:\\Windows\\System32\\taskkill.exe', [
      '/PID',
      '77',
      '/T',
      '/F'
    ])
  })

  it('um taskkill que falha não para os outros e não conta', async () => {
    const exec = vi.fn<ExecText>(async (file, args) => {
      if (file.endsWith('powershell.exe'))
        return scan(row(1, 0, 'claude remote-control'), row(2, 0, 'claude remote-control'))
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

// Spec 2026-11-09-servidores-remote-control: "Desligar" a server started outside
// the Sagyou ends only the processes with that --name.
describe('killRemoteControlServerNamed', () => {
  const rows = scan(
    row(10, 1, '"C:\Users\l\.local\bin\claude.exe" remote-control --name Sagyou'),
    row(11, 1, 'claude remote-control --name "Sagyou Beta"'),
    row(12, 1, 'cmd.exe /c claude remote-control --name "sagyou"'),
    row(13, 1, 'claude remote-control --name Murasaki'),
    row(14, SELF, 'claude remote-control --name Sagyou'),
    row(SELF, 1, 'claude remote-control --name Sagyou'),
    row(15, 1, 'Code.exe E:\remote-control --name Sagyou'),
    row(16, 1, 'claude remote-control')
  )

  it('só as linhas claude remote-control com aquele --name, nunca o Sagyou nem filhos', async () => {
    const exec = vi.fn<ExecText>(async (file) => (file.endsWith('powershell.exe') ? rows : ''))
    expect(await killRemoteControlServerNamed(exec, 'Sagyou', SELF, 'win32', {})).toBe(2)
    const kills = exec.mock.calls.slice(1)
    expect(kills).toEqual([
      ['C:\Windows\System32\taskkill.exe', ['/PID', '10', '/T', '/F']],
      ['C:\Windows\System32\taskkill.exe', ['/PID', '12', '/T', '/F']]
    ])
  })

  it('remoteControlTargets com nome filtra; sem nome continua pegando todos', () => {
    const lines = rows.split(/\r?\n/)
    expect(remoteControlTargets(lines, SELF, 'murasaki')).toEqual(['13'])
    expect(remoteControlTargets(lines, SELF, 'Sagyou Beta')).toEqual(['11'])
    expect(remoteControlTargets(lines, SELF)).toEqual(['10', '11', '12', '13', '16'])
  })

  it('nome vazio, fora do Windows ou erro na busca: 0', async () => {
    const exec = vi.fn<ExecText>(async () => rows)
    expect(await killRemoteControlServerNamed(exec, '  ', SELF, 'win32', {})).toBe(0)
    expect(await killRemoteControlServerNamed(exec, 'Sagyou', SELF, 'linux', {})).toBe(0)
    expect(exec).not.toHaveBeenCalled()
    const failing = vi.fn<ExecText>(async () => {
      throw new Error('boom')
    })
    expect(await killRemoteControlServerNamed(failing, 'Sagyou', SELF, 'win32', {})).toBe(0)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

describe('listRemoteControlNames', () => {
  it('devolve o --name de cada remote-control em execução', async () => {
    const exec = vi.fn<ExecText>(
      async () =>
        'claude.exe remote-control --name "Sagyou Beta"\r\nnode cli.js remote-control --name Murasaki\r\nCode.exe E:\remote-control\r\n'
    )
    expect(await listRemoteControlNames(exec, 'win32', {})).toEqual(['Sagyou Beta', 'Murasaki'])
  })

  it('fora do Windows não roda nada', async () => {
    const exec = vi.fn<ExecText>(async () => '')
    expect(await listRemoteControlNames(exec, 'linux', {})).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })
})
